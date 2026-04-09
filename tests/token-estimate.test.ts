import { describe, it, expect } from "vitest";
import { estimateTokens, estimateGraphTokens, computeSavings, formatSavingsFooter } from "../src/core/token-estimate.js";
import type { LearningGraphData } from "../src/core/types.js";

function makeGraph(nodeCount: number, edgeCount: number): LearningGraphData {
  const now = new Date().toISOString();
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n_${i}`,
    type: "Thing",
    properties: { name: `Node ${i}`, value: i * 10 },
    createdAt: now,
    updatedAt: now,
  }));
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    id: `e_${i}`,
    type: "RELATES_TO",
    sourceId: `n_${i % nodeCount}`,
    targetId: `n_${(i + 1) % nodeCount}`,
    properties: {},
    createdAt: now,
    updatedAt: now,
  }));
  return {
    metadata: { name: "test", description: "Test graph", createdAt: now, updatedAt: now },
    nodes,
    edges,
  };
}

describe("estimateTokens", () => {
  it("returns ceil(length / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });

  it("handles unicode", () => {
    // JS string length counts UTF-16 code units
    const emoji = "👋🌍"; // 4 code units
    expect(estimateTokens(emoji)).toBe(Math.ceil(emoji.length / 4));
  });
});

describe("estimateGraphTokens", () => {
  it("returns positive number for non-empty graph", () => {
    const graph = makeGraph(10, 15);
    const tokens = estimateGraphTokens(graph);
    expect(tokens).toBeGreaterThan(0);
  });

  it("returns small number for empty graph", () => {
    const graph = makeGraph(0, 0);
    const tokens = estimateGraphTokens(graph);
    expect(tokens).toBeGreaterThan(0); // metadata still has content
    expect(tokens).toBeLessThan(100);
  });

  it("scales with graph size", () => {
    const small = estimateGraphTokens(makeGraph(5, 5));
    const large = estimateGraphTokens(makeGraph(50, 50));
    expect(large).toBeGreaterThan(small);
  });
});

describe("computeSavings", () => {
  it("computes correct savings", () => {
    const result = computeSavings(1000, 100);
    expect(result.saved).toBe(900);
    expect(result.percent).toBe(90);
  });

  it("handles zero graph tokens", () => {
    const result = computeSavings(0, 100);
    expect(result.saved).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("handles response larger than graph", () => {
    const result = computeSavings(100, 200);
    expect(result.saved).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("handles equal values", () => {
    const result = computeSavings(500, 500);
    expect(result.saved).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("handles negative graph tokens", () => {
    const result = computeSavings(-10, 5);
    expect(result.saved).toBe(0);
    expect(result.percent).toBe(0);
  });
});

describe("formatSavingsFooter", () => {
  it("returns non-empty string when savings exist", () => {
    const footer = formatSavingsFooter(10000, 100);
    expect(footer).toContain("100");
    expect(footer).toContain("10,000");
    expect(footer).toContain("99%");
  });

  it("returns empty string when no savings", () => {
    expect(formatSavingsFooter(100, 200)).toBe("");
    expect(formatSavingsFooter(0, 0)).toBe("");
    expect(formatSavingsFooter(100, 100)).toBe("");
  });
});
