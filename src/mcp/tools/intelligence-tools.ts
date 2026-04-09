import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { estimateTokens, formatSavingsFooter } from "../../core/token-estimate.js";

export function registerIntelligenceTools(
  server: McpServer,
  backpack: Backpack
): void {

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
        trackEvent("tool_call", { tool: "backpack_expand" });

        const directionHint = direction ? `\nExpansion direction: ${direction}` : "";
        const responseText = `Node to expand:\n${JSON.stringify(nodeResult, null, 2)}\n\nNeighbors:\n${JSON.stringify(neighbors, null, 2)}${directionHint}\n\nNow use backpack_import_nodes to add related entities with edges connecting them to node ${nodeId}. Add 5-15 new nodes that deepen understanding in the requested direction. Always include edges.`;
        const graphTokens = await backpack.getGraphTokens(ontology);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
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

        trackEvent("tool_call", { tool: "backpack_explain_path" });
        const responseText = `Path found (${foundPath.length} nodes, ${foundPath.length - 1} hops):\n\n${JSON.stringify(pathDetails, null, 2)}\n\nExplain the semantic meaning of this path — why are these nodes connected through these relationships? What does the chain of connections reveal?`;
        const graphTokens = await backpack.getGraphTokens(ontology);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
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
        trackEvent("tool_call", { tool: "backpack_enrich" });

        const responseText = `Node to enrich:\n${JSON.stringify(nodeResult, null, 2)}\n\nNeighbors:\n${JSON.stringify(neighbors, null, 2)}\n\nGraph context:\n${JSON.stringify({ nodeTypes: describe.nodeTypes, edgeTypes: describe.edgeTypes }, null, 2)}\n\nEnrich this node: add missing properties (use backpack_update_node), add related entities (use backpack_import_nodes with edges to ${nodeId}), and add missing connections to existing nodes (use backpack_connect).`;
        const graphTokens = await backpack.getGraphTokens(ontology);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
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
