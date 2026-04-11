// ============================================================
// Core data types for Backpack
// Everything the system needs to represent learning graphs.
// No MCP knowledge here — these are pure data structures.
// ============================================================

// --- Instance types (the actual data) ---

export interface Node {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LearningGraphMetadata {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningGraphData {
  metadata: LearningGraphMetadata;
  nodes: Node[];
  edges: Edge[];
}

// --- Summary types (for progressive discovery — minimal context) ---

/** A lightweight view of a node: just enough to decide if you want the full thing. */
export interface NodeSummary {
  id: string;
  type: string;
  label: string; // First string property value, so you can identify it at a glance
}

/** A lightweight view of an edge: just the connection, no properties. */
export interface EdgeSummary {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
}

/** How many nodes of each type exist in a learning graph. */
export interface NodeTypeInfo {
  type: string;
  count: number;
}

/** Edge type info derived from actual data. */
export interface EdgeTypeInfo {
  type: string;
  count: number;
}

/** Top-level summary of a learning graph — returned by list operations. */
export interface LearningGraphSummary {
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  nodeTypes: NodeTypeInfo[];
}

// --- Result types ---

export interface ListNodesResult {
  nodes: NodeSummary[];
  total: number;
  hasMore: boolean;
}

export interface GetNodeResult {
  node: Node;
  edges: EdgeSummary[];
}

export interface NeighborEntry {
  node: NodeSummary;
  edge: EdgeSummary;
  depth: number;
}

export interface NeighborResult {
  nodeId: string;
  neighbors: NeighborEntry[];
}

// --- Graph statistics ---

export interface NodeDegree {
  id: string;
  label: string;
  type: string;
  connections: number;
}

export interface TypeConnection {
  types: string;
  count: number;
}

export interface GraphStats {
  orphanCount: number;
  orphans: NodeDegree[];
  mostConnected: NodeDegree[];
  leastConnected: NodeDegree[];
  avgConnections: number;
  density: number;
  typeConnections: TypeConnection[];
}

// --- Audit types ---

export interface SparseType {
  type: string;
  nodes: number;
  intraEdges: number;
  avgConnections: number;
}

export interface DisconnectedTypePair {
  typeA: string;
  typeB: string;
  nodesA: number;
  nodesB: number;
}

export interface GraphAudit {
  orphans: NodeDegree[];
  weakNodes: NodeDegree[];
  sparseTypes: SparseType[];
  disconnectedTypePairs: DisconnectedTypePair[];
  suggestions: string[];
}

// --- Node degree table ---

export interface NodeDegreeDetail {
  id: string;
  label: string;
  type: string;
  incoming: number;
  outgoing: number;
  total: number;
  propertyCount: number;
}

export interface TypeSummary {
  type: string;
  count: number;
  avgConnections: number;
  avgProperties: number;
  nodes: NodeDegreeDetail[];
}

export interface GraphDegreeTable {
  nodeCount: number;
  edgeCount: number;
  density: number;
  avgConnections: number;
  types: TypeSummary[];
}

// --- Processor pipeline types ---

export interface ProcessorIssue {
  kind:
    | "vague_label"
    | "generic_edge_type"
    | "vague_property"
    | "low_relationship_score"
    | "procedural_content"
    | "briefing_content"
    | "duplicate_node"
    | "custom";
  severity: "error" | "warning" | "info";
  targetId: string; // node or edge identifier (index or id)
  detectedBy: string; // processor name
  message: string;
  recommendation: string;
}

export interface ProcessorResult {
  issues: ProcessorIssue[];
  metadata: {
    processor: string;
    confidence?: number;
    enhancedBy?: string[];
  };
}

export interface ProcessorContext {
  existingNodes: Node[];
  existingEdges: Edge[];
}

export interface ExtractionProcessor {
  name: string;
  priority: number; // lower runs first
  canProcessNode(node: ProposedNodeInput): boolean;
  canProcessEdge(edge: ProposedEdgeInput): boolean;
  processNode(
    node: ProposedNodeInput,
    index: number,
    context: ProcessorContext
  ): ProcessorIssue[];
  processEdge(
    edge: ProposedEdgeInput,
    index: number,
    context: ProcessorContext
  ): ProcessorIssue[];
}

export interface ProposedNodeInput {
  type: string;
  properties: Record<string, unknown>;
}

export interface ProposedEdgeInput {
  type: string;
  source: number | string;
  target: number | string;
  properties?: Record<string, unknown>;
}

export interface ExtractionQualityReport {
  ok: boolean; // false if any errors exist
  issues: ProcessorIssue[];
  summary: {
    totalChecked: number;
    errors: number;
    warnings: number;
    processorsRun: string[];
    recommendedRemovals: string[]; // node indices with errors
  };
}

// --- Pattern analysis types ---

export type PatternType =
  | "frequency"
  | "dependency"
  | "cost_driver"
  | "gap"
  | "mismatch";

export interface PatternEntity {
  nodeId: string;
  label: string;
  type: string;
  score: number;
}

export interface DetectedPattern {
  id: string;
  type: PatternType;
  entities: PatternEntity[];
  reasoning: string;
  severity: "critical" | "high" | "medium" | "low";
  recommendedAction: string;
}

export interface PatternAnalysis {
  patterns: DetectedPattern[];
  topIssues: string[]; // ranked by severity × score
  summary: {
    nodesAnalyzed: number;
    edgesAnalyzed: number;
    patternsFound: number;
    byType: Record<PatternType, number>;
  };
}

// --- Pluggable storage interface ---

/**
 * Any storage backend must implement this interface.
 * The default is JsonFileBackend (JSON files on disk).
 * Future options: SQLite, remote API, etc.
 */
export interface StorageBackend {
  initialize(): Promise<void>;
  listOntologies(): Promise<LearningGraphSummary[]>;
  loadOntology(name: string): Promise<LearningGraphData>;
  /**
   * Save the full graph state. If `expectedVersion` is provided and the
   * backend supports optimistic concurrency, the write fails when the
   * stored version differs (the backend throws ConcurrencyError).
   * Backends that don't support versioning should ignore the parameter.
   */
  saveOntology(
    name: string,
    data: LearningGraphData,
    expectedVersion?: number,
  ): Promise<void>;
  createOntology(name: string, description: string): Promise<LearningGraphData>;
  deleteOntology(name: string): Promise<void>;
  renameOntology(oldName: string, newName: string): Promise<void>;
  ontologyExists(name: string): Promise<boolean>;
}
