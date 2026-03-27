import { generateNodeId, generateEdgeId } from "./ids.js";
import type {
  Node,
  Edge,
  LearningGraphData,
  NodeSummary,
  EdgeSummary,
  NodeTypeInfo,
  EdgeTypeInfo,
  ListNodesResult,
  GetNodeResult,
  NeighborEntry,
  NeighborResult,
} from "./types.js";

/**
 * In-memory graph operations on an LearningGraphData object.
 * Pure logic — no I/O, no MCP, fully testable.
 *
 * The Graph holds a reference to the LearningGraphData. When you mutate
 * the graph (add/remove nodes/edges), the underlying data is modified
 * in place. The caller (Backpack class) is responsible for persisting.
 */
export class Graph {
  constructor(public data: LearningGraphData) {}

  // --- Helpers ---

  private now(): string {
    return new Date().toISOString();
  }

  /** Extract a label from a node's properties — the first string value found. */
  private nodeLabel(node: Node): string {
    for (const value of Object.values(node.properties)) {
      if (typeof value === "string") return value;
    }
    return node.id;
  }

  /** Convert a full Node to a NodeSummary (for progressive discovery). */
  private summarizeNode(node: Node): NodeSummary {
    return {
      id: node.id,
      type: node.type,
      label: this.nodeLabel(node),
    };
  }

  /** Convert a full Edge to an EdgeSummary. */
  private summarizeEdge(edge: Edge): EdgeSummary {
    return {
      id: edge.id,
      type: edge.type,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
    };
  }

  // --- Node operations ---

  addNode(type: string, properties: Record<string, unknown>): Node {
    const now = this.now();
    const node: Node = {
      id: generateNodeId(),
      type,
      properties,
      createdAt: now,
      updatedAt: now,
    };
    this.data.nodes.push(node);
    this.data.metadata.updatedAt = now;
    return node;
  }

  /**
   * Bulk-import nodes and optionally edges in a single atomic operation.
   * Edges reference new nodes by array index (number) or existing nodes by ID (string).
   * Pre-validates all edge references before creating anything (all-or-nothing).
   */
  importNodesAndEdges(
    nodes: Array<{ type: string; properties: Record<string, unknown> }>,
    edges?: Array<{
      type: string;
      source: number | string;
      target: number | string;
      properties?: Record<string, unknown>;
    }>
  ): { nodeIds: string[]; edgeIds: string[] } {
    // Pre-validate edge references before any mutations
    if (edges) {
      for (let i = 0; i < edges.length; i++) {
        const { source, target } = edges[i];
        if (typeof source === "number") {
          if (source < 0 || source >= nodes.length)
            throw new Error(`Edge at index ${i}: source index ${source} is out of bounds (${nodes.length} nodes provided)`);
        } else {
          if (!this.getNode(source))
            throw new Error(`Edge at index ${i}: source node not found: ${source}`);
        }
        if (typeof target === "number") {
          if (target < 0 || target >= nodes.length)
            throw new Error(`Edge at index ${i}: target index ${target} is out of bounds (${nodes.length} nodes provided)`);
        } else {
          if (!this.getNode(target))
            throw new Error(`Edge at index ${i}: target node not found: ${target}`);
        }
      }
    }

    // Phase 1: create all nodes
    const nodeIds: string[] = [];
    for (const { type, properties } of nodes) {
      const node = this.addNode(type, properties);
      nodeIds.push(node.id);
    }

    // Phase 2: resolve references and create edges
    const edgeIds: string[] = [];
    if (edges) {
      for (const { type, source, target, properties } of edges) {
        const sourceId = typeof source === "number" ? nodeIds[source] : source;
        const targetId = typeof target === "number" ? nodeIds[target] : target;
        const edge = this.addEdge(type, sourceId, targetId, properties ?? {});
        edgeIds.push(edge.id);
      }
    }

    return { nodeIds, edgeIds };
  }

  getNode(id: string): Node | undefined {
    return this.data.nodes.find((n) => n.id === id);
  }

  updateNode(id: string, properties: Record<string, unknown>): Node {
    const node = this.getNode(id);
    if (!node) throw new Error(`Node not found: ${id}`);

    // Merge new properties into existing ones
    Object.assign(node.properties, properties);
    node.updatedAt = this.now();
    this.data.metadata.updatedAt = node.updatedAt;
    return node;
  }

  /** Remove a node and all edges connected to it. Returns the count of removed edges. */
  removeNode(id: string): number {
    const index = this.data.nodes.findIndex((n) => n.id === id);
    if (index === -1) throw new Error(`Node not found: ${id}`);

    this.data.nodes.splice(index, 1);

    // Cascade: remove all edges that reference this node
    const beforeCount = this.data.edges.length;
    this.data.edges = this.data.edges.filter(
      (e) => e.sourceId !== id && e.targetId !== id
    );
    const removedEdges = beforeCount - this.data.edges.length;

    this.data.metadata.updatedAt = this.now();
    return removedEdges;
  }

  /** List nodes with pagination. Optionally filter by type. */
  listNodes(type?: string, limit = 20, offset = 0): ListNodesResult {
    let filtered = this.data.nodes;
    if (type) {
      filtered = filtered.filter((n) => n.type === type);
    }

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    return {
      nodes: page.map((n) => this.summarizeNode(n)),
      total,
      hasMore: offset + limit < total,
    };
  }

  /** Case-insensitive substring search across all string properties. */
  searchNodes(query: string, type?: string): NodeSummary[] {
    const lowerQuery = query.toLowerCase();

    return this.data.nodes
      .filter((node) => {
        if (type && node.type !== type) return false;

        // Search the type name itself
        if (node.type.toLowerCase().includes(lowerQuery)) return true;

        // Search across all property values
        return Object.values(node.properties).some((value) => {
          if (typeof value === "string") {
            return value.toLowerCase().includes(lowerQuery);
          }
          if (Array.isArray(value)) {
            return value.some(
              (v) =>
                typeof v === "string" && v.toLowerCase().includes(lowerQuery)
            );
          }
          return false;
        });
      })
      .map((n) => this.summarizeNode(n));
  }

  /** Get distinct node types with counts, derived from actual data. */
  getNodeTypes(): NodeTypeInfo[] {
    const counts = new Map<string, number>();
    for (const node of this.data.nodes) {
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Get distinct edge types with counts, derived from actual data. */
  getEdgeTypes(): EdgeTypeInfo[] {
    const counts = new Map<string, number>();
    for (const edge of this.data.edges) {
      counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }

  // --- Edge operations ---

  addEdge(
    type: string,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown> = {}
  ): Edge {
    // Validate that both nodes exist
    if (!this.getNode(sourceId)) throw new Error(`Source node not found: ${sourceId}`);
    if (!this.getNode(targetId)) throw new Error(`Target node not found: ${targetId}`);

    const now = this.now();
    const edge: Edge = {
      id: generateEdgeId(),
      type,
      sourceId,
      targetId,
      properties,
      createdAt: now,
      updatedAt: now,
    };
    this.data.edges.push(edge);
    this.data.metadata.updatedAt = now;
    return edge;
  }

  getEdge(id: string): Edge | undefined {
    return this.data.edges.find((e) => e.id === id);
  }

  removeEdge(id: string): void {
    const index = this.data.edges.findIndex((e) => e.id === id);
    if (index === -1) throw new Error(`Edge not found: ${id}`);
    this.data.edges.splice(index, 1);
    this.data.metadata.updatedAt = this.now();
  }

  /** Get a node with all its connected edge summaries. */
  getNodeWithEdges(id: string): GetNodeResult {
    const node = this.getNode(id);
    if (!node) throw new Error(`Node not found: ${id}`);

    const edges = this.data.edges
      .filter((e) => e.sourceId === id || e.targetId === id)
      .map((e) => this.summarizeEdge(e));

    return { node, edges };
  }

  /**
   * BFS traversal from a node. Returns neighbor summaries with depth info.
   * Max depth is capped at 3 to prevent context explosion.
   */
  getNeighbors(
    nodeId: string,
    edgeType?: string,
    direction: "incoming" | "outgoing" | "both" = "both",
    depth = 1
  ): NeighborResult {
    if (!this.getNode(nodeId)) throw new Error(`Node not found: ${nodeId}`);

    const maxDepth = Math.min(depth, 3);
    const visited = new Set<string>([nodeId]);
    const result: NeighborEntry[] = [];

    // BFS queue: [nodeId, currentDepth]
    const queue: Array<[string, number]> = [[nodeId, 0]];

    while (queue.length > 0) {
      const [currentId, currentDepth] = queue.shift()!;
      if (currentDepth >= maxDepth) continue;

      // Find edges connected to current node
      const edges = this.data.edges.filter((e) => {
        if (edgeType && e.type !== edgeType) return false;

        if (direction === "outgoing") return e.sourceId === currentId;
        if (direction === "incoming") return e.targetId === currentId;
        return e.sourceId === currentId || e.targetId === currentId;
      });

      for (const edge of edges) {
        // Determine the "other" node
        const neighborId =
          edge.sourceId === currentId ? edge.targetId : edge.sourceId;

        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.getNode(neighborId);
        if (!neighborNode) continue;

        result.push({
          node: this.summarizeNode(neighborNode),
          edge: this.summarizeEdge(edge),
          depth: currentDepth + 1,
        });

        queue.push([neighborId, currentDepth + 1]);
      }
    }

    return { nodeId, neighbors: result };
  }
}
