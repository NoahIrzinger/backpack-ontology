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
  GraphStats,
  GraphAudit,
  GraphDegreeTable,
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

  // --- Term Registry ---

  async getTermsContext(ontologyName: string): Promise<string | null> {
    if ("loadTerms" in this.storage && typeof (this.storage as any).loadTerms === "function") {
      return (this.storage as any).loadTerms(ontologyName);
    }
    return null;
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

  async extractSubgraph(
    sourceName: string,
    nodeIds: string[],
    newName: string,
    description?: string
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    const graph = await this.getGraph(sourceName);
    const idSet = new Set(nodeIds);
    const nodes = graph.data.nodes.filter((n) => idSet.has(n.id));
    const edges = graph.data.edges.filter(
      (e) => idSet.has(e.sourceId) && idSet.has(e.targetId)
    );
    const now = new Date().toISOString();
    const newData: LearningGraphData = {
      metadata: {
        name: newName,
        description: description || `Extracted from ${sourceName}`,
        createdAt: now,
        updatedAt: now,
      },
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    await this.storage.saveOntology(newName, newData);
    this.graphs.set(newName, new Graph(newData));
    return { nodeCount: nodes.length, edgeCount: edges.length };
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
    stats: GraphStats;
  }> {
    const graph = await this.getGraph(name);
    return {
      metadata: graph.data.metadata,
      nodeTypes: graph.getNodeTypes(),
      edgeTypes: graph.getEdgeTypes(),
      nodeCount: graph.data.nodes.length,
      edgeCount: graph.data.edges.length,
      stats: graph.getStats(),
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
    nodes: Array<{ type: string; properties: Record<string, unknown> }>,
    edges?: Array<{
      type: string;
      source: number | string;
      target: number | string;
      properties?: Record<string, unknown>;
    }>
  ): Promise<{ count: number; ids: string[]; edgeCount: number; edgeIds: string[] }> {
    const graph = await this.getGraph(ontologyName);
    const result = graph.importNodesAndEdges(nodes, edges);
    await this.persist(ontologyName);
    return {
      count: result.nodeIds.length,
      ids: result.nodeIds,
      edgeCount: result.edgeIds.length,
      edgeIds: result.edgeIds,
    };
  }

  async auditOntology(name: string): Promise<GraphAudit> {
    const graph = await this.getGraph(name);
    return graph.audit();
  }

  async getDegreeTable(name: string): Promise<GraphDegreeTable> {
    const graph = await this.getGraph(name);
    return graph.getDegreeTable();
  }

  async connectEdges(
    ontologyName: string,
    edges: Array<{ type: string; sourceId: string; targetId: string; properties?: Record<string, unknown> }>
  ): Promise<{ count: number; ids: string[] }> {
    const graph = await this.getGraph(ontologyName);
    const ids = graph.importEdges(edges);
    await this.persist(ontologyName);
    return { count: ids.length, ids };
  }

  // --- Branch operations ---

  async listBranches(name: string) {
    if (!("listBranches" in this.storage)) return [];
    return (this.storage as any).listBranches(name);
  }

  async createBranch(name: string, branchName: string, fromBranch?: string) {
    if (!("createBranch" in this.storage)) throw new Error("Branches not supported by storage backend");
    await (this.storage as any).createBranch(name, branchName, fromBranch);
  }

  async switchBranch(name: string, branchName: string) {
    if (!("switchBranch" in this.storage)) throw new Error("Branches not supported by storage backend");
    // Invalidate cached graph since we're switching branches
    this.graphs.delete(name);
    await (this.storage as any).switchBranch(name, branchName);
  }

  async deleteBranch(name: string, branchName: string) {
    if (!("deleteBranch" in this.storage)) throw new Error("Branches not supported by storage backend");
    await (this.storage as any).deleteBranch(name, branchName);
  }

  // --- Snapshot operations ---

  async createSnapshot(name: string, label?: string): Promise<number> {
    if (!("createSnapshot" in this.storage)) throw new Error("Snapshots not supported by storage backend");
    return (this.storage as any).createSnapshot(name, label);
  }

  async listSnapshots(name: string) {
    if (!("listSnapshots" in this.storage)) return [];
    return (this.storage as any).listSnapshots(name);
  }

  async rollback(name: string, version: number) {
    if (!("rollback" in this.storage)) throw new Error("Snapshots not supported by storage backend");
    this.graphs.delete(name);
    await (this.storage as any).rollback(name, version);
  }

  // --- Snippet operations ---

  async saveSnippet(name: string, snippet: {
    label: string;
    description?: string;
    nodeIds: string[];
    edgeIds: string[];
  }): Promise<string> {
    if (!("saveSnippet" in this.storage)) throw new Error("Snippets not supported by storage backend");
    return (this.storage as any).saveSnippet(name, snippet);
  }

  async listSnippets(name: string) {
    if (!("listSnippets" in this.storage)) return [];
    return (this.storage as any).listSnippets(name);
  }

  async loadSnippet(name: string, snippetId: string) {
    if (!("loadSnippet" in this.storage)) throw new Error("Snippets not supported by storage backend");
    return (this.storage as any).loadSnippet(name, snippetId);
  }

  async deleteSnippet(name: string, snippetId: string) {
    if (!("deleteSnippet" in this.storage)) throw new Error("Snippets not supported by storage backend");
    await (this.storage as any).deleteSnippet(name, snippetId);
  }

  async diffWithSnapshot(name: string, version: number) {
    if (!("loadSnapshot" in this.storage)) throw new Error("Snapshots not supported by storage backend");
    const current = await this.storage.loadOntology(name);
    const snapshot = await (this.storage as any).loadSnapshot(name, version);

    const currentNodeIds = new Set(current.nodes.map((n) => n.id));
    const snapshotNodeIds = new Set(snapshot.nodes.map((n: any) => n.id));
    const currentEdgeIds = new Set(current.edges.map((e) => e.id));
    const snapshotEdgeIds = new Set(snapshot.edges.map((e: any) => e.id));

    return {
      nodesAdded: current.nodes.filter((n) => !snapshotNodeIds.has(n.id)).map((n) => ({ id: n.id, type: n.type })),
      nodesRemoved: snapshot.nodes.filter((n: any) => !currentNodeIds.has(n.id)).map((n: any) => ({ id: n.id, type: n.type })),
      edgesAdded: current.edges.filter((e) => !snapshotEdgeIds.has(e.id)).map((e) => ({ id: e.id, type: e.type })),
      edgesRemoved: snapshot.edges.filter((e: any) => !currentEdgeIds.has(e.id)).map((e: any) => ({ id: e.id, type: e.type })),
      currentNodeCount: current.nodes.length,
      snapshotNodeCount: snapshot.nodes.length,
      currentEdgeCount: current.edges.length,
      snapshotEdgeCount: snapshot.edges.length,
    };
  }
}
