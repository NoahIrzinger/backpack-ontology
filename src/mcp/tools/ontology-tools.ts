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
      title: "List Learning Graphs",
      description:
        "See what's in the backpack. Lists all learning graphs with names, descriptions, and summary counts. Start here to discover what knowledge the user has stored.",
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
                ? "The backpack is empty. Use backpack_create to add a learning graph."
                : JSON.stringify(ontologies, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "backpack_create",
    {
      title: "Create Learning Graph",
      description:
        "Add a new learning graph to the backpack. A learning graph captures structured knowledge about a specific topic. After creation, add nodes and edges to populate it.",
      inputSchema: {
        name: z
          .string()
          .describe(
            "URL-safe name for the learning graph (lowercase, hyphens ok, e.g. 'cooking' or 'codebase-arch')"
          ),
        description: z
          .string()
          .describe(
            "Human-readable description of what this learning graph captures"
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
              text: `Created learning graph "${name}".\n${JSON.stringify(metadata, null, 2)}`,
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
      title: "Delete Learning Graph",
      description:
        "Remove a learning graph from the backpack. Permanently deletes it and all its data. This cannot be undone.",
      annotations: { destructiveHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to delete"),
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
              text: `Deleted learning graph "${ontology}" and all its data.`,
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
      title: "Describe Learning Graph",
      description:
        "Look inside a learning graph to see its structure: what types of things and relationships exist, with counts. No actual data is returned — use this to understand what's there before drilling in.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to describe"),
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

  server.registerTool(
    "backpack_audit",
    {
      title: "Audit Learning Graph",
      description:
        "Analyze a learning graph for quality issues and suggest improvements. Returns orphan nodes, weak nodes, sparse types, disconnected type pairs, and actionable suggestions. Use this before improving an existing graph.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to audit"),
      },
    },
    async ({ ontology }) => {
      try {
        const audit = await backpack.auditOntology(ontology);
        trackEvent("tool_call", { tool: "backpack_audit" });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(audit, null, 2) },
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
