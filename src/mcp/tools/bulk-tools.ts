import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { formatTermsHint } from "./terms-hint.js";

export function registerBulkTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_import_nodes",
    {
      title: "Import Nodes",
      description:
        "Add multiple items and their relationships to a learning graph in one call. Each item needs a type and properties. Edges reference new nodes by array index (0-based) or existing nodes by ID string.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        nodes: z
          .array(
            z.object({
              type: z.string().describe("Node type"),
              properties: z
                .record(z.string(), z.unknown())
                .describe("Key-value pairs for the node"),
            })
          )
          .describe("Array of nodes to import"),
        edges: z
          .array(
            z.object({
              type: z
                .string()
                .describe("Edge type (e.g. 'DEPENDS_ON', 'CONTAINS')"),
              source: z
                .union([z.number().int().nonnegative(), z.string()])
                .describe(
                  "Source: integer index into the nodes array (0-based) for a new node, or a string node ID for an existing node"
                ),
              target: z
                .union([z.number().int().nonnegative(), z.string()])
                .describe(
                  "Target: integer index into the nodes array (0-based) for a new node, or a string node ID for an existing node"
                ),
              properties: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Optional key-value pairs for this edge"),
            })
          )
          .optional()
          .describe(
            "Optional array of edges to create between imported and/or existing nodes"
          ),
      },
    },
    async ({ ontology, nodes, edges }) => {
      try {
        const result = await backpack.importNodes(
          ontology,
          nodes as Array<{
            type: string;
            properties: Record<string, unknown>;
          }>,
          edges as
            | Array<{
                type: string;
                source: number | string;
                target: number | string;
                properties?: Record<string, unknown>;
              }>
            | undefined
        );
        trackEvent("tool_call", { tool: "backpack_import_nodes" });
        const terms = await backpack.getTermsContext(ontology);
        const content: { type: "text"; text: string }[] = [
          {
            type: "text" as const,
            text: `Imported ${result.count} node(s) and ${result.edgeCount} edge(s).\nNode IDs: ${JSON.stringify(result.ids)}\nEdge IDs: ${JSON.stringify(result.edgeIds)}`,
          },
        ];
        if (terms) {
          content.push({ type: "text" as const, text: formatTermsHint(terms) });
        }
        return { content };
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
    "backpack_connect",
    {
      title: "Connect Nodes",
      description:
        "Add multiple edges between existing nodes in a single call. Use this to bulk-add relationships — all source and target node IDs must already exist.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        edges: z
          .array(
            z.object({
              type: z.string().describe("Edge type (e.g. 'DEPENDS_ON', 'SERVES_ON')"),
              sourceId: z.string().describe("ID of the source node"),
              targetId: z.string().describe("ID of the target node"),
              properties: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Optional key-value pairs for this edge"),
            })
          )
          .describe("Array of edges to create between existing nodes"),
      },
    },
    async ({ ontology, edges }) => {
      try {
        const result = await backpack.connectEdges(
          ontology,
          edges as Array<{
            type: string;
            sourceId: string;
            targetId: string;
            properties?: Record<string, unknown>;
          }>
        );
        trackEvent("tool_call", { tool: "backpack_connect" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created ${result.count} edge(s).\nIDs: ${JSON.stringify(result.ids)}`,
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
    "backpack_extract",
    {
      title: "Extract Subgraph",
      description:
        "Extract a subgraph (selected nodes + auto-detected edges) into a new learning graph. Node IDs are preserved.",
      inputSchema: {
        ontology: z.string().describe("Source learning graph"),
        nodeIds: z
          .array(z.string())
          .describe("Node IDs to extract"),
        newName: z.string().describe("Name for the new learning graph"),
        description: z
          .string()
          .optional()
          .describe("Description for the new graph"),
      },
    },
    async ({ ontology, nodeIds, newName, description }) => {
      try {
        const result = await backpack.extractSubgraph(
          ontology,
          nodeIds as string[],
          newName,
          description
        );
        trackEvent("tool_call", { tool: "backpack_extract" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created learning graph "${newName}" with ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`,
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
