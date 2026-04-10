// ============================================================
// Normalization: detect and consolidate type drift in a graph.
//
// Conventions are enforced at the agent harness level (in skills),
// not at the data layer. This module is the mop-up tool: when an
// agent has already drifted (used "service" alongside "Service",
// or "depends_on" alongside "DEPENDS_ON"), normalization picks the
// dominant variant for each cluster and emits retype events to
// rename the strays.
//
// Pure module: graph in, plan out, events out. No IO.
// ============================================================

import type { LearningGraphData } from "./types.js";
import {
  makeEdgeRetypeEvent,
  makeNodeRetypeEvent,
  type GraphEvent,
} from "./events.js";

// --- Plan types ---

export interface TypeRename {
  /** Type as it currently appears in the graph. */
  from: string;
  /** Canonical type to use. */
  to: string;
  /** Number of nodes/edges that would be renamed. */
  count: number;
}

export interface NormalizationPlan {
  nodeTypeRenames: TypeRename[];
  edgeTypeRenames: TypeRename[];
}

// --- Helpers ---

/**
 * Collapse a type name to a comparison key. Case-insensitive,
 * separator-insensitive. Matches the rule used by draft validation
 * for type drift detection.
 */
function normalizeKey(type: string): string {
  return type.toLowerCase().replace(/[\s_-]/g, "");
}

/**
 * Group strings by their normalized key. Returns clusters where
 * the same key has multiple distinct values.
 */
function clusterByKey(types: Map<string, number>): Map<string, Map<string, number>> {
  const clusters = new Map<string, Map<string, number>>();
  for (const [type, count] of types) {
    const key = normalizeKey(type);
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = new Map();
      clusters.set(key, cluster);
    }
    cluster.set(type, (cluster.get(type) ?? 0) + count);
  }
  return clusters;
}

/**
 * Pick the canonical variant from a cluster of equivalent types.
 * Rule: highest count wins. Ties broken by lexicographic order
 * (deterministic, no surprises across runs).
 */
function pickCanonical(cluster: Map<string, number>): string {
  let best: string | null = null;
  let bestCount = -1;
  for (const [type, count] of cluster) {
    if (
      count > bestCount ||
      (count === bestCount && best !== null && type < best)
    ) {
      best = type;
      bestCount = count;
    }
  }
  return best as string;
}

// --- Planning ---

export function planNormalization(graph: LearningGraphData): NormalizationPlan {
  // Node type counts
  const nodeTypeCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);
  }

  // Edge type counts
  const edgeTypeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) ?? 0) + 1);
  }

  const nodeTypeRenames: TypeRename[] = [];
  for (const cluster of clusterByKey(nodeTypeCounts).values()) {
    if (cluster.size < 2) continue;
    const canonical = pickCanonical(cluster);
    for (const [type, count] of cluster) {
      if (type !== canonical) {
        nodeTypeRenames.push({ from: type, to: canonical, count });
      }
    }
  }

  const edgeTypeRenames: TypeRename[] = [];
  for (const cluster of clusterByKey(edgeTypeCounts).values()) {
    if (cluster.size < 2) continue;
    const canonical = pickCanonical(cluster);
    for (const [type, count] of cluster) {
      if (type !== canonical) {
        edgeTypeRenames.push({ from: type, to: canonical, count });
      }
    }
  }

  // Stable sort: most-impactful first, then alphabetically by 'from'
  nodeTypeRenames.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
  edgeTypeRenames.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));

  return { nodeTypeRenames, edgeTypeRenames };
}

// --- Event generation ---

/**
 * Convert a normalization plan into the events that would apply it.
 * For each node/edge whose current type matches a `from` in the plan,
 * emit a retype event to its `to` value.
 */
export function eventsForPlan(
  graph: LearningGraphData,
  plan: NormalizationPlan,
  author?: string,
): GraphEvent[] {
  const nodeTypeMap = new Map<string, string>();
  for (const r of plan.nodeTypeRenames) nodeTypeMap.set(r.from, r.to);

  const edgeTypeMap = new Map<string, string>();
  for (const r of plan.edgeTypeRenames) edgeTypeMap.set(r.from, r.to);

  const events: GraphEvent[] = [];

  for (const node of graph.nodes) {
    const newType = nodeTypeMap.get(node.type);
    if (newType !== undefined && newType !== node.type) {
      events.push(makeNodeRetypeEvent(node.id, newType, author));
    }
  }

  for (const edge of graph.edges) {
    const newType = edgeTypeMap.get(edge.type);
    if (newType !== undefined && newType !== edge.type) {
      events.push(makeEdgeRetypeEvent(edge.id, newType, author));
    }
  }

  return events;
}

// --- Convenience: total counts for the plan ---

export function planSummary(plan: NormalizationPlan): {
  nodeRenameCount: number;
  edgeRenameCount: number;
  totalAffectedNodes: number;
  totalAffectedEdges: number;
} {
  return {
    nodeRenameCount: plan.nodeTypeRenames.length,
    edgeRenameCount: plan.edgeTypeRenames.length,
    totalAffectedNodes: plan.nodeTypeRenames.reduce((s, r) => s + r.count, 0),
    totalAffectedEdges: plan.edgeTypeRenames.reduce((s, r) => s + r.count, 0),
  };
}
