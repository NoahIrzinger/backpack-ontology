// ============================================================
// Signal detectors — content-aware, contextual descriptions.
//
// Every signal description names actual entities, properties,
// and relationships from the graph. No generic messages.
// ============================================================

import type { Node, Edge, LearningGraphData } from "./types.js";
import type {
  Signal,
  SignalSeverity,
  GraphSignalDetector,
  CrossCuttingSignalDetector,
  GraphDetectorInput,
  CrossCuttingDetectorInput,
} from "./signal-types.js";

// --- Helpers ---

function nodeLabel(node: Node): string {
  for (const v of Object.values(node.properties)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return node.id;
}

function makeSignalId(kind: string, ...parts: string[]): string {
  return `${kind}:${[...parts].sort().join(",")}`;
}

function normalizeType(t: string): string {
  return t.toLowerCase().replace(/[-_\s]+/g, "");
}

/** Join labels with Oxford comma: "A, B, and C" */
function listLabels(nodes: Node[], max: number): string {
  const labels = nodes.slice(0, max).map(nodeLabel);
  const remaining = nodes.length - max;
  if (labels.length === 1) return `"${labels[0]}"`;
  if (labels.length === 2) return `"${labels[0]}" and "${labels[1]}"`;
  let str = labels.map((l) => `"${l}"`).join(", ");
  if (remaining > 0) str += `, and ${remaining} more`;
  return str;
}

/** Extract a notable property value from a node (cost, revenue, etc) */
function notableProperty(node: Node): string | null {
  for (const [key, val] of Object.entries(node.properties)) {
    const k = key.toLowerCase();
    if (typeof val === "number" && (k.includes("cost") || k.includes("revenue") || k.includes("amount") || k.includes("price") || k.includes("fee") || k.includes("budget"))) {
      return `${key}: ${val}`;
    }
    if (typeof val === "string" && val.length > 0 && val.length < 100 && (k.includes("priority") || k.includes("status") || k.includes("severity") || k.includes("impact"))) {
      return `${key}: ${val}`;
    }
  }
  return null;
}

const PROBLEM_TYPES = new Set([
  "painpoint", "pain", "problem", "risk", "riskfactor", "weakness",
  "challenge", "threat", "constraint", "issue", "blocker", "gap",
  "vulnerability", "concern",
]);
const SOLUTION_TYPES = new Set([
  "opportunity", "recommendation", "strength", "mitigation",
  "solution", "strategy", "action", "initiative", "improvement",
  "fix", "proposal",
]);

function isProblemType(type: string): boolean {
  return PROBLEM_TYPES.has(normalizeType(type));
}
function isSolutionType(type: string): boolean {
  return SOLUTION_TYPES.has(normalizeType(type));
}

const IMPORTANCE_KEYS = ["cost", "revenue", "budget", "amount", "price",
  "priority", "deadline", "risk", "impact", "value", "salary", "fee"];

// --- Per-graph detectors ---

export const typeRatioDetector: GraphSignalDetector = {
  kind: "type_ratio_imbalance" as any,
  category: "structural",
  detect({ data, graphName }, sensitivity) {
    const { nodes } = data;
    if (nodes.length < 5) return [];

    const problems = nodes.filter((n) => isProblemType(n.type));
    const solutions = nodes.filter((n) => isSolutionType(n.type));

    if (problems.length === 0 && solutions.length === 0) return [];

    if (problems.length >= 3 && solutions.length === 0) {
      const problemLabels = listLabels(problems, 5);
      return [{
        id: makeSignalId("type_ratio_imbalance", graphName, "no_solutions"),
        kind: "type_ratio_imbalance" as any,
        category: "structural",
        severity: "high" as SignalSeverity,
        title: `${problems.length} problems but no solutions or opportunities`,
        description: `Problems identified: ${problemLabels}. None of these have corresponding opportunity, recommendation, or mitigation nodes. What actions address these? Consider adding solution-type nodes and connecting them to the problems they solve.`,
        evidenceNodeIds: problems.map((n) => n.id),
        evidenceDocIds: [],
        graphNames: [graphName],
        score: problems.length,
        tags: [],
      }];
    }

    if (problems.length === 0 || solutions.length === 0) return [];

    const ratio = problems.length / solutions.length;
    const threshold = 3 - sensitivity * 2;

    if (ratio >= threshold) {
      // Find problems with no edge to any solution node
      const solutionIds = new Set(solutions.map((n) => n.id));
      const unaddressed = problems.filter((p) => {
        return !data.edges.some((e) =>
          (e.sourceId === p.id && solutionIds.has(e.targetId)) ||
          (e.targetId === p.id && solutionIds.has(e.sourceId)),
        );
      });

      const problemLabels = listLabels(problems, 4);
      const solutionLabels = listLabels(solutions, 3);
      const unaddressedLabels = unaddressed.length > 0
        ? ` Specifically, ${listLabels(unaddressed, 3)} ${unaddressed.length === 1 ? "has" : "have"} no connection to any solution node.`
        : "";

      return [{
        id: makeSignalId("type_ratio_imbalance", graphName),
        kind: "type_ratio_imbalance" as any,
        category: "structural",
        severity: ratio >= 4 ? "high" : "medium",
        title: `${problems.length} problems vs ${solutions.length} solutions — gap in coverage`,
        description: `Problems: ${problemLabels}. Solutions: ${solutionLabels}.${unaddressedLabels}`,
        evidenceNodeIds: [...problems.map((n) => n.id), ...solutions.map((n) => n.id)],
        evidenceDocIds: [],
        graphNames: [graphName],
        score: ratio,
        tags: [],
      }];
    }

    return [];
  },
};

export const missingRelationshipsDetector: GraphSignalDetector = {
  kind: "missing_relationships" as any,
  category: "structural",
  detect({ data, graphName }, sensitivity) {
    const { nodes, edges } = data;
    if (nodes.length < 6) return [];

    const typeCounts = new Map<string, Node[]>();
    for (const n of nodes) {
      if (!typeCounts.has(n.type)) typeCounts.set(n.type, []);
      typeCounts.get(n.type)!.push(n);
    }

    const significantTypes = [...typeCounts.entries()]
      .filter(([, ns]) => ns.length >= 2)
      .map(([t]) => t);

    if (significantTypes.length < 2) return [];

    const typePairs = new Map<string, number>();
    for (const e of edges) {
      const srcNode = nodes.find((n) => n.id === e.sourceId);
      const tgtNode = nodes.find((n) => n.id === e.targetId);
      if (!srcNode || !tgtNode || srcNode.type === tgtNode.type) continue;
      const key = [srcNode.type, tgtNode.type].sort().join("|");
      typePairs.set(key, (typePairs.get(key) ?? 0) + 1);
    }

    const signals: Signal[] = [];
    for (let i = 0; i < significantTypes.length; i++) {
      for (let j = i + 1; j < significantTypes.length; j++) {
        const key = [significantTypes[i], significantTypes[j]].sort().join("|");
        if (typePairs.has(key)) continue;

        const typeA = significantTypes[i];
        const typeB = significantTypes[j];
        const groupA = typeCounts.get(typeA)!;
        const groupB = typeCounts.get(typeB)!;

        const minCount = Math.max(2, Math.round(3 - sensitivity * 2));
        if (groupA.length < minCount || groupB.length < minCount) continue;
        if (groupA.length + groupB.length < 5) continue;

        const labelsA = listLabels(groupA, 3);
        const labelsB = listLabels(groupB, 3);

        signals.push({
          id: makeSignalId("missing_relationships", graphName, typeA, typeB),
          kind: "missing_relationships" as any,
          category: "structural",
          severity: "medium",
          title: `No connections between "${typeA}" and "${typeB}"`,
          description: `${typeA} nodes (${labelsA}) and ${typeB} nodes (${labelsB}) have no edges between them. Do any of these ${typeA} entities relate to these ${typeB} entities? If so, those relationships are missing from the graph.`,
          evidenceNodeIds: [
            ...groupA.slice(0, 3).map((n) => n.id),
            ...groupB.slice(0, 3).map((n) => n.id),
          ],
          evidenceDocIds: [],
          graphNames: [graphName],
          score: (groupA.length + groupB.length) * 0.5,
          tags: [],
        });
      }
    }

    return signals.sort((a, b) => b.score - a.score).slice(0, 5);
  },
};

export const propertyCompletenessDetector: GraphSignalDetector = {
  kind: "property_completeness" as any,
  category: "structural",
  detect({ data, graphName }, sensitivity) {
    const { nodes } = data;
    if (nodes.length < 6) return [];

    const typeCounts = new Map<string, Node[]>();
    for (const n of nodes) {
      if (!typeCounts.has(n.type)) typeCounts.set(n.type, []);
      typeCounts.get(n.type)!.push(n);
    }

    const signals: Signal[] = [];

    for (const [type, group] of typeCounts) {
      if (group.length < 3) continue;

      const propCounts = new Map<string, number>();
      for (const node of group) {
        for (const key of Object.keys(node.properties)) {
          propCounts.set(key, (propCounts.get(key) ?? 0) + 1);
        }
      }

      for (const [prop, count] of propCounts) {
        const missing = group.length - count;
        const coverage = count / group.length;
        const coverageThreshold = 0.5 + (1 - sensitivity) * 0.3;

        if (coverage >= coverageThreshold && missing >= 1 && coverage < 1) {
          const missingNodes = group.filter((n) => !(prop in n.properties));
          const completeNodes = group.filter((n) => prop in n.properties);
          const missingLabels = listLabels(missingNodes, 3);

          // Show example values from complete nodes
          const exampleValues: string[] = [];
          for (const cn of completeNodes.slice(0, 2)) {
            const val = cn.properties[prop];
            if (val !== undefined && val !== null && String(val).length < 60) {
              exampleValues.push(`${nodeLabel(cn)}: "${val}"`);
            }
          }
          const exampleStr = exampleValues.length > 0
            ? ` Other ${type} nodes have this property (${exampleValues.join("; ")}).`
            : "";

          signals.push({
            id: makeSignalId("property_completeness", graphName, type, prop),
            kind: "property_completeness" as any,
            category: "structural",
            severity: missing >= 3 ? "medium" : "low",
            title: `${missing} of ${group.length} "${type}" nodes missing "${prop}"`,
            description: `${missingLabels} ${missing === 1 ? "is" : "are"} missing the "${prop}" property that ${count} other "${type}" nodes have.${exampleStr}`,
            evidenceNodeIds: missingNodes.map((n) => n.id),
            evidenceDocIds: [],
            graphNames: [graphName],
            score: missing,
            tags: [],
          });
        }
      }
    }

    return signals.sort((a, b) => b.score - a.score).slice(0, 5);
  },
};

export const underconnectedImportantDetector: GraphSignalDetector = {
  kind: "underconnected_important" as any,
  category: "structural",
  detect({ data, graphName }, sensitivity) {
    const { nodes, edges } = data;
    if (nodes.length < 5) return [];

    const degreeMap = new Map<string, number>();
    for (const n of nodes) degreeMap.set(n.id, 0);
    for (const e of edges) {
      degreeMap.set(e.sourceId, (degreeMap.get(e.sourceId) ?? 0) + 1);
      degreeMap.set(e.targetId, (degreeMap.get(e.targetId) ?? 0) + 1);
    }

    const avgDegree = [...degreeMap.values()].reduce((a, b) => a + b, 0) / nodes.length || 1;
    const signals: Signal[] = [];

    for (const node of nodes) {
      const degree = degreeMap.get(node.id) ?? 0;
      if (degree >= avgDegree * 0.5) continue;

      const importantProps: string[] = [];
      for (const key of Object.keys(node.properties)) {
        const k = key.toLowerCase();
        if (IMPORTANCE_KEYS.some((ik) => k.includes(ik))) {
          importantProps.push(key);
        }
      }
      const nt = normalizeType(node.type);
      if (isProblemType(node.type) || isSolutionType(node.type) ||
          nt.includes("decision") || nt.includes("deadline") || nt.includes("budget")) {
        importantProps.push(node.type);
      }

      if (importantProps.length === 0) continue;

      const label = nodeLabel(node);
      const notable = notableProperty(node);
      const notableStr = notable ? ` It has ${notable}.` : "";

      // Find what few connections it does have
      const connectedLabels: string[] = [];
      for (const e of edges) {
        if (e.sourceId === node.id || e.targetId === node.id) {
          const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
          const other = nodes.find((n) => n.id === otherId);
          if (other) connectedLabels.push(`"${nodeLabel(other)}" (${e.type})`);
        }
      }
      const connectionStr = connectedLabels.length > 0
        ? ` Currently connected to: ${connectedLabels.slice(0, 3).join(", ")}.`
        : " Currently has no connections at all.";

      signals.push({
        id: makeSignalId("underconnected_important", node.id),
        kind: "underconnected_important" as any,
        category: "structural",
        severity: degree === 0 ? "high" : "medium",
        title: `"${label}" (${node.type}) looks important but has ${degree === 0 ? "no" : "only " + degree} connection${degree !== 1 ? "s" : ""}`,
        description: `"${label}" is a ${node.type} node with properties suggesting importance (${importantProps.join(", ")}).${notableStr}${connectionStr} What else does this entity relate to, depend on, or affect?`,
        evidenceNodeIds: [node.id],
        evidenceDocIds: [],
        graphNames: [graphName],
        score: importantProps.length + (1 / (degree + 1)),
        tags: [],
      });
    }

    return signals.sort((a, b) => b.score - a.score).slice(0, 5);
  },
};

export const disconnectedIslandsDetector: GraphSignalDetector = {
  kind: "disconnected_island" as any,
  category: "structural",
  detect({ data, graphName }, sensitivity) {
    const { nodes, edges } = data;
    if (nodes.length < 6) return [];

    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
      adj.get(e.sourceId)?.push(e.targetId);
      adj.get(e.targetId)?.push(e.sourceId);
    }
    const comp = new Map<string, number>();
    let compId = 0;
    for (const n of nodes) {
      if (comp.has(n.id)) continue;
      const queue = [n.id];
      while (queue.length > 0) {
        const cur = queue.pop()!;
        if (comp.has(cur)) continue;
        comp.set(cur, compId);
        for (const nb of adj.get(cur) ?? []) {
          if (!comp.has(nb)) queue.push(nb);
        }
      }
      compId++;
    }

    const clusters = new Map<number, Node[]>();
    for (const node of nodes) {
      const c = comp.get(node.id) ?? 0;
      if (!clusters.has(c)) clusters.set(c, []);
      clusters.get(c)!.push(node);
    }

    if (clusters.size <= 1) return [];

    let largestSize = 0;
    for (const group of clusters.values()) {
      if (group.length > largestSize) largestSize = group.length;
    }

    const signals: Signal[] = [];
    const minIslandSize = Math.max(2, Math.round(4 - sensitivity * 3));

    for (const [, group] of clusters) {
      if (group.length === largestSize) continue;
      if (group.length < minIslandSize) continue;

      const types = [...new Set(group.map((n) => n.type))];
      const labels = listLabels(group, 4);

      signals.push({
        id: makeSignalId("disconnected_island", ...group.map((n) => n.id)),
        kind: "disconnected_island" as any,
        category: "structural",
        severity: group.length >= 5 ? "high" : "medium",
        title: `${group.length} disconnected nodes: ${group.slice(0, 3).map(nodeLabel).join(", ")}`,
        description: `These nodes (${labels}) are types ${types.join(", ")} but have no path to the rest of the graph. They're an island. Should they connect to existing nodes? If they're related to the main graph, add edges to bridge them in.`,
        evidenceNodeIds: group.map((n) => n.id),
        evidenceDocIds: [],
        graphNames: [graphName],
        score: group.length,
        tags: [],
      });
    }

    return signals;
  },
};

// --- Cross-cutting detectors ---

export const crossGraphEntityDetector: CrossCuttingSignalDetector = {
  kind: "cross_graph_entity",
  category: "structural",
  detect({ graphs }, sensitivity) {
    if (graphs.length < 2) return [];

    const labelMap = new Map<string, { graphName: string; nodeId: string; type: string; label: string }[]>();

    for (const { data, graphName } of graphs) {
      for (const node of data.nodes) {
        const label = nodeLabel(node).toLowerCase().trim();
        if (label.length < 3) continue;
        if (!labelMap.has(label)) labelMap.set(label, []);
        labelMap.get(label)!.push({ graphName, nodeId: node.id, type: node.type, label: nodeLabel(node) });
      }
    }

    const signals: Signal[] = [];
    for (const [, appearances] of labelMap) {
      const uniqueGraphs = [...new Set(appearances.map((a) => a.graphName))];
      if (uniqueGraphs.length < 2) continue;

      const minGraphs = sensitivity >= 0.5 ? 2 : 3;
      if (uniqueGraphs.length < minGraphs) continue;

      const types = [...new Set(appearances.map((a) => a.type))];
      const nodeIds = appearances.map((a) => a.nodeId);
      const displayLabel = appearances[0].label;

      // Build a per-graph context string
      const perGraph = uniqueGraphs.map((g) => {
        const inGraph = appearances.filter((a) => a.graphName === g);
        return `in "${g}" as ${inGraph.map((a) => a.type).join("/")}`;
      });

      signals.push({
        id: makeSignalId("cross_graph_entity", ...nodeIds),
        kind: "cross_graph_entity",
        category: "structural",
        severity: uniqueGraphs.length >= 3 ? "high" : "medium",
        title: `"${displayLabel}" appears across ${uniqueGraphs.length} graphs`,
        description: `"${displayLabel}" exists ${perGraph.join(", ")}. ${types.length > 1 ? `It's typed differently across graphs (${types.join(" vs ")}), which may indicate inconsistent modeling.` : "This entity bridges domains — insights from one graph may apply to the other."}`,
        evidenceNodeIds: nodeIds,
        evidenceDocIds: [],
        graphNames: uniqueGraphs,
        score: uniqueGraphs.length + appearances.length * 0.5,
        tags: [],
      });
    }

    return signals.sort((a, b) => b.score - a.score).slice(0, 15);
  },
};

export const kbGraphGapDetector: CrossCuttingSignalDetector = {
  kind: "kb_graph_gap" as any,
  category: "structural",
  detect({ graphs, docs }, sensitivity) {
    if (docs.length === 0) return [];

    const graphNames = new Set(graphs.map((g) => g.graphName));

    const allLabels = new Map<string, { graphName: string; nodeId: string }>();
    for (const { data, graphName } of graphs) {
      for (const node of data.nodes) {
        const label = nodeLabel(node).toLowerCase().trim();
        if (label.length >= 3) {
          allLabels.set(label, { graphName, nodeId: node.id });
        }
      }
    }

    const signals: Signal[] = [];

    for (const doc of docs) {
      const sourceGraphs = doc.sourceGraphs ?? [];
      const tags = doc.tags ?? [];
      const title = doc.title ?? "";
      const docId = doc.id ?? "";

      if (sourceGraphs.length === 0 && tags.length > 0) {
        const matchingGraphs: string[] = [];
        const matchedTags: string[] = [];
        for (const tag of tags) {
          const t = tag.toLowerCase();
          if (graphNames.has(t)) {
            matchingGraphs.push(t);
            matchedTags.push(tag);
          }
          const labelMatch = allLabels.get(t);
          if (labelMatch && !matchingGraphs.includes(labelMatch.graphName)) {
            matchingGraphs.push(labelMatch.graphName);
            matchedTags.push(tag);
          }
        }

        if (matchingGraphs.length > 0) {
          signals.push({
            id: makeSignalId("kb_graph_gap", docId, ...matchingGraphs),
            kind: "kb_graph_gap" as any,
            category: "structural",
            severity: "medium",
            title: `KB doc "${title}" not linked to matching graphs`,
            description: `"${title}" has tags (${matchedTags.join(", ")}) that match content in ${matchingGraphs.join(", ")}, but the document has no sourceGraphs set. Linking it would let the graph and document cross-reference each other and improve search.`,
            evidenceNodeIds: [],
            evidenceDocIds: [docId],
            graphNames: matchingGraphs,
            score: matchingGraphs.length + 1,
            tags: [],
          });
        }
      }

      for (const sg of sourceGraphs) {
        if (!graphNames.has(sg)) {
          signals.push({
            id: makeSignalId("kb_graph_gap", docId, sg),
            kind: "kb_graph_gap" as any,
            category: "structural",
            severity: "low",
            title: `"${title}" references missing graph "${sg}"`,
            description: `Document "${title}" lists "${sg}" as a source graph, but no graph named "${sg}" exists in this backpack. It may have been deleted, renamed, or moved to another backpack.`,
            evidenceNodeIds: [],
            evidenceDocIds: [docId],
            graphNames: [sg],
            score: 1,
            tags: [],
          });
        }
      }
    }

    return signals.sort((a, b) => b.score - a.score).slice(0, 10);
  },
};

export const coverageAsymmetryDetector: CrossCuttingSignalDetector = {
  kind: "coverage_asymmetry" as any,
  category: "structural",
  detect({ graphs }, sensitivity) {
    if (graphs.length < 2) return [];

    const labelToGraphs = new Map<string, Set<string>>();
    const graphTypes = new Map<string, Map<string, Node[]>>();

    for (const { data, graphName } of graphs) {
      const types = new Map<string, Node[]>();
      for (const node of data.nodes) {
        if (!types.has(node.type)) types.set(node.type, []);
        types.get(node.type)!.push(node);
        const label = nodeLabel(node).toLowerCase().trim();
        if (label.length >= 3) {
          if (!labelToGraphs.has(label)) labelToGraphs.set(label, new Set());
          labelToGraphs.get(label)!.add(graphName);
        }
      }
      graphTypes.set(graphName, types);
    }

    const relatedPairs = new Set<string>();
    for (const [, gs] of labelToGraphs) {
      if (gs.size < 2) continue;
      const arr = [...gs];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          relatedPairs.add([arr[i], arr[j]].sort().join("|"));
        }
      }
    }

    const signals: Signal[] = [];

    for (const pair of relatedPairs) {
      const [g1, g2] = pair.split("|");
      const types1 = graphTypes.get(g1) ?? new Map();
      const types2 = graphTypes.get(g2) ?? new Map();

      for (const [type, nodesInG1] of types1) {
        const nodesInG2 = types2.get(type);
        if (nodesInG1.length >= 3 && !nodesInG2) {
          const exampleLabels = listLabels(nodesInG1, 3);
          signals.push({
            id: makeSignalId("coverage_asymmetry", g1, g2, type),
            kind: "coverage_asymmetry" as any,
            category: "structural",
            severity: "low",
            title: `"${type}" covered in "${g1}" but absent from related graph "${g2}"`,
            description: `"${g1}" has ${nodesInG1.length} "${type}" nodes (${exampleLabels}) but "${g2}" — which shares entities with "${g1}" — has none. If both domains involve ${type} entities, this gap might mean incomplete coverage in "${g2}".`,
            evidenceNodeIds: nodesInG1.slice(0, 3).map((n: Node) => n.id),
            evidenceDocIds: [],
            graphNames: [g1, g2],
            score: nodesInG1.length * 0.5,
            tags: [],
          });
        }
      }
    }

    return signals.sort((a, b) => b.score - a.score).slice(0, 10);
  },
};

// --- Registry ---

export const GRAPH_DETECTORS: GraphSignalDetector[] = [
  typeRatioDetector,
  missingRelationshipsDetector,
  propertyCompletenessDetector,
  underconnectedImportantDetector,
  disconnectedIslandsDetector,
];

export const CROSS_CUTTING_DETECTORS: CrossCuttingSignalDetector[] = [
  crossGraphEntityDetector,
  kbGraphGapDetector,
  coverageAsymmetryDetector,
];
