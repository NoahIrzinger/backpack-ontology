// ============================================================
// Recommendation formatter — generates structured PriorityBriefing
// from pattern analysis results.
//
// Enforced output structure: top issues, quick wins, strategic
// moves, watch list. Pure: no I/O.
// ============================================================

import type { PatternAnalysis, DetectedPattern } from "./types.js";

// --- Output types ---

export interface TopIssue {
  rank: number;
  issueTitle: string;
  whyItMatters: string;
  rootCauses: string[];
  recommendedAction: string;
  effortEstimate: "high" | "medium" | "low";
  expectedOutcome: string;
}

export interface QuickWin {
  action: string;
  expectedOutcome: string;
  effort: "low" | "medium";
}

export interface StrategicMove {
  opportunity: string;
  whyItMatters: string;
}

export interface WatchItem {
  situation: string;
  reason: string;
}

export interface PriorityBriefing {
  generatedAt: string;
  topIssues: TopIssue[];
  quickWins: QuickWin[];
  strategicMoves: StrategicMove[];
  watchList: WatchItem[];
  summary: {
    patternsAnalyzed: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
}

// --- Effort estimation ---

function estimateEffort(pattern: DetectedPattern): "high" | "medium" | "low" {
  // Cost drivers and dependency risks usually take significant effort to fix
  if (pattern.type === "cost_driver" || pattern.type === "dependency") {
    return pattern.severity === "critical" ? "high" : "medium";
  }
  // Gaps (missing owners) are usually quick process fixes
  if (pattern.type === "gap") return "low";
  // Mismatches vary
  if (pattern.type === "mismatch") return "medium";
  // Frequency patterns usually indicate needed architectural changes
  if (pattern.type === "frequency") {
    return pattern.severity === "critical" ? "high" : "medium";
  }
  return "medium";
}

function expectedOutcome(pattern: DetectedPattern): string {
  switch (pattern.type) {
    case "frequency":
      return `Reduced complexity and clearer ownership around ${pattern.entities[0]?.label ?? "this entity"}`;
    case "dependency":
      return `Eliminated single point of failure — continuity risk reduced`;
    case "cost_driver":
      return `Cost reduction or improved justification for spend`;
    case "gap":
      return `Clear ownership established — decisions and processes no longer fall through the cracks`;
    case "mismatch":
      return `Contradiction resolved — contract and reality aligned`;
    default:
      return "Improved clarity and reduced operational risk";
  }
}

function whyItMatters(pattern: DetectedPattern): string {
  const entityLabels = pattern.entities
    .slice(0, 2)
    .map((e) => e.label)
    .join(" and ");
  switch (pattern.type) {
    case "frequency":
      return `${entityLabels} appears in too many places — a sign of hidden complexity or an undocumented dependency that could cause cascading failures`;
    case "dependency":
      return `${entityLabels} is a single point of failure — if it fails or leaves, ${pattern.entities[0]?.score?.toFixed(0) ?? "multiple"} things break`;
    case "cost_driver":
      return `${entityLabels} is driving disproportionate cost (${(pattern.entities[0]?.score ?? 0).toFixed(1)}× the average)`;
    case "gap":
      return `${entityLabels} has no owner — decisions stall, problems go unresolved, accountability is unclear`;
    case "mismatch":
      return `${entityLabels} — what was contracted or agreed differs from what's actually happening`;
    default:
      return pattern.reasoning;
  }
}

// --- Main entry ---

export function generatePriorityBriefing(analysis: PatternAnalysis): PriorityBriefing {
  const { patterns } = analysis;

  const SEVERITY_RANK: Record<DetectedPattern["severity"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const sorted = [...patterns].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  // Top issues: critical + high severity patterns, max 5
  const topPatterns = sorted.filter(
    (p) => p.severity === "critical" || p.severity === "high",
  ).slice(0, 5);

  const topIssues: TopIssue[] = topPatterns.map((p, i) => ({
    rank: i + 1,
    issueTitle: `${p.entities.map((e) => e.label).join(" / ")} — ${p.type.replace(/_/g, " ")}`,
    whyItMatters: whyItMatters(p),
    rootCauses: [p.reasoning],
    recommendedAction: p.recommendedAction,
    effortEstimate: estimateEffort(p),
    expectedOutcome: expectedOutcome(p),
  }));

  // Quick wins: low-effort patterns (gaps + low-severity mismatches)
  const quickWinPatterns = sorted.filter(
    (p) =>
      (p.type === "gap" && p.severity !== "critical") ||
      (p.type === "mismatch" && p.severity === "medium") ||
      estimateEffort(p) === "low",
  ).slice(0, 5);

  const quickWins: QuickWin[] = quickWinPatterns.map((p) => ({
    action: p.recommendedAction,
    expectedOutcome: expectedOutcome(p),
    effort: estimateEffort(p) === "high" ? "medium" : estimateEffort(p) as "low" | "medium",
  }));

  // Strategic moves: medium-severity frequency patterns — indicate deeper opportunities
  const strategicPatterns = sorted.filter(
    (p) =>
      (p.type === "frequency" && (p.severity === "medium" || p.severity === "low")) ||
      (p.type === "dependency" && p.severity === "medium"),
  ).slice(0, 4);

  const strategicMoves: StrategicMove[] = strategicPatterns.map((p) => ({
    opportunity: `Restructure around ${p.entities.map((e) => e.label).join(", ")}`,
    whyItMatters: whyItMatters(p),
  }));

  // Watch list: low-severity patterns — emerging, not yet critical
  const watchPatterns = sorted.filter((p) => p.severity === "low").slice(0, 5);

  const watchList: WatchItem[] = watchPatterns.map((p) => ({
    situation: `${p.entities.map((e) => e.label).join(", ")} — ${p.type.replace(/_/g, " ")}`,
    reason: p.reasoning,
  }));

  return {
    generatedAt: new Date().toISOString(),
    topIssues,
    quickWins,
    strategicMoves,
    watchList,
    summary: {
      patternsAnalyzed: patterns.length,
      criticalCount: patterns.filter((p) => p.severity === "critical").length,
      highCount: patterns.filter((p) => p.severity === "high").length,
      mediumCount: patterns.filter((p) => p.severity === "medium").length,
      lowCount: patterns.filter((p) => p.severity === "low").length,
    },
  };
}
