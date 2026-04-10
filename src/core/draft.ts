// ============================================================
// Draft validation for batched imports.
//
// Before an import_nodes call writes events, we validate the batch
// against the current graph state and surface warnings (non-fatal,
// would still commit) and errors (fatal, blocks commit).
//
// The intent: catch dupes, type drift, role-rule violations, and
// broken edge endpoints BEFORE they pollute the graph. The agent
// can review the result and decide to fix or proceed.
//
// This module is pure: takes the existing graph + proposed batch,
// returns a validation result. No IO.
// ============================================================

import type { LearningGraphData, Node } from "./types.js";
import { auditRoles } from "./role-audit.js";

// --- Types ---

export interface ProposedNode {
  type: string;
  properties: Record<string, unknown>;
}

export interface ProposedEdge {
  type: string;
  source: number | string;
  target: number | string;
  properties?: Record<string, unknown>;
}

export type DraftWarningKind =
  | "type_drift"
  | "duplicate_node"
  | "role_violation_procedural"
  | "role_violation_briefing";

export interface DraftWarning {
  kind: DraftWarningKind;
  /** Index into the proposed nodes array, when the warning is about a node */
  nodeIndex?: number;
  /** Index into the proposed edges array, when the warning is about an edge */
  edgeIndex?: number;
  message: string;
  suggestion: string;
}

export type DraftErrorKind =
  | "invalid_edge_source"
  | "invalid_edge_target"
  | "invalid_property_shape"
  | "self_loop_in_proposal";

export interface DraftError {
  kind: DraftErrorKind;
  nodeIndex?: number;
  edgeIndex?: number;
  message: string;
}

export interface DraftResult {
  /** True iff there are no errors. Warnings do not affect this flag. */
  ok: boolean;
  /** Number of nodes that would be added. */
  newNodeCount: number;
  /** Number of edges that would be added. */
  newEdgeCount: number;
  /** Non-fatal observations the agent should review. */
  warnings: DraftWarning[];
  /** Fatal issues that block the commit. */
  errors: DraftError[];
}

// --- Helpers ---

function firstStringValue(properties: Record<string, unknown>): string | null {
  for (const value of Object.values(properties)) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function normalizeType(type: string): string {
  return type.toLowerCase().replace(/[\s_-]/g, "");
}

function isPlainPrimitive(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

function isAcceptableProperty(v: unknown): boolean {
  if (isPlainPrimitive(v)) return true;
  if (Array.isArray(v)) {
    return v.every((item) => isPlainPrimitive(item));
  }
  return false;
}

// --- Type drift detection ---

/**
 * Detect when a proposed node's type is a near-miss of an existing
 * type in the graph. Returns the existing canonical type to prefer.
 *
 * Examples that should match (proposed → canonical):
 *   "service"      → "Service"
 *   "Microservice" → "Service" (only if exact normalize matches)
 *   "Person_Node"  → "PersonNode"
 *
 * Conservative: only flag exact-after-normalization matches. Avoids
 * surprising the user with aggressive substring matching.
 */
function detectTypeDrift(
  proposedType: string,
  existingTypes: Set<string>,
): string | null {
  if (existingTypes.has(proposedType)) return null;
  const normalized = normalizeType(proposedType);
  for (const existing of existingTypes) {
    if (normalizeType(existing) === normalized) {
      return existing;
    }
  }
  return null;
}

// --- Duplicate detection ---

interface ExistingByLabelKey {
  type: string;
  label: string;
  id: string;
}

function indexExistingNodes(nodes: Node[]): Map<string, ExistingByLabelKey> {
  const idx = new Map<string, ExistingByLabelKey>();
  for (const n of nodes) {
    const label = firstStringValue(n.properties);
    if (label === null) continue;
    const key = `${normalizeType(n.type)}::${label.toLowerCase()}`;
    if (!idx.has(key)) {
      idx.set(key, { type: n.type, label, id: n.id });
    }
  }
  return idx;
}

// --- Main entry ---

export function validateProposal(
  graph: LearningGraphData,
  proposedNodes: ProposedNode[],
  proposedEdges: ProposedEdge[] = [],
): DraftResult {
  const warnings: DraftWarning[] = [];
  const errors: DraftError[] = [];

  const existingTypes = new Set(graph.nodes.map((n) => n.type));
  const existingIds = new Set(graph.nodes.map((n) => n.id));
  const existingByLabel = indexExistingNodes(graph.nodes);

  // --- Validate nodes ---

  for (let i = 0; i < proposedNodes.length; i++) {
    const node = proposedNodes[i];

    // Property shape check
    for (const [key, value] of Object.entries(node.properties)) {
      if (!isAcceptableProperty(value)) {
        errors.push({
          kind: "invalid_property_shape",
          nodeIndex: i,
          message: `node[${i}].properties.${key}: must be string, number, boolean, null, or array of those (got ${typeof value})`,
        });
      }
    }

    // Type drift
    const drift = detectTypeDrift(node.type, existingTypes);
    if (drift) {
      warnings.push({
        kind: "type_drift",
        nodeIndex: i,
        message: `node[${i}] uses type "${node.type}" which is similar to existing type "${drift}"`,
        suggestion: `Use "${drift}" instead to keep the graph consistent.`,
      });
    }

    // Duplicate detection
    const label = firstStringValue(node.properties);
    if (label !== null) {
      const key = `${normalizeType(node.type)}::${label.toLowerCase()}`;
      const existing = existingByLabel.get(key);
      if (existing) {
        warnings.push({
          kind: "duplicate_node",
          nodeIndex: i,
          message: `node[${i}] (type=${node.type}, label="${label}") matches existing node ${existing.id}`,
          suggestion: `Use backpack_update_node on ${existing.id} instead, or skip this node.`,
        });
      }
    }
  }

  // --- Three-role rule check ---
  //
  // Reuse the existing auditor by constructing fake Node objects from
  // the proposals. We don't have IDs yet but the auditor only cares
  // about type and properties.

  const fakeNodes: Node[] = proposedNodes.map((p, i) => ({
    id: `proposed-${i}`,
    type: p.type,
    properties: p.properties,
    createdAt: "",
    updatedAt: "",
  }));
  const roleAudit = auditRoles(fakeNodes);
  for (const candidate of roleAudit.proceduralCandidates) {
    const idx = parseInt(candidate.nodeId.replace("proposed-", ""), 10);
    warnings.push({
      kind: "role_violation_procedural",
      nodeIndex: idx,
      message: `node[${idx}] looks procedural: ${candidate.reason}`,
      suggestion: candidate.suggestion,
    });
  }
  for (const candidate of roleAudit.briefingCandidates) {
    const idx = parseInt(candidate.nodeId.replace("proposed-", ""), 10);
    warnings.push({
      kind: "role_violation_briefing",
      nodeIndex: idx,
      message: `node[${idx}] looks briefing-like: ${candidate.reason}`,
      suggestion: candidate.suggestion,
    });
  }

  // --- Validate edges ---

  for (let i = 0; i < proposedEdges.length; i++) {
    const edge = proposedEdges[i];

    // Source resolution
    let sourceValid = false;
    let sourceCanonical: string | number = edge.source;
    if (typeof edge.source === "number") {
      if (
        Number.isInteger(edge.source) &&
        edge.source >= 0 &&
        edge.source < proposedNodes.length
      ) {
        sourceValid = true;
      }
    } else if (typeof edge.source === "string") {
      if (existingIds.has(edge.source)) {
        sourceValid = true;
      }
    }
    if (!sourceValid) {
      errors.push({
        kind: "invalid_edge_source",
        edgeIndex: i,
        message: `edge[${i}].source ${JSON.stringify(edge.source)} is neither a valid index into the proposed nodes nor an existing node ID`,
      });
    }

    // Target resolution
    let targetValid = false;
    let targetCanonical: string | number = edge.target;
    if (typeof edge.target === "number") {
      if (
        Number.isInteger(edge.target) &&
        edge.target >= 0 &&
        edge.target < proposedNodes.length
      ) {
        targetValid = true;
      }
    } else if (typeof edge.target === "string") {
      if (existingIds.has(edge.target)) {
        targetValid = true;
      }
    }
    if (!targetValid) {
      errors.push({
        kind: "invalid_edge_target",
        edgeIndex: i,
        message: `edge[${i}].target ${JSON.stringify(edge.target)} is neither a valid index into the proposed nodes nor an existing node ID`,
      });
    }

    // Self-loop check
    if (
      sourceValid &&
      targetValid &&
      JSON.stringify(sourceCanonical) === JSON.stringify(targetCanonical)
    ) {
      errors.push({
        kind: "self_loop_in_proposal",
        edgeIndex: i,
        message: `edge[${i}] is a self-loop (source === target)`,
      });
    }

    // Edge property shape check
    if (edge.properties) {
      for (const [key, value] of Object.entries(edge.properties)) {
        if (!isAcceptableProperty(value)) {
          errors.push({
            kind: "invalid_property_shape",
            edgeIndex: i,
            message: `edge[${i}].properties.${key}: must be primitive or array of primitives (got ${typeof value})`,
          });
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    newNodeCount: proposedNodes.length,
    newEdgeCount: proposedEdges.length,
    warnings,
    errors,
  };
}
