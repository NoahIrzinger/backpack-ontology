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
        "Add multiple items to a learning graph in the backpack at once. Each item needs a type and properties.",
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
        trackEvent("tool_call", { tool: "backpack_import_nodes" });
        const terms = await backpack.getTermsContext(ontology);
        const content: { type: "text"; text: string }[] = [
          {
            type: "text" as const,
            text: `Imported ${result.count} node(s).\nIDs: ${JSON.stringify(result.ids)}`,
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
}
