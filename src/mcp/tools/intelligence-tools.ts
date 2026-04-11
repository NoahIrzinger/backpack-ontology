import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { estimateTokens, formatSavingsFooter } from "../../core/token-estimate.js";
import { analyzePatterns } from "../../core/pattern-analyzer.js";
import { generatePriorityBriefing } from "../../core/recommendation-formatter.js";
import type { PatternType } from "../../core/types.js";

export function registerIntelligenceTools(
  server: McpServer,
  backpack: Backpack
): void {

  // backpack_analyze_patterns: deterministic pattern detection on a graph
  server.registerTool(
    "backpack_analyze_patterns",
    {
      title: "Analyze Patterns",
      description:
        "Detect structural patterns in a learning graph using deterministic algorithms — no LLM inference. Identifies frequency outliers, dependency risks, cost drivers, governance gaps (missing owners), and contract/reality mismatches. Returns scored, ranked findings with recommended actions.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        patternTypes: z
          .array(
            z.enum([
              "frequency",
              "dependency",
              "cost_driver",
              "gap",
              "mismatch",
            ])
          )
          .optional()
          .describe(
            "Which pattern types to detect. Defaults to all: frequency, dependency, cost_driver, gap, mismatch"
          ),
      },
    },
    async ({ ontology, patternTypes }) => {
      try {
        const graph = await (backpack as any).getGraph(ontology);
        const types = (patternTypes as PatternType[] | undefined) ?? [
          "frequency",
          "dependency",
          "cost_driver",
          "gap",
          "mismatch",
        ];
        const analysis = analyzePatterns(graph.data, types);
        const text = JSON.stringify(analysis, null, 2);
        const graphTokens = await backpack.getGraphTokens(ontology);
        const responseTokens = estimateTokens(text);
        const footer = formatSavingsFooter(graphTokens, responseTokens);
        trackEvent("tool_call", { tool: "backpack_analyze_patterns", graphTokens, responseTokens });
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // backpack_synthesize_structured: 7 consulting questions as deterministic pattern queries
  server.registerTool(
    "backpack_synthesize_structured",
    {
      title: "Structured Synthesis",
      description:
        "Answer the 7 universal consulting intelligence questions about a learning graph using deterministic pattern detection — no LLM inference required. Questions: top problems by cost/frequency, relationship risks, overloaded people, governance gaps, opportunities, financial picture, disconnected systems. Returns structured findings per question.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
      },
    },
    async ({ ontology }) => {
      try {
        const graph = await (backpack as any).getGraph(ontology);

        // Run each question as a targeted pattern query
        const costProblems = analyzePatterns(graph.data, ["cost_driver", "frequency"]);
        const risks = analyzePatterns(graph.data, ["dependency", "mismatch"]);
        const gaps = analyzePatterns(graph.data, ["gap"]);
        const opportunities = analyzePatterns(graph.data, ["frequency"]);

        // People overload: Person nodes with degree > 2× average
        const nodes: import("../../core/types.js").Node[] = graph.data.nodes;
        const edges: import("../../core/types.js").Edge[] = graph.data.edges;
        const degreeMap = new Map<string, number>();
        for (const n of nodes) degreeMap.set(n.id, 0);
        for (const e of edges) {
          degreeMap.set(e.sourceId, (degreeMap.get(e.sourceId) ?? 0) + 1);
          degreeMap.set(e.targetId, (degreeMap.get(e.targetId) ?? 0) + 1);
        }
        const personNodes = nodes.filter(
          (n) => n.type.toLowerCase().includes("person") || n.type.toLowerCase().includes("people"),
        );
        const avgDegree =
          personNodes.length > 0
            ? personNodes.reduce((s, n) => s + (degreeMap.get(n.id) ?? 0), 0) /
              personNodes.length
            : 0;
        const overloaded = personNodes
          .filter((n) => (degreeMap.get(n.id) ?? 0) > avgDegree * 2)
          .map((n) => ({
            id: n.id,
            label:
              Object.values(n.properties).find((v) => typeof v === "string") ??
              n.id,
            connections: degreeMap.get(n.id),
          }));

        // Financial picture: nodes with cost/amount properties
        const financialNodes = nodes.filter((n) =>
          Object.keys(n.properties).some((k) => {
            const lk = k.toLowerCase();
            return (
              lk.includes("cost") ||
              lk.includes("amount") ||
              lk.includes("budget") ||
              lk.includes("revenue") ||
              lk.includes("spend")
            );
          }),
        );

        // Disconnected systems: nodes with type containing "system"/"service"/"tool" and low degree
        const systemNodes = nodes.filter(
          (n) =>
            n.type.toLowerCase().includes("system") ||
            n.type.toLowerCase().includes("service") ||
            n.type.toLowerCase().includes("tool") ||
            n.type.toLowerCase().includes("platform"),
        );
        const disconnectedSystems = systemNodes.filter(
          (n) => (degreeMap.get(n.id) ?? 0) <= 1,
        );

        const result = {
          topProblems: {
            question: "Top 3 problems costing time or money?",
            findings: costProblems.patterns.slice(0, 3).map((p) => ({
              issue: p.entities.map((e) => e.label).join(", "),
              severity: p.severity,
              reasoning: p.reasoning,
              recommendedAction: p.recommendedAction,
            })),
          },
          relationshipRisks: {
            question: "Which relationships are risks?",
            findings: risks.patterns.slice(0, 5).map((p) => ({
              issue: p.entities.map((e) => e.label).join(" → "),
              type: p.type,
              severity: p.severity,
              reasoning: p.reasoning,
            })),
          },
          overloadedPeople: {
            question: "Are specific people overloaded?",
            findings: overloaded,
            avgDegree: Math.round(avgDegree * 10) / 10,
          },
          governanceGaps: {
            question: "Where do decisions fall through the cracks?",
            findings: gaps.patterns.map((p) => ({
              issue: p.entities.map((e) => e.label).join(", "),
              reasoning: p.reasoning,
              recommendedAction: p.recommendedAction,
            })),
          },
          opportunities: {
            question: "What opportunities exist?",
            findings: opportunities.patterns
              .filter((p) => p.severity === "medium" || p.severity === "low")
              .slice(0, 5)
              .map((p) => ({
                issue: p.entities.map((e) => e.label).join(", "),
                reasoning: p.reasoning,
              })),
          },
          financialPicture: {
            question: "What is the financial picture?",
            nodesWithCostData: financialNodes.map((n) => {
              const costProp = Object.entries(n.properties).find(([k]) => {
                const lk = k.toLowerCase();
                return (
                  lk.includes("cost") ||
                  lk.includes("amount") ||
                  lk.includes("budget") ||
                  lk.includes("revenue") ||
                  lk.includes("spend")
                );
              });
              return {
                id: n.id,
                label:
                  Object.values(n.properties).find((v) => typeof v === "string") ??
                  n.id,
                type: n.type,
                costProperty: costProp?.[0],
                costValue: costProp?.[1],
              };
            }),
          },
          disconnectedSystems: {
            question: "Which systems are disconnected or isolated?",
            findings: disconnectedSystems.map((n) => ({
              id: n.id,
              label:
                Object.values(n.properties).find((v) => typeof v === "string") ??
                n.id,
              type: n.type,
              connections: degreeMap.get(n.id) ?? 0,
            })),
          },
        };

        const text = JSON.stringify(result, null, 2);
        const graphTokens = await backpack.getGraphTokens(ontology);
        const responseTokens = estimateTokens(text);
        const footer = formatSavingsFooter(graphTokens, responseTokens);
        trackEvent("tool_call", { tool: "backpack_synthesize_structured", graphTokens, responseTokens });
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // backpack_priority_briefing: generate enforced PriorityBriefing from pattern analysis
  server.registerTool(
    "backpack_priority_briefing",
    {
      title: "Priority Briefing",
      description:
        "Generate a structured priority briefing from a learning graph. Runs pattern analysis and formats results into an enforced structure: top issues (ranked), quick wins, strategic moves, and watch list. Use this to prepare client-ready synthesis output.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        patternTypes: z
          .array(
            z.enum([
              "frequency",
              "dependency",
              "cost_driver",
              "gap",
              "mismatch",
            ])
          )
          .optional()
          .describe("Pattern types to include. Defaults to all."),
      },
    },
    async ({ ontology, patternTypes }) => {
      try {
        const graph = await (backpack as any).getGraph(ontology);
        const types = (patternTypes as PatternType[] | undefined) ?? [
          "frequency",
          "dependency",
          "cost_driver",
          "gap",
          "mismatch",
        ];
        const analysis = analyzePatterns(graph.data, types);
        const briefing = generatePriorityBriefing(analysis);
        const text = JSON.stringify(briefing, null, 2);
        const graphTokens = await backpack.getGraphTokens(ontology);
        const responseTokens = estimateTokens(text);
        const footer = formatSavingsFooter(graphTokens, responseTokens);
        trackEvent("tool_call", { tool: "backpack_priority_briefing", graphTokens, responseTokens });
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // backpack_expand: Claude expands a node with related entities
  server.registerTool(
    "backpack_expand",
    {
      title: "Expand Node",
      description:
        "Expand a node by adding related entities and connections. Load the node and its neighbors to understand context, then add new nodes and edges that deepen the knowledge in the specified direction. Returns the current node with its neighbors for context.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        nodeId: z.string().describe("ID of the node to expand"),
        direction: z.string().optional().describe("Direction to expand (e.g. 'historical context', 'related concepts', 'technical details')"),
      },
    },
    async ({ ontology, nodeId, direction }) => {
      try {
        const nodeResult = await backpack.getNode(ontology, nodeId);
        const neighbors = await backpack.getNeighbors(ontology, nodeId, undefined, "both", 1);
        const directionHint = direction ? `\nExpansion direction: ${direction}` : "";
        const responseText = `Node to expand:\n${JSON.stringify(nodeResult, null, 2)}\n\nNeighbors:\n${JSON.stringify(neighbors, null, 2)}${directionHint}\n\nNow use backpack_import_nodes to add related entities with edges connecting them to node ${nodeId}. Add 5-15 new nodes that deepen understanding in the requested direction. Always include edges.`;
        const graphTokens = await backpack.getGraphTokens(ontology);
        const responseTokens = estimateTokens(responseText);
        const footer = formatSavingsFooter(graphTokens, responseTokens);
        trackEvent("tool_call", { tool: "backpack_expand", graphTokens, responseTokens });
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // backpack_explain_path: Find and explain the connection between two nodes
  server.registerTool(
    "backpack_explain_path",
    {
      title: "Explain Path",
      description:
        "Find the shortest path between two nodes and explain the semantic meaning of their connection. Returns the path with full node/edge details for you to explain.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        sourceId: z.string().describe("ID of the starting node"),
        targetId: z.string().describe("ID of the ending node"),
      },
    },
    async ({ ontology, sourceId, targetId }) => {
      try {
        const graph = await (backpack as any).getGraph(ontology);
        const visited = new Set<string>([sourceId]);
        const queue: Array<{ nodeId: string; path: Array<{ nodeId: string; edgeType?: string }> }> = [
          { nodeId: sourceId, path: [{ nodeId: sourceId }] }
        ];

        let foundPath: Array<{ nodeId: string; edgeType?: string }> | null = null;

        while (queue.length > 0) {
          const { nodeId, path } = queue.shift()!;
          if (nodeId === targetId) {
            foundPath = path;
            break;
          }
          for (const edge of graph.data.edges) {
            let neighbor: string | null = null;
            let edgeType = edge.type;
            if (edge.sourceId === nodeId) neighbor = edge.targetId;
            else if (edge.targetId === nodeId) neighbor = edge.sourceId;
            if (neighbor && !visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push({
                nodeId: neighbor,
                path: [...path, { nodeId: neighbor, edgeType }],
              });
            }
          }
        }

        if (!foundPath) {
          return {
            content: [{ type: "text" as const, text: "No path found between these two nodes. They are in disconnected parts of the graph." }],
          };
        }

        const pathDetails = [];
        for (const step of foundPath) {
          const node = graph.getNode(step.nodeId);
          if (node) {
            pathDetails.push({
              id: node.id,
              type: node.type,
              label: Object.values(node.properties).find(v => typeof v === "string") ?? node.id,
              properties: node.properties,
              edgeType: step.edgeType,
            });
          }
        }

        const responseText = `Path found (${foundPath.length} nodes, ${foundPath.length - 1} hops):\n\n${JSON.stringify(pathDetails, null, 2)}\n\nExplain the semantic meaning of this path — why are these nodes connected through these relationships? What does the chain of connections reveal?`;
        const graphTokens = await backpack.getGraphTokens(ontology);
        const responseTokens = estimateTokens(responseText);
        const footer = formatSavingsFooter(graphTokens, responseTokens);
        trackEvent("tool_call", { tool: "backpack_explain_path", graphTokens, responseTokens });
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // backpack_enrich: Load a node's context for enrichment
  server.registerTool(
    "backpack_enrich",
    {
      title: "Enrich Node",
      description:
        "Enrich a node with deeper knowledge. Load the node and its context, then add additional properties, related nodes, and connections based on your knowledge or external sources.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        nodeId: z.string().describe("ID of the node to enrich"),
      },
    },
    async ({ ontology, nodeId }) => {
      try {
        const nodeResult = await backpack.getNode(ontology, nodeId);
        const neighbors = await backpack.getNeighbors(ontology, nodeId, undefined, "both", 1);
        const describe = await backpack.describeOntology(ontology);
        const responseText = `Node to enrich:\n${JSON.stringify(nodeResult, null, 2)}\n\nNeighbors:\n${JSON.stringify(neighbors, null, 2)}\n\nGraph context:\n${JSON.stringify({ nodeTypes: describe.nodeTypes, edgeTypes: describe.edgeTypes }, null, 2)}\n\nEnrich this node: add missing properties (use backpack_update_node), add related entities (use backpack_import_nodes with edges to ${nodeId}), and add missing connections to existing nodes (use backpack_connect).`;
        const graphTokens = await backpack.getGraphTokens(ontology);
        const responseTokens = estimateTokens(responseText);
        const footer = formatSavingsFooter(graphTokens, responseTokens);
        trackEvent("tool_call", { tool: "backpack_enrich", graphTokens, responseTokens });
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // backpack_synthesize: Multi-source graph building
  server.registerTool(
    "backpack_synthesize",
    {
      title: "Synthesize Sources",
      description:
        "Build a learning graph from multiple sources. Provide the content from each source (already loaded), and the tool will guide you to extract entities and relationships. Use this when combining knowledge from databases, code, documents, APIs, or other people's work.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph (will be created if it doesn't exist)"),
        sources: z
          .array(z.object({
            label: z.string().describe("Description of the source (e.g. 'Snowflake customer table', 'GitLab project README')"),
            content: z.string().describe("The actual content from the source"),
          }))
          .describe("Array of sources to synthesize"),
        focus: z.string().optional().describe("What to focus on (e.g. 'business opportunities', 'technical architecture', 'character relationships')"),
      },
    },
    async ({ ontology, sources, focus }) => {
      try {
        try {
          await backpack.describeOntology(ontology);
        } catch {
          await (backpack as any).storage.createOntology(ontology, focus ?? "Synthesized learning graph");
        }

        trackEvent("tool_call", { tool: "backpack_synthesize" });

        const sourceList = sources.map((s: any, i: number) => `Source ${i + 1} (${s.label}):\n${s.content}`).join("\n\n---\n\n");
        const focusHint = focus ? `\nFocus area: ${focus}` : "";

        return {
          content: [{
            type: "text" as const,
            text: `Synthesize these ${sources.length} sources into the "${ontology}" learning graph:${focusHint}\n\n${sourceList}\n\nExtract entities and relationships from ALL sources. Cross-reference across sources — if the same entity appears in multiple sources, create one node with combined properties. Use backpack_import_nodes with edges to write everything in one atomic call. Include 10-50 nodes depending on source richness.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
