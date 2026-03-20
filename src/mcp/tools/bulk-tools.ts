import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";

export function registerBulkTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_import_nodes",
    {
      title: "Import Nodes",
      description:
        "Bulk-add multiple nodes to an ontology at once. Each node needs a type and properties.",
      inputSchema: {
        ontology: z.string().describe("Name of the ontology"),
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
      },
    },
    async ({ ontology, nodes }) => {
      try {
        const result = await backpack.importNodes(
          ontology,
          nodes as Array<{
            type: string;
            properties: Record<string, unknown>;
          }>
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Imported ${result.count} node(s).\nIDs: ${JSON.stringify(result.ids)}`,
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
