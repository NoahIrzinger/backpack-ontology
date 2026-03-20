import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";

export function registerOntologyTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_list",
    {
      title: "List Ontologies",
      description:
        "List all ontologies in the backpack. Returns names, descriptions, and summary counts. Start here to discover what knowledge is available.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const ontologies = await backpack.listOntologies();
      return {
        content: [
          {
            type: "text" as const,
            text:
              ontologies.length === 0
                ? "No ontologies in the backpack yet. Use backpack_create to add one."
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
        "Create a new empty ontology. After creation, add nodes and edges to populate it.",
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
        "Permanently delete an ontology and all its data. This cannot be undone.",
      annotations: { destructiveHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology to delete"),
      },
    },
    async ({ ontology }) => {
      try {
        await backpack.deleteOntology(ontology);
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
        "Get the structure of an ontology: what node types and edge types exist, with counts. No instance data is returned — use this to understand the shape before drilling into nodes.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the ontology to describe"),
      },
    },
    async ({ ontology }) => {
      try {
        const info = await backpack.describeOntology(ontology);
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
