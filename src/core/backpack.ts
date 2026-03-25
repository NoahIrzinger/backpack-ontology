import { Graph } from "./graph.js";
import type {
  StorageBackend,
  Node,
  Edge,
  LearningGraphData,
  LearningGraphMetadata,
  LearningGraphSummary,
  NodeSummary,
  NodeTypeInfo,
  EdgeTypeInfo,
  ListNodesResult,
  GetNodeResult,
  NeighborResult,
} from "./types.js";

/**
 * The main Backpack API. Composes a StorageBackend with the Graph engine.
 *
 * Every public method:
 *   1. Loads the graph (from cache or storage)
 *   2. Performs the operation via Graph
 *   3. Persists to storage if the data was mutated
 *
 * This class is the single entry point for all operations.
 * The MCP layer calls into this. Tests call into this. Everything goes through here.
 */
export class Backpack {
  private storage: StorageBackend;
  private graphs: Map<string, Graph> = new Map();

  constructor(storage: StorageBackend) {
    this.storage = storage;
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  /** Get or load a Graph for an ontology. Caches in memory. */
  private async getGraph(ontologyName: string): Promise<Graph> {
    let graph = this.graphs.get(ontologyName);
    if (!graph) {
      const data = await this.storage.loadOntology(ontologyName);
      graph = new Graph(data);
      this.graphs.set(ontologyName, graph);
    }
    return graph;
  }

  /** Save the current state of an ontology back to storage. */
  private async persist(ontologyName: string): Promise<void> {
    const graph = this.graphs.get(ontologyName);
    if (graph) {
      await this.storage.saveOntology(ontologyName, graph.data);
    }
  }

  // --- Ontology lifecycle ---

  async listOntologies(): Promise<LearningGraphSummary[]> {
    return this.storage.listOntologies();
  }

  async createOntology(
    name: string,
    description: string
  ): Promise<LearningGraphMetadata> {
    const data = await this.storage.createOntology(name, description);
    // Pre-cache the new (empty) graph
    this.graphs.set(name, new Graph(data));
    return data.metadata;
  }

  async deleteOntology(name: string): Promise<void> {
    await this.storage.deleteOntology(name);
    this.graphs.delete(name);
  }

  async renameOntology(oldName: string, newName: string): Promise<void> {
    await this.storage.renameOntology(oldName, newName);
    const graph = this.graphs.get(oldName);
    if (graph) {
      graph.data.metadata.name = newName;
      this.graphs.delete(oldName);
      this.graphs.set(newName, graph);
    }
  }

  async describeOntology(name: string): Promise<{
    metadata: LearningGraphMetadata;
    nodeTypes: NodeTypeInfo[];
    edgeTypes: EdgeTypeInfo[];
    nodeCount: number;
    edgeCount: number;
  }> {
    const graph = await this.getGraph(name);
    return {
      metadata: graph.data.metadata,
      nodeTypes: graph.getNodeTypes(),
      edgeTypes: graph.getEdgeTypes(),
      nodeCount: graph.data.nodes.length,
      edgeCount: graph.data.edges.length,
    };
  }

  // --- Node operations ---

  async listNodes(
    ontologyName: string,
    type?: string,
    limit?: number,
    offset?: number
  ): Promise<ListNodesResult> {
    const graph = await this.getGraph(ontologyName);
    return graph.listNodes(type, limit, offset);
  }

  async getNodeTypes(ontologyName: string): Promise<NodeTypeInfo[]> {
    const graph = await this.getGraph(ontologyName);
    return graph.getNodeTypes();
  }

  async searchNodes(
    ontologyName: string,
    query: string,
    type?: string
  ): Promise<NodeSummary[]> {
    const graph = await this.getGraph(ontologyName);
    return graph.searchNodes(query, type);
  }

  async getNode(ontologyName: string, nodeId: string): Promise<GetNodeResult> {
    const graph = await this.getGraph(ontologyName);
    return graph.getNodeWithEdges(nodeId);
  }

  async addNode(
    ontologyName: string,
    type: string,
    properties: Record<string, unknown>
  ): Promise<Node> {
    const graph = await this.getGraph(ontologyName);
    const node = graph.addNode(type, properties);
    await this.persist(ontologyName);
    return node;
  }

  async updateNode(
    ontologyName: string,
    nodeId: string,
    properties: Record<string, unknown>
  ): Promise<Node> {
    const graph = await this.getGraph(ontologyName);
    const node = graph.updateNode(nodeId, properties);
    await this.persist(ontologyName);
    return node;
  }

  async removeNode(
    ontologyName: string,
    nodeId: string
  ): Promise<{ removedEdges: number }> {
    const graph = await this.getGraph(ontologyName);
    const removedEdges = graph.removeNode(nodeId);
    await this.persist(ontologyName);
    return { removedEdges };
  }

  // --- Edge operations ---

  async addEdge(
    ontologyName: string,
    type: string,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown> = {}
  ): Promise<Edge> {
    const graph = await this.getGraph(ontologyName);
    const edge = graph.addEdge(type, sourceId, targetId, properties);
    await this.persist(ontologyName);
    return edge;
  }

  async removeEdge(ontologyName: string, edgeId: string): Promise<void> {
    const graph = await this.getGraph(ontologyName);
    graph.removeEdge(edgeId);
    await this.persist(ontologyName);
  }

  async getNeighbors(
    ontologyName: string,
    nodeId: string,
    edgeType?: string,
    direction?: "incoming" | "outgoing" | "both",
    depth?: number
  ): Promise<NeighborResult> {
    const graph = await this.getGraph(ontologyName);
    return graph.getNeighbors(nodeId, edgeType, direction, depth);
  }

  // --- Bulk operations ---

  async importNodes(
    ontologyName: string,
    nodes: Array<{ type: string; properties: Record<string, unknown> }>
  ): Promise<{ count: number; ids: string[] }> {
    const graph = await this.getGraph(ontologyName);
    const ids: string[] = [];
    for (const { type, properties } of nodes) {
      const node = graph.addNode(type, properties);
      ids.push(node.id);
    }
    await this.persist(ontologyName);
    return { count: ids.length, ids };
  }
}
