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

export interface OntologyMetadata {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface OntologyData {
  metadata: OntologyMetadata;
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

/** How many nodes of each type exist in an ontology. */
export interface NodeTypeInfo {
  type: string;
  count: number;
}

/** Edge type info derived from actual data. */
export interface EdgeTypeInfo {
  type: string;
  count: number;
}

/** Top-level summary of an ontology — returned by list operations. */
export interface OntologySummary {
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

// --- Learning graph aliases ---
// Preferred names for user-facing code. The Ontology* names are kept for backward compatibility.

export type LearningGraphMetadata = OntologyMetadata;
export type LearningGraphData = OntologyData;
export type LearningGraphSummary = OntologySummary;

// --- Pluggable storage interface ---

/**
 * Any storage backend must implement this interface.
 * The default is JsonFileBackend (JSON files on disk).
 * Future options: SQLite, remote API, etc.
 */
export interface StorageBackend {
  initialize(): Promise<void>;
  listOntologies(): Promise<OntologySummary[]>;
  loadOntology(name: string): Promise<OntologyData>;
  saveOntology(name: string, data: OntologyData): Promise<void>;
  createOntology(name: string, description: string): Promise<OntologyData>;
  deleteOntology(name: string): Promise<void>;
  renameOntology(oldName: string, newName: string): Promise<void>;
  ontologyExists(name: string): Promise<boolean>;
}
