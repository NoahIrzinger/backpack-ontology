import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { estimateTokens, formatSavingsFooter } from "../../core/token-estimate.js";

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
        const responseText = JSON.stringify(info, null, 2);
        const graphTokens = await backpack.getGraphTokens(ontology);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
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
        const responseText = JSON.stringify(audit, null, 2);
        const graphTokens = await backpack.getGraphTokens(ontology);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
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
    "backpack_audit_roles",
    {
      title: "Audit Three-Role Rule",
      description:
        "Scan a learning graph for nodes that violate the three-role rule. Flags procedural content (should be in a skill) and briefing content (should be in CLAUDE.md). Heuristic — conservative on purpose. Run periodically to catch drift.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z
          .string()
          .describe("Name of the learning graph to audit for role-rule violations"),
      },
    },
    async ({ ontology }) => {
      try {
        const result = await backpack.auditRoles(ontology);
        trackEvent("tool_call", { tool: "backpack_audit_roles" });
        const responseText = JSON.stringify(result, null, 2);
        const graphTokens = await backpack.getGraphTokens(ontology);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
        return { content };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "backpack_stats",
    {
      title: "Graph Statistics",
      description:
        "Full connectivity analysis of a learning graph. Returns every node grouped by type with incoming, outgoing, and total edge counts plus property counts. Types are sorted by average connectivity (lowest first), nodes within each type sorted by total connections (lowest first). Use this to find under-connected nodes and plan graph improvements systematically.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to analyze"),
      },
    },
    async ({ ontology }) => {
      try {
        const table = await backpack.getDegreeTable(ontology);
        trackEvent("tool_call", { tool: "backpack_stats" });
        const graphTokens = await backpack.getGraphTokens(ontology);
        const avgTokensPerNode = table.nodeCount > 0 ? Math.round(graphTokens / table.nodeCount) : 0;
        // Compute actual describe cost
        const describeResult = await backpack.describeOntology(ontology);
        const describeCost = estimateTokens(JSON.stringify(describeResult, null, 2));
        // Estimate search cost: a typical search returns ~5 NodeSummary objects (~30 chars each)
        const searchCost = Math.max(10, Math.round(avgTokensPerNode * 0.3) * Math.min(5, table.nodeCount));
        const tokenEfficiency = {
          fullGraphTokens: graphTokens,
          avgTokensPerNode,
          searchCost,
          describeCost,
          reductionVsFullLoad: graphTokens > describeCost ? `${Math.round((1 - describeCost / graphTokens) * 100)}%` : "N/A",
        };
        const responseText = JSON.stringify({ ...table, tokenEfficiency }, null, 2);
        const footer = formatSavingsFooter(graphTokens, estimateTokens(responseText));
        const content: { type: "text"; text: string }[] = [
          { type: "text" as const, text: responseText },
        ];
        if (footer) content.push({ type: "text" as const, text: footer });
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
    "backpack_rename",
    {
      title: "Rename Learning Graph",
      description: "Rename a learning graph.",
      inputSchema: {
        ontology: z.string().describe("Current name of the learning graph"),
        newName: z.string().describe("New name for the learning graph"),
      },
    },
    async ({ ontology, newName }) => {
      try {
        await backpack.renameOntology(ontology, newName);
        trackEvent("tool_call", { tool: "backpack_rename" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Renamed to "${newName}".`,
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
