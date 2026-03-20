import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";

export function registerNodeTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_node_types",
    {
      title: "List Node Types",
      description:
        "Get all distinct node types in an ontology with counts. Useful for understanding what kinds of data exist before browsing.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
      },
    },
    async ({ ontology }) => {
      try {
        const types = await backpack.getNodeTypes(ontology);
        trackEvent("tool_call", { tool: "backpack_node_types" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(types, null, 2) },
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
    "backpack_list_nodes",
    {
      title: "List Nodes",
      description:
        "List nodes in an ontology with pagination. Returns summaries (id, type, label) — not full data. Use backpack_get_node to get the full node.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        type: z
          .string()
          .optional()
          .describe("Filter by node type (e.g. 'Ingredient')"),
        limit: z
          .number()
          .int()
          .positive()
          .default(20)
          .describe("Max nodes to return (default 20)"),
        offset: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Skip this many nodes (for pagination)"),
      },
    },
    async ({ ontology, type, limit, offset }) => {
      try {
        const result = await backpack.listNodes(ontology, type, limit, offset);
        trackEvent("tool_call", { tool: "backpack_list_nodes" });
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

  server.registerTool(
    "backpack_search",
    {
      title: "Search Nodes",
      description:
        "Search for nodes by text query. Matches against all string properties (case-insensitive). Returns summaries.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        query: z.string().describe("Text to search for"),
        type: z
          .string()
          .optional()
          .describe("Limit search to this node type"),
      },
    },
    async ({ ontology, query, type }) => {
      try {
        const results = await backpack.searchNodes(ontology, query, type);
        trackEvent("tool_call", { tool: "backpack_search" });
        return {
          content: [
            {
              type: "text" as const,
              text:
                results.length === 0
                  ? `No nodes matching "${query}" found.`
                  : JSON.stringify(results, null, 2),
            },
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
    "backpack_get_node",
    {
      title: "Get Node",
      description:
        "Get the full details of a single node, including all properties and its connected edges.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        nodeId: z.string().describe("ID of the node to retrieve"),
      },
    },
    async ({ ontology, nodeId }) => {
      try {
        const result = await backpack.getNode(ontology, nodeId);
        trackEvent("tool_call", { tool: "backpack_get_node" });
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

  server.registerTool(
    "backpack_add_node",
    {
      title: "Add Node",
      description:
        "Add a new node to an ontology. The type is freeform — use whatever makes sense. Properties are key-value pairs.",
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        type: z
          .string()
          .describe(
            "Node type (freeform, e.g. 'Person', 'Ingredient', 'Service')"
          ),
        properties: z
          .record(z.string(), z.unknown())
          .describe(
            "Key-value pairs for this node (e.g. { name: 'garlic', category: 'aromatic' })"
          ),
      },
    },
    async ({ ontology, type, properties }) => {
      try {
        const node = await backpack.addNode(
          ontology,
          type,
          properties as Record<string, unknown>
        );
        trackEvent("tool_call", { tool: "backpack_add_node" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(node, null, 2) },
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
    "backpack_update_node",
    {
      title: "Update Node",
      description:
        "Update a node's properties. New properties are merged with existing ones (existing keys are overwritten, new keys are added, unmentioned keys are kept).",
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        nodeId: z.string().describe("ID of the node to update"),
        properties: z
          .record(z.string(), z.unknown())
          .describe("Properties to merge into the node"),
      },
    },
    async ({ ontology, nodeId, properties }) => {
      try {
        const node = await backpack.updateNode(
          ontology,
          nodeId,
          properties as Record<string, unknown>
        );
        trackEvent("tool_call", { tool: "backpack_update_node" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(node, null, 2) },
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
    "backpack_remove_node",
    {
      title: "Remove Node",
      description:
        "Remove a node and all its connected edges from an ontology.",
      annotations: { destructiveHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
        nodeId: z.string().describe("ID of the node to remove"),
      },
    },
    async ({ ontology, nodeId }) => {
      try {
        const result = await backpack.removeNode(ontology, nodeId);
        trackEvent("tool_call", { tool: "backpack_remove_node" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Removed node ${nodeId} and ${result.removedEdges} connected edge(s).`,
            },
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
