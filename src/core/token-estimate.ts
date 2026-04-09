import type { LearningGraphData } from "./types.js";
import { trackTokenSavings } from "./telemetry.js";

/**
 * Estimate token count from a string using the chars/4 heuristic.
 * Matches tiktoken within ~10% for English text — close enough for a ratio.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate total tokens if the full graph were serialized. */
export function estimateGraphTokens(data: LearningGraphData): number {
  return estimateTokens(JSON.stringify(data));
}

/** Compute savings between full graph cost and actual response cost. */
export function computeSavings(
  graphTokens: number,
  responseTokens: number
): { saved: number; percent: number } {
  if (graphTokens <= 0) return { saved: 0, percent: 0 };
  const saved = Math.max(0, graphTokens - responseTokens);
  const percent = Math.round((saved / graphTokens) * 100);
  return { saved, percent };
}

/** Format a one-line savings footer for MCP tool responses. Also tracks in telemetry. */
export function formatSavingsFooter(
  graphTokens: number,
  responseTokens: number
): string {
  const { saved, percent } = computeSavings(graphTokens, responseTokens);
  if (saved <= 0) return "";
  trackTokenSavings(graphTokens, responseTokens);
  return `📊 Backpack served ~${responseTokens.toLocaleString()} tokens instead of ~${graphTokens.toLocaleString()} (${percent}% reduction vs. full graph)`;
}
