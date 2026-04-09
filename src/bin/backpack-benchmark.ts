#!/usr/bin/env node

import { Backpack } from "../core/backpack.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { estimateTokens, estimateGraphTokens } from "../core/token-estimate.js";

interface GraphResult {
  name: string;
  nodes: number;
  edges: number;
  fullTokens: number;
  describe: number;
  search: number;
  searchResults: number;
  getNode: number;
  getNeighbors: number;
  listNodes: number;
  nodeTypes: number;
}

function pct(response: number, full: number): number {
  if (full <= 0) return 0;
  return Math.round((1 - response / full) * 100);
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(nums: number[]): number {
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function tok(response: string): number {
  return estimateTokens(JSON.stringify(JSON.parse(response), null, 2));
}

function pad(s: string, n: number, align: "left" | "right" = "left"): string {
  return align === "right" ? s.padStart(n) : s.padEnd(n);
}

/** Pick a search term from the graph — first word of first node's first string property. */
function pickSearchTerm(backpackApi: Backpack, data: any): string {
  for (const node of data.nodes) {
    for (const val of Object.values(node.properties)) {
      if (typeof val === "string" && val.length > 2) {
        const word = val.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
        if (word.length >= 3) return word;
      }
    }
  }
  return data.nodes[0]?.type?.toLowerCase() ?? "test";
}

/** Pick the median-connectivity node. */
function pickMedianNode(data: any): string {
  const edgeCounts = new Map<string, number>();
  for (const n of data.nodes) edgeCounts.set(n.id, 0);
  for (const e of data.edges) {
    edgeCounts.set(e.sourceId, (edgeCounts.get(e.sourceId) ?? 0) + 1);
    edgeCounts.set(e.targetId, (edgeCounts.get(e.targetId) ?? 0) + 1);
  }
  const sorted = [...edgeCounts.entries()].sort((a, b) => a[1] - b[1]);
  return sorted[Math.floor(sorted.length / 2)][0];
}

async function run() {
  const bp = new Backpack(new JsonFileBackend());
  await bp.initialize();

  const summaries = await bp.listOntologies();
  const results: GraphResult[] = [];
  let skipped = 0;

  for (const summary of summaries) {
    if (summary.nodeCount === 0) {
      skipped++;
      continue;
    }

    const name = summary.name;
    process.stderr.write(`  benchmarking ${name}...\n`);

    try {

    const graphTokens = await bp.getGraphTokens(name);

    // Load raw data for search term and node selection
    const graph = await (bp as any).getGraph(name);
    const data = graph.data;

    // describe
    const desc = await bp.describeOntology(name);
    const descTokens = estimateTokens(JSON.stringify(desc, null, 2));

    // node_types
    const types = await bp.getNodeTypes(name);
    const typesTokens = estimateTokens(JSON.stringify(types, null, 2));

    // list_nodes (page of 20)
    const list = await bp.listNodes(name, undefined, 20, 0);
    const listTokens = estimateTokens(JSON.stringify(list, null, 2));

    // search
    const searchTerm = pickSearchTerm(bp, data);
    const searchResults = await bp.searchNodes(name, searchTerm);
    const searchTokens = estimateTokens(JSON.stringify(searchResults, null, 2));

    // get_node (median connectivity node)
    const nodeId = pickMedianNode(data);
    const nodeResult = await bp.getNode(name, nodeId);
    const nodeTokens = estimateTokens(JSON.stringify(nodeResult, null, 2));

    // get_neighbors
    const neighbors = await bp.getNeighbors(name, nodeId, undefined, "both", 1);
    const neighborsTokens = estimateTokens(JSON.stringify(neighbors, null, 2));

    results.push({
      name,
      nodes: summary.nodeCount,
      edges: summary.edgeCount,
      fullTokens: graphTokens,
      describe: descTokens,
      search: searchTokens,
      searchResults: searchResults.length,
      getNode: nodeTokens,
      getNeighbors: neighborsTokens,
      listNodes: listTokens,
      nodeTypes: typesTokens,
    });
    } catch (err) {
      process.stderr.write(`  skipped ${name}: ${(err as Error).message}\n`);
      skipped++;
    }
  }

  // Sort by node count
  results.sort((a, b) => a.nodes - b.nodes);

  console.log("");
  console.log("Backpack Token Efficiency Benchmark");
  console.log("====================================");
  console.log(`Graphs: ${results.length} (skipped ${skipped} empty)`);
  console.log("");

  // --- Per-graph token counts ---
  console.log("Per-graph token counts:");
  const nameW = Math.max(12, ...results.map((r) => r.name.length)) + 2;
  const hdr1 = [
    pad("Graph", nameW),
    pad("Nodes", 7, "right"),
    pad("Edges", 7, "right"),
    pad("Full", 8, "right"),
    pad("describe", 10, "right"),
    pad("search", 10, "right"),
    pad("get_node", 10, "right"),
    pad("neighbors", 11, "right"),
    pad("list_20", 9, "right"),
    pad("types", 8, "right"),
  ].join(" ");
  console.log(hdr1);
  console.log("-".repeat(hdr1.length));
  for (const r of results) {
    console.log(
      [
        pad(r.name, nameW),
        pad(String(r.nodes), 7, "right"),
        pad(String(r.edges), 7, "right"),
        pad(r.fullTokens.toLocaleString(), 8, "right"),
        pad(r.describe.toLocaleString(), 10, "right"),
        pad(`${r.search.toLocaleString()} (${r.searchResults})`, 10, "right"),
        pad(r.getNode.toLocaleString(), 10, "right"),
        pad(r.getNeighbors.toLocaleString(), 11, "right"),
        pad(r.listNodes.toLocaleString(), 9, "right"),
        pad(r.nodeTypes.toLocaleString(), 8, "right"),
      ].join(" ")
    );
  }
  console.log("");

  // --- Per-graph reduction percentages ---
  console.log("Token reduction vs. full graph:");
  const hdr2 = [
    pad("Graph", nameW),
    pad("describe", 10, "right"),
    pad("search", 8, "right"),
    pad("get_node", 10, "right"),
    pad("neighbors", 11, "right"),
    pad("list_20", 9, "right"),
    pad("types", 7, "right"),
  ].join(" ");
  console.log(hdr2);
  console.log("-".repeat(hdr2.length));
  for (const r of results) {
    console.log(
      [
        pad(r.name, nameW),
        pad(pct(r.describe, r.fullTokens) + "%", 10, "right"),
        pad(pct(r.search, r.fullTokens) + "%", 8, "right"),
        pad(pct(r.getNode, r.fullTokens) + "%", 10, "right"),
        pad(pct(r.getNeighbors, r.fullTokens) + "%", 11, "right"),
        pad(pct(r.listNodes, r.fullTokens) + "%", 9, "right"),
        pad(pct(r.nodeTypes, r.fullTokens) + "%", 7, "right"),
      ].join(" ")
    );
  }
  console.log("");

  // --- Aggregate stats ---
  const ops = [
    { name: "describe", values: results.map((r) => pct(r.describe, r.fullTokens)) },
    { name: "search", values: results.map((r) => pct(r.search, r.fullTokens)) },
    { name: "get_node", values: results.map((r) => pct(r.getNode, r.fullTokens)) },
    { name: "neighbors", values: results.map((r) => pct(r.getNeighbors, r.fullTokens)) },
    { name: "list_20", values: results.map((r) => pct(r.listNodes, r.fullTokens)) },
    { name: "node_types", values: results.map((r) => pct(r.nodeTypes, r.fullTokens)) },
  ];

  console.log(`Aggregate (across ${results.length} graphs):`);
  const hdr3 = [
    pad("Operation", 12),
    pad("Min", 5, "right"),
    pad("Max", 5, "right"),
    pad("Median", 8, "right"),
    pad("Mean", 6, "right"),
  ].join(" ");
  console.log(hdr3);
  console.log("-".repeat(hdr3.length));
  for (const op of ops) {
    const sorted = [...op.values].sort((a, b) => a - b);
    console.log(
      [
        pad(op.name, 12),
        pad(Math.min(...op.values) + "%", 5, "right"),
        pad(Math.max(...op.values) + "%", 5, "right"),
        pad(median(op.values) + "%", 8, "right"),
        pad(mean(op.values) + "%", 6, "right"),
      ].join(" ")
    );
  }
  console.log("");

  // --- Typical interaction ---
  const typicalReductions = results.map((r) => {
    const interaction = r.describe + r.search + r.getNode;
    return pct(interaction, r.fullTokens);
  });
  console.log("Typical interaction (describe + search + get_node):");
  console.log(
    `  Median reduction: ${median(typicalReductions)}%  |  Range: ${Math.min(...typicalReductions)}%–${Math.max(...typicalReductions)}%`
  );
  console.log("");
}

run().catch((err) => {
  console.error("Benchmark failed:", err.message);
  process.exit(1);
});
