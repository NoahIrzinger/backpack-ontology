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
import { estimateGraphTokens } from "./token-estimate.js";
import { auditRoles, type RoleAuditResult } from "./role-audit.js";
import {
  validateProposal,
  type DraftResult,
  type ProposedNode,
  type ProposedEdge,
} from "./draft.js";
import {
  planNormalization,
  planSummary,
  type NormalizationPlan,
} from "./normalize.js";
import {
  getActiveBackpack,
  setActiveBackpack,
  listBackpacks,
  getKBMounts,
  type BackpackEntry,
} from "./backpacks-registry.js";
import { EventSourcedBackend } from "../storage/event-sourced-backend.js";
import { DocumentStore, type KBMount } from "./document-store.js";

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
  private versions: Map<string, number> = new Map();
  private tokenCache: Map<string, number> = new Map();
  private activeBackpack: BackpackEntry | null = null;
  private _documents: DocumentStore | null = null;

  constructor(storage: StorageBackend) {
    this.storage = storage;
  }

  /**
   * Construct a Backpack whose storage backend reads from the currently
   * active registered backpack (see backpacks-registry). The default
   * entry point for the MCP server and CLI — handles first-run seeding,
   * env var overrides, and transparent switching via `switchBackpack`.
   */
  static async fromActiveBackpack(): Promise<Backpack> {
    const entry = await getActiveBackpack();
    const backend = new EventSourcedBackend(undefined, {
      graphsDirOverride: entry.path,
    });
    const bp = new Backpack(backend);
    bp.activeBackpack = entry;
    return bp;
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  // --- Backpack (meta) management ---

  /**
   * Name of the currently active backpack, or null if this instance
   * was constructed directly with a backend (tests, custom integrations).
   */
  getActiveBackpackEntry(): BackpackEntry | null {
    return this.activeBackpack;
  }

  /**
   * Get the DocumentStore for the active backpack's KB mounts.
   * Lazily created and cached. Reset on switchBackpack().
   */
  async documents(): Promise<DocumentStore> {
    if (!this._documents) {
      const entry = this.activeBackpack;
      if (!entry) {
        throw new Error("No active backpack — cannot resolve KB path");
      }
      const mountConfigs = await getKBMounts(entry.path);
      const mounts: KBMount[] = mountConfigs.map((m) => ({
        name: m.name,
        path: m.path,
        writable: m.writable !== false,
      }));
      this._documents = new DocumentStore(mounts);
    }
    return this._documents;
  }

  async listRegisteredBackpacks(): Promise<BackpackEntry[]> {
    return listBackpacks();
  }

  /**
   * Switch the active backpack for this instance. Updates the persistent
   * active.json state, tears down all in-memory caches, and replaces the
   * storage backend with a fresh one pointed at the new path. The new
   * backend's initialize() runs automatically (including legacy format
   * auto-migration at the new location).
   *
   * Throws if the name is not registered.
   */
  async switchBackpack(name: string): Promise<BackpackEntry> {
    const entry = await setActiveBackpack(name);
    // Drop every cached thing rooted in the old backend
    this.graphs.clear();
    this.versions.clear();
    this.tokenCache.clear();
    this._documents = null;
    // Stand up a fresh backend at the new path
    const newBackend = new EventSourcedBackend(undefined, {
      graphsDirOverride: entry.path,
    });
    await newBackend.initialize();
    this.storage = newBackend;
    this.activeBackpack = entry;
    return entry;
  }

  /** Get or load a Graph for an ontology. Caches in memory. */
  private async getGraph(ontologyName: string): Promise<Graph> {
    let graph = this.graphs.get(ontologyName);
    if (!graph) {
      const data = await this.storage.loadOntology(ontologyName);
      graph = new Graph(data);
      this.graphs.set(ontologyName, graph);
      // Record the version we loaded so persist() can pass it as
      // expectedVersion for optimistic concurrency. Backends that don't
      // support versioning return undefined (no check happens).
      const version = await this.getVersionIfSupported(ontologyName);
      if (version !== undefined) this.versions.set(ontologyName, version);
    }
    return graph;
  }

  private async getVersionIfSupported(name: string): Promise<number | undefined> {
    if (
      "getCurrentVersion" in this.storage &&
      typeof (this.storage as any).getCurrentVersion === "function"
    ) {
      try {
        return await (this.storage as any).getCurrentVersion(name);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Save the current state of an ontology back to storage. Passes the
   * version recorded at load time so the storage backend can detect
   * concurrent modifications and reject the write. On conflict, the
   * cache is invalidated and the underlying ConcurrencyError propagates.
   */
  private async persist(ontologyName: string): Promise<void> {
    const graph = this.graphs.get(ontologyName);
    if (!graph) return;
    this.tokenCache.delete(ontologyName);
    const expectedVersion = this.versions.get(ontologyName);
    try {
      await this.storage.saveOntology(ontologyName, graph.data, expectedVersion);
    } catch (err) {
      if ((err as Error).name === "ConcurrencyError") {
        // Drop the stale cache so the next read pulls fresh state
        this.graphs.delete(ontologyName);
        this.versions.delete(ontologyName);
      }
      throw err;
    }
    // Refresh the version after a successful write. If the refresh
    // fails (transient storage error), drop the cached version so the
    // next persist skips the optimistic check rather than tripping a
    // false ConcurrencyError on a stale value.
    const newVersion = await this.getVersionIfSupported(ontologyName);
    if (newVersion !== undefined) {
      this.versions.set(ontologyName, newVersion);
    } else {
      this.versions.delete(ontologyName);
    }
  }

  // --- Lock heartbeat (collaboration awareness) ---

  /**
   * Read the current lock heartbeat for a graph, if the storage backend
   * supports it. Returns null when no fresh lock is held.
   */
  async getLockInfo(name: string): Promise<unknown | null> {
    if (
      "readLock" in this.storage &&
      typeof (this.storage as any).readLock === "function"
    ) {
      return (this.storage as any).readLock(name);
    }
    return null;
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

  async ontologyExists(name: string): Promise<boolean> {
    return this.storage.ontologyExists(name);
  }

  async loadOntology(name: string): Promise<LearningGraphData> {
    return this.storage.loadOntology(name);
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
    this.tokenCache.delete(name);
  }

  /**
   * Create a new ontology from a full LearningGraphData payload, preserving
   * node and edge IDs. Used by remote graph import (where we want the local
   * copy to have the same IDs as the source) and any other situation where
   * a complete graph is constructed externally.
   *
   * Throws if an ontology with this name already exists.
   */
  async createOntologyFromData(
    name: string,
    data: LearningGraphData,
  ): Promise<void> {
    if (await this.storage.ontologyExists(name)) {
      throw new Error(`Learning graph "${name}" already exists`);
    }
    // Two-step: create the empty ontology first (so storage has metadata),
    // then save the full payload (which diffs against empty and emits adds).
    const description = data.metadata.description ?? "";
    await this.storage.createOntology(name, description);
    const now = new Date().toISOString();
    const cleaned: LearningGraphData = {
      metadata: {
        name,
        description,
        createdAt: data.metadata.createdAt || now,
        updatedAt: now,
      },
      nodes: data.nodes,
      edges: data.edges,
    };
    await this.storage.saveOntology(name, cleaned);
    this.graphs.set(name, new Graph(cleaned));
    this.tokenCache.delete(name);
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
    // The filtered arrays already contain references owned by the source
    // graph; createOntologyFromData persists via the storage layer which
    // serializes through JSON, giving the new graph independent copies.
    // No manual deep clone needed.
    const now = new Date().toISOString();
    const newData: LearningGraphData = {
      metadata: {
        name: newName,
        description: description || `Extracted from ${sourceName}`,
        createdAt: now,
        updatedAt: now,
      },
      nodes,
      edges,
    };
    await this.createOntologyFromData(newName, newData);
    return { nodeCount: nodes.length, edgeCount: edges.length };
  }

  async renameOntology(oldName: string, newName: string): Promise<void> {
    await this.storage.renameOntology(oldName, newName);
    const graph = this.graphs.get(oldName);
    if (graph) {
      graph.data.metadata.name = newName;
      this.graphs.delete(oldName);
      this.tokenCache.delete(oldName);
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

  /**
   * Validate a proposed batch of nodes and edges against the current
   * graph state. Returns warnings (non-fatal — type drift, duplicates,
   * three-role rule violations) and errors (fatal — broken edges,
   * invalid property shapes).
   *
   * Pure check: does NOT modify the graph. Used by `backpack_import_nodes`
   * for the always-on validation pass and by `dryRun` mode for explicit
   * propose-only invocations.
   */
  async validateImport(
    ontologyName: string,
    nodes: ProposedNode[],
    edges: ProposedEdge[] = [],
  ): Promise<DraftResult> {
    const graph = await this.getGraph(ontologyName);
    return validateProposal(graph.data, nodes, edges);
  }

  async getGraphTokens(name: string): Promise<number> {
    const cached = this.tokenCache.get(name);
    if (cached !== undefined) return cached;
    const graph = await this.getGraph(name);
    const tokens = estimateGraphTokens(graph.data);
    this.tokenCache.set(name, tokens);
    return tokens;
  }

  async auditOntology(name: string): Promise<GraphAudit> {
    const graph = await this.getGraph(name);
    return graph.audit();
  }

  /**
   * Plan a normalization pass: detect type drift clusters and pick
   * the dominant variant in each. Returns the plan without applying it.
   */
  async planNormalization(name: string): Promise<NormalizationPlan> {
    const graph = await this.getGraph(name);
    return planNormalization(graph.data);
  }

  /**
   * Apply a normalization plan to the graph: rename non-canonical
   * node and edge types to their canonical variants. Uses the existing
   * persist path, which emits retype events under the hood.
   *
   * Returns the plan that was applied plus a summary of counts.
   */
  async applyNormalization(name: string): Promise<{
    plan: NormalizationPlan;
    summary: ReturnType<typeof planSummary>;
  }> {
    const graph = await this.getGraph(name);
    const plan = planNormalization(graph.data);

    const nodeMap = new Map(plan.nodeTypeRenames.map((r) => [r.from, r.to]));
    const edgeMap = new Map(plan.edgeTypeRenames.map((r) => [r.from, r.to]));

    // Mutate the in-memory graph in place; persist() will diff and
    // emit retype events.
    for (const node of graph.data.nodes) {
      const newType = nodeMap.get(node.type);
      if (newType !== undefined) node.type = newType;
    }
    for (const edge of graph.data.edges) {
      const newType = edgeMap.get(edge.type);
      if (newType !== undefined) edge.type = newType;
    }

    if (plan.nodeTypeRenames.length > 0 || plan.edgeTypeRenames.length > 0) {
      await this.persist(name);
    }

    return { plan, summary: planSummary(plan) };
  }

  /**
   * Three-role-rule audit. Scans the graph for nodes that look like
   * procedural content (should be a skill) or briefing content (should
   * be in CLAUDE.md). Heuristic-based; conservative on purpose to avoid
   * false positives.
   */
  async auditRoles(name: string): Promise<RoleAuditResult> {
    const graph = await this.getGraph(name);
    return auditRoles(graph.data.nodes);
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
    this.tokenCache.delete(name);
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
    this.tokenCache.delete(name);
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
