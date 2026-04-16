// ============================================================
// Signal types — the third primitive.
//
// Signals are derived salience: computed from graph structure
// and KB content, persisted to disk, regenerable on demand.
// They answer: "what matters right now and why?"
// ============================================================

import type { LearningGraphData } from "./types.js";
import type { KBDocumentMeta } from "./document-store.js";

// --- Signal kinds ---

/** Structural detectors (no LLM, content-aware graph analysis) */
export type StructuralSignalKind =
  | "type_ratio_imbalance"
  | "missing_relationships"
  | "property_completeness"
  | "underconnected_important"
  | "disconnected_island"
  | "cross_graph_entity"
  | "kb_graph_gap"
  | "coverage_asymmetry";

/** Semantic detectors (LLM-based, v2 placeholder) */
export type SemanticSignalKind =
  | "kb_contradiction"
  | "buried_actionable"
  | "cross_graph_pattern";

export type SignalKind = StructuralSignalKind | SemanticSignalKind;

export type SignalCategory = "structural" | "semantic";

export type SignalSeverity = "critical" | "high" | "medium" | "low";

// --- Core signal data ---

export interface Signal {
  /** Deterministic ID: kind + sorted evidence IDs. Same state = same ID. */
  id: string;
  kind: SignalKind;
  category: SignalCategory;
  severity: SignalSeverity;
  /** One-liner: what matters and why. */
  title: string;
  /** Longer explanation with evidence. */
  description: string;
  /** Node IDs that constitute evidence (viewer highlights these). */
  evidenceNodeIds: string[];
  /** KB document IDs that constitute evidence. */
  evidenceDocIds: string[];
  /** Which graph(s) this signal relates to. Can span multiple. */
  graphNames: string[];
  /** Numeric score for ranking (higher = more important). */
  score: number;
  /** Tags derived from source graphs, node types, and KB doc tags. */
  tags: string[];
}

// --- Persisted file format ---

export interface SignalFile {
  signals: Signal[];
  dismissed: string[];
  config: SignalConfig;
  computedAt: string;
}

export interface SignalConfig {
  /** 0.0 = show nothing, 1.0 = show everything. Default 0.5. */
  sensitivity: number;
  /** Disable specific detector kinds. */
  disabledKinds: SignalKind[];
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  sensitivity: 0.5,
  disabledKinds: [],
};

// --- Detector interface ---

/** Input bundle for per-graph detectors. */
export interface GraphDetectorInput {
  data: LearningGraphData;
  graphName: string;
}

/** Input bundle for cross-cutting detectors. */
export interface CrossCuttingDetectorInput {
  graphs: GraphDetectorInput[];
  docs: KBDocumentMeta[];
}

/** A per-graph detector: runs against one graph at a time. */
export interface GraphSignalDetector {
  kind: SignalKind;
  category: SignalCategory;
  detect(input: GraphDetectorInput, sensitivity: number): Signal[];
}

/** A cross-cutting detector: runs across all graphs + KB docs. */
export interface CrossCuttingSignalDetector {
  kind: SignalKind;
  category: SignalCategory;
  detect(input: CrossCuttingDetectorInput, sensitivity: number): Signal[];
}

// --- Result ---

export interface SignalResult {
  signals: Signal[];
  dismissed: number;
  computedAt: string;
}
