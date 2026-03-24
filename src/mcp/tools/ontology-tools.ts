import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";

export function registerOntologyTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_list",
    {
      title: "List Ontologies",
      description:
        "See what's in the backpack. Lists all ontologies with names, descriptions, and summary counts. Start here to discover what knowledge the user has stored.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const ontologies = await backpack.listOntologies();
      trackEvent("tool_call", { tool: "backpack_list" });
      return {
        content: [
          {
            type: "text" as const,
            text:
              ontologies.length === 0
                ? "The backpack is empty. Use backpack_create to add an ontology."
                : JSON.stringify(ontologies, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "backpack_create",
    {
      title: "Create Ontology",
      description:
        "Add a new ontology to the backpack. An ontology is a knowledge graph about a specific topic. After creation, add nodes and edges to populate it.",
      inputSchema: {
        name: z
          .string()
          .describe(
            "URL-safe name for the ontology (lowercase, hyphens ok, e.g. 'cooking' or 'codebase-arch')"
          ),
        description: z
          .string()
          .describe(
            "Human-readable description of what this ontology models"
          ),
      },
    },
    async ({ name, description }) => {
      try {
        const metadata = await backpack.createOntology(name, description);
        trackEvent("tool_call", { tool: "backpack_create" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created ontology "${name}".\n${JSON.stringify(metadata, null, 2)}`,
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
    "backpack_delete",
    {
      title: "Delete Ontology",
      description:
        "Remove an ontology from the backpack. Permanently deletes it and all its data. This cannot be undone.",
      annotations: { destructiveHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology to delete"),
      },
    },
    async ({ ontology }) => {
      try {
        await backpack.deleteOntology(ontology);
        trackEvent("tool_call", { tool: "backpack_delete" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted ontology "${ontology}" and all its data.`,
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
    "backpack_describe",
    {
      title: "Describe Ontology",
      description:
        "Look inside an ontology to see its structure: what types of things and relationships exist, with counts. No actual data is returned — use this to understand what's there before drilling in.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology to describe"),
      },
    },
    async ({ ontology }) => {
      try {
        const info = await backpack.describeOntology(ontology);
        trackEvent("tool_call", { tool: "backpack_describe" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(info, null, 2) },
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
