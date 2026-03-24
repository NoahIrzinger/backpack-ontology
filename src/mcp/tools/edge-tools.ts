import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";

export function registerEdgeTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_add_edge",
    {
      title: "Add Edge",
      description:
        "Create a relationship between two items in an ontology. The type is freeform (e.g. 'WORKS_WITH', 'REPORTS_TO', 'DEPENDS_ON').",
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        type: z
          .string()
          .describe(
            "Edge type (freeform, e.g. 'USED_IN', 'DEPENDS_ON', 'HAS_CHILD')"
          ),
        sourceId: z.string().describe("ID of the source node"),
        targetId: z.string().describe("ID of the target node"),
        properties: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Optional key-value pairs for this edge (e.g. { weight: 0.8, since: '2024' })"
          ),
      },
    },
    async ({ ontology, type, sourceId, targetId, properties }) => {
      try {
        const edge = await backpack.addEdge(
          ontology,
          type,
          sourceId,
          targetId,
          (properties as Record<string, unknown>) ?? {}
        );
        trackEvent("tool_call", { tool: "backpack_add_edge" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(edge, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "backpack_remove_edge",
    {
      title: "Remove Edge",
      description: "Remove a relationship between two items in an ontology.",
      annotations: { destructiveHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        edgeId: z.string().describe("ID of the edge to remove"),
      },
    },
    async ({ ontology, edgeId }) => {
      try {
        await backpack.removeEdge(ontology, edgeId);
        trackEvent("tool_call", { tool: "backpack_remove_edge" });
        return {
          content: [
            { type: "text" as const, text: `Removed edge ${edgeId}.` },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "backpack_get_neighbors",
    {
      title: "Get Neighbors",
      description:
        "Explore connections from an item in an ontology. Returns related items with their relationships. Use depth > 1 to follow the chain further (max 3).",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        nodeId: z.string().describe("ID of the starting node"),
        edgeType: z
          .string()
          .optional()
          .describe("Only follow edges of this type"),
        direction: z
          .enum(["incoming", "outgoing", "both"])
          .default("both")
          .describe("Which direction to traverse (default: both)"),
        depth: z
          .number()
          .int()
          .positive()
          .max(3)
          .default(1)
          .describe("How many hops to traverse (default 1, max 3)"),
      },
    },
    async ({ ontology, nodeId, edgeType, direction, depth }) => {
      try {
        const result = await backpack.getNeighbors(
          ontology,
          nodeId,
          edgeType,
          direction,
          depth
        );
        trackEvent("tool_call", { tool: "backpack_get_neighbors" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }
  );
}
