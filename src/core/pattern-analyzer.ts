// ============================================================
// PatternAnalyzer — deterministic pattern detection on graphs.
//
// Replaces "ask Claude what patterns exist" with scored, typed
// pattern detection. Pure: no I/O, fully testable.
//
// Thresholds (conservative):
//   - Frequency: node appears in 5+ edges (connected to many)
//   - Risk: risk_score > 80th percentile across all nodes
//   - Cost driver: cost score > 1.5× graph average
//   - Gap: process/decision nodes with no owner edge
//   - Mismatch: edges typed VIOLATES or nodes with contract vs actual
// ============================================================

import type {
  Node,
  Edge,
  LearningGraphData,
  PatternAnalysis,
  PatternType,
  DetectedPattern,
  PatternEntity,
} from "./types.js";

// --- Helpers ---

function nodeLabel(node: Node): string {
  for (const v of Object.values(node.properties)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return node.id;
}

function normalizeType(t: string): string {
  return t.toLowerCase().replace(/[-_\s]/g, "");
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((pct / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function severityFromScore(score: number, p50: number, p80: number): DetectedPattern["severity"] {
  if (score >= p80 * 1.5) return "critical";
  if (score >= p80) return "high";
  if (score >= p50) return "medium";
  return "low";
}

/** Build a degree map: nodeId → { in, out, total } */
function buildDegreeMap(
  nodes: Node[],
  edges: Edge[],
): Map<string, { in: number; out: number; total: number }> {
  const map = new Map<string, { in: number; out: number; total: number }>();
  for (const n of nodes) map.set(n.id, { in: 0, out: 0, total: 0 });
  for (const e of edges) {
    const src = map.get(e.sourceId);
    const tgt = map.get(e.targetId);
    if (src) { src.out++; src.total++; }
    if (tgt) { tgt.in++; tgt.total++; }
  }
  return map;
}

// --- Pattern detectors ---

function detectFrequency(
  nodes: Node[],
  edges: Edge[],
  degreeMap: Map<string, { in: number; out: number; total: number }>,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const totals = nodes.map((n) => degreeMap.get(n.id)?.total ?? 0);
  const p80 = percentile(totals, 80);
  const p50 = percentile(totals, 50);

  // Threshold: conservative — must appear in 5+ edges AND above 80th percentile
  const MIN_CONNECTIONS = 5;

  for (const node of nodes) {
    const degree = degreeMap.get(node.id);
    if (!degree) continue;
    if (degree.total < MIN_CONNECTIONS) continue;
    if (degree.total <= p80) continue;

    const score = degree.total / (totals.reduce((a, b) => a + b, 0) / nodes.length || 1);

    patterns.push({
      id: `freq_${node.id}`,
      type: "frequency",
      entities: [{ nodeId: node.id, label: nodeLabel(node), type: node.type, score }],
      reasoning: `"${nodeLabel(node)}" appears in ${degree.total} relationships (${degree.in} incoming, ${degree.out} outgoing) — significantly above average`,
      severity: severityFromScore(degree.total, p50, p80),
      recommendedAction: `Investigate why "${nodeLabel(node)}" is so central. It may be a critical dependency, a bottleneck, or a hub that represents hidden complexity.`,
    });
  }

  return patterns;
}

function detectDependency(
  nodes: Node[],
  edges: Edge[],
  degreeMap: Map<string, { in: number; out: number; total: number }>,
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Risk score: nodes with high out-degree (many dependents) and low in-degree (few providers)
  // = single point of failure candidates
  const riskScores = nodes.map((n) => {
    const d = degreeMap.get(n.id) ?? { in: 0, out: 0, total: 0 };
    return d.out * (d.out + 1) - d.in;
  });
  const p80 = percentile(riskScores, 80);
  const p50 = percentile(riskScores, 50);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const score = riskScores[i];
    if (score <= p80) continue; // conservative: must be above 80th percentile

    const d = degreeMap.get(node.id) ?? { in: 0, out: 0, total: 0 };

    // Find nodes that depend on this one
    const dependents = edges
      .filter((e) => e.sourceId === node.id)
      .map((e) => {
        const dep = nodes.find((n) => n.id === e.targetId);
        return dep ? nodeLabel(dep) : e.targetId;
      });

    patterns.push({
      id: `dep_${node.id}`,
      type: "dependency",
      entities: [{ nodeId: node.id, label: nodeLabel(node), type: node.type, score }],
      reasoning: `"${nodeLabel(node)}" has ${d.out} dependents and only ${d.in} incoming connections — potential single point of failure (dependents: ${dependents.slice(0, 5).join(", ")}${dependents.length > 5 ? "…" : ""})`,
      severity: severityFromScore(score, p50, p80),
      recommendedAction: `Assess whether "${nodeLabel(node)}" has a backup or alternative. If not, it represents a single point of failure.`,
    });
  }

  return patterns;
}

function detectCostDrivers(nodes: Node[]): DetectedPattern[] {
  // Extract numeric cost/amount properties
  type CostEntry = { node: Node; value: number; property: string };
  const entries: CostEntry[] = [];

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.properties)) {
      if (typeof value !== "number") continue;
      const k = key.toLowerCase();
      if (
        k.includes("cost") ||
        k.includes("amount") ||
        k.includes("price") ||
        k.includes("spend") ||
        k.includes("budget") ||
        k.includes("revenue") ||
        k.includes("fee") ||
        k.includes("salary") ||
        k.includes("rate")
      ) {
        entries.push({ node, value, property: key });
        break; // one cost property per node
      }
    }
  }

  if (entries.length < 3) return []; // not enough data to detect patterns

  const avg = entries.reduce((s, e) => s + e.value, 0) / entries.length;
  const patterns: DetectedPattern[] = [];

  for (const entry of entries) {
    const ratio = avg > 0 ? entry.value / avg : 0;
    if (ratio < 1.5) continue; // must be 1.5× above average

    patterns.push({
      id: `cost_${entry.node.id}`,
      type: "cost_driver",
      entities: [
        {
          nodeId: entry.node.id,
          label: nodeLabel(entry.node),
          type: entry.node.type,
          score: ratio,
        },
      ],
      reasoning: `"${nodeLabel(entry.node)}" has ${entry.property}=${entry.value} — ${ratio.toFixed(1)}× the graph average of ${avg.toFixed(0)}`,
      severity: ratio >= 3 ? "critical" : ratio >= 2 ? "high" : "medium",
      recommendedAction: `Review whether "${nodeLabel(entry.node)}" cost is justified. Consider negotiation, consolidation, or replacement.`,
    });
  }

  return patterns;
}

function detectGaps(nodes: Node[], edges: Edge[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Look for process/decision nodes with no ownership edge
  const PROCESS_TYPES = new Set([
    "process",
    "processes",
    "decision",
    "decisions",
    "meeting",
    "meetings",
    "review",
    "reviews",
    "approval",
    "approvals",
    "initiative",
    "initiatives",
    "project",
    "projects",
    "policy",
    "policies",
    "procedure",
    "procedures",
    "risk",
    "risks",
    "issue",
    "issues",
  ]);

  const OWNERSHIP_EDGE_TYPES = new Set([
    "owned_by",
    "ownedby",
    "managed_by",
    "managedby",
    "led_by",
    "ledby",
    "assigned_to",
    "assignedto",
    "responsible_for",
    "responsiblefor",
    "accountable_to",
    "accountableto",
    "reported_to",
    "reportedto",
  ]);

  for (const node of nodes) {
    const norm = normalizeType(node.type);
    if (!PROCESS_TYPES.has(norm)) continue;

    const hasOwner = edges.some(
      (e) =>
        (e.sourceId === node.id || e.targetId === node.id) &&
        OWNERSHIP_EDGE_TYPES.has(normalizeType(e.type)),
    );

    if (!hasOwner) {
      patterns.push({
        id: `gap_${node.id}`,
        type: "gap",
        entities: [
          {
            nodeId: node.id,
            label: nodeLabel(node),
            type: node.type,
            score: 1,
          },
        ],
        reasoning: `"${nodeLabel(node)}" (type=${node.type}) has no ownership edge (OWNED_BY, MANAGED_BY, ASSIGNED_TO, etc.)`,
        severity: "medium",
        recommendedAction: `Assign an owner to "${nodeLabel(node)}". Add an edge like: [Owner] OWNS [${nodeLabel(node)}].`,
      });
    }
  }

  return patterns;
}

function detectMismatches(nodes: Node[], edges: Edge[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Explicit mismatch: edges typed VIOLATES or CONFLICTS_WITH
  const MISMATCH_EDGE_TYPES = new Set([
    "violates",
    "conflicts_with",
    "conflictswith",
    "contradicts",
    "overrides",
    "breaks",
    "breaches",
    "deviates_from",
    "deviatesfrom",
  ]);

  for (const edge of edges) {
    if (!MISMATCH_EDGE_TYPES.has(normalizeType(edge.type))) continue;

    const src = nodes.find((n) => n.id === edge.sourceId);
    const tgt = nodes.find((n) => n.id === edge.targetId);
    if (!src || !tgt) continue;

    patterns.push({
      id: `mismatch_${edge.id}`,
      type: "mismatch",
      entities: [
        { nodeId: src.id, label: nodeLabel(src), type: src.type, score: 1 },
        { nodeId: tgt.id, label: nodeLabel(tgt), type: tgt.type, score: 1 },
      ],
      reasoning: `"${nodeLabel(src)}" ${edge.type} "${nodeLabel(tgt)}" — an explicit conflict or violation exists between these entities`,
      severity: "high",
      recommendedAction: `Investigate the ${edge.type} relationship between "${nodeLabel(src)}" and "${nodeLabel(tgt)}". Resolve the contradiction or document it as an accepted risk.`,
    });
  }

  // Node-level mismatch: properties with "contract" vs "actual" keys that differ
  for (const node of nodes) {
    const contractKeys = Object.keys(node.properties).filter((k) =>
      k.toLowerCase().includes("contract"),
    );
    for (const contractKey of contractKeys) {
      const actualKey = contractKey
        .toLowerCase()
        .replace("contract", "actual");
      const actualVal = Object.entries(node.properties).find(
        ([k]) => k.toLowerCase() === actualKey,
      );
      if (!actualVal) continue;
      if (node.properties[contractKey] === actualVal[1]) continue;

      patterns.push({
        id: `mismatch_node_${node.id}_${contractKey}`,
        type: "mismatch",
        entities: [
          { nodeId: node.id, label: nodeLabel(node), type: node.type, score: 1 },
        ],
        reasoning: `"${nodeLabel(node)}" has ${contractKey}="${node.properties[contractKey]}" but ${actualVal[0]}="${actualVal[1]}" — contract vs actual divergence`,
        severity: "high",
        recommendedAction: `Resolve the discrepancy between contracted and actual values for "${nodeLabel(node)}". This may represent a breach or negotiation point.`,
      });
    }
  }

  return patterns;
}

// --- Main entry ---

export function analyzePatterns(
  graph: LearningGraphData,
  patternTypes: PatternType[] = ["frequency", "dependency", "cost_driver", "gap", "mismatch"],
): PatternAnalysis {
  const { nodes, edges } = graph;
  const degreeMap = buildDegreeMap(nodes, edges);
  const allPatterns: DetectedPattern[] = [];

  if (patternTypes.includes("frequency")) {
    allPatterns.push(...detectFrequency(nodes, edges, degreeMap));
  }
  if (patternTypes.includes("dependency")) {
    allPatterns.push(...detectDependency(nodes, edges, degreeMap));
  }
  if (patternTypes.includes("cost_driver")) {
    allPatterns.push(...detectCostDrivers(nodes));
  }
  if (patternTypes.includes("gap")) {
    allPatterns.push(...detectGaps(nodes, edges));
  }
  if (patternTypes.includes("mismatch")) {
    allPatterns.push(...detectMismatches(nodes, edges));
  }

  // Rank by severity
  const SEVERITY_RANK: Record<DetectedPattern["severity"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  allPatterns.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  const topIssues = allPatterns
    .slice(0, 10)
    .map(
      (p) =>
        `[${p.severity.toUpperCase()}] ${p.type}: ${p.entities.map((e) => e.label).join(", ")} — ${p.reasoning}`,
    );

  const byType = {
    frequency: 0,
    dependency: 0,
    cost_driver: 0,
    gap: 0,
    mismatch: 0,
  } as Record<PatternType, number>;
  for (const p of allPatterns) byType[p.type]++;

  return {
    patterns: allPatterns,
    topIssues,
    summary: {
      nodesAnalyzed: nodes.length,
      edgesAnalyzed: edges.length,
      patternsFound: allPatterns.length,
      byType,
    },
  };
}
