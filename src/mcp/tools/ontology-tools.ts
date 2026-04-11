import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { estimateTokens, formatSavingsFooter } from "../../core/token-estimate.js";
import { formatWriteError } from "./error-helpers.js";
import { auditDiscovery, HOSPITALITY_CATEGORIES } from "../../core/discovery-audit.js";
import type { DiscoveredSource, SourceType } from "../../core/discovery-audit.js";

// backpack_discovery_audit is registered separately since it's stateless
// (no graph read needed). Exported so it can be registered by the server.
export function registerDiscoveryAuditTool(server: McpServer): void {
  server.registerTool(
    "backpack_discovery_audit",
    {
      title: "Discovery Audit",
      description:
        "Check how completely you've covered a client's data landscape during the discovery phase. Maps your declared sources against 7 universal categories (Communications, Operations, Financial, People/Org, Systems, External, Historical) and returns coverage scores, critical gaps, and next-step recommendations. Pass vertical='hospitality' to add domain-specific categories.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        sources: z
          .array(
            z.object({
              name: z.string().describe("Name or description of the source"),
              category: z
                .string()
                .describe(
                  "Category this source belongs to (e.g. 'email', 'financial', 'operations')"
                ),
              type: z
                .enum([
                  "email",
                  "document",
                  "api",
                  "system",
                  "interview",
                  "spreadsheet",
                  "database",
                  "chat",
                  "ticket",
                  "other",
                ])
                .describe("Type of source"),
            })
          )
          .describe("Sources discovered so far"),
        vertical: z
          .enum(["hospitality"])
          .optional()
          .describe(
            "Optional vertical to add domain-specific categories (e.g. Pricing & Revenue, Property & Maintenance for hospitality)"
          ),
      },
    },
    async ({ sources, vertical }) => {
      const additionalCategories =
        vertical === "hospitality" ? HOSPITALITY_CATEGORIES : [];
      const audit = auditDiscovery(
        sources as DiscoveredSource[],
        additionalCategories,
      );
      trackEvent("tool_call", { tool: "backpack_discovery_audit" });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(audit, null, 2),
          },
        ],
      };
    }
  );
}

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
      const activeBackpack = backpack.getActiveBackpackEntry();
      trackEvent("tool_call", { tool: "backpack_list" });
      const payload = {
        activeBackpack: activeBackpack
          ? { name: activeBackpack.name, path: activeBackpack.path }
          : null,
        graphs: ontologies,
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              ontologies.length === 0
                ? `Active backpack: ${activeBackpack?.name ?? "unknown"}.\nThe backpack is empty. Use backpack_create to add a learning graph.`
                : JSON.stringify(payload, null, 2),
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
        return formatWriteError(backpack, ontology, err);
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
        const graphTokens = await backpack.getGraphTokens(ontology);
        const activeBackpack = backpack.getActiveBackpackEntry();
        trackEvent("tool_call", { tool: "backpack_describe" });
        const enriched = {
          activeBackpack: activeBackpack
            ? { name: activeBackpack.name, path: activeBackpack.path }
            : null,
          ...info,
          totalTokens: graphTokens,
        };
        const responseText = JSON.stringify(enriched, null, 2);
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
    "backpack_normalize",
    {
      title: "Normalize Type Drift",
      description:
        "Detect and consolidate type drift in a learning graph. Groups node types and edge types by case/separator-insensitive key and renames non-canonical variants to the dominant one (e.g. 'service' → 'Service' if 'Service' is more common). Defaults to dry-run for safety: returns the plan without writing. Pass dryRun=false explicitly to commit. Type renames preserve node IDs and edges.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to normalize"),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Defaults to true (preview only). Set to false explicitly to apply the renames.",
          ),
        autoApply: z
          .boolean()
          .optional()
          .describe(
            "If true, automatically apply normalization when the plan affects fewer than 5 nodes/edges total (safe micro-fixes). Larger plans are returned for review regardless.",
          ),
      },
    },
    async ({ ontology, dryRun, autoApply }) => {
      // Default to dry-run if not specified — no surprising writes
      const doDryRun = dryRun !== false;
      try {
        if (doDryRun || autoApply) {
          const plan = await backpack.planNormalization(ontology);
          const totalNode = plan.nodeTypeRenames.reduce((s, r) => s + r.count, 0);
          const totalEdge = plan.edgeTypeRenames.reduce((s, r) => s + r.count, 0);
          const totalAffected = totalNode + totalEdge;
          const empty =
            plan.nodeTypeRenames.length === 0 &&
            plan.edgeTypeRenames.length === 0;

          // Auto-apply: if small plan and caller requested it, commit immediately
          if (autoApply && !empty && totalAffected < 5) {
            const { plan: applied, summary } = await backpack.applyNormalization(ontology);
            trackEvent("tool_call", { tool: "backpack_normalize", outcome: "auto_applied" });
            return {
              content: [{
                type: "text" as const,
                text: `Auto-normalization applied (${totalAffected} item(s) — below threshold).\n${summary.nodeRenameCount} node type rename(s) affecting ${summary.totalAffectedNodes} node(s).\n${summary.edgeRenameCount} edge type rename(s) affecting ${summary.totalAffectedEdges} edge(s).\n\nPlan:\n${JSON.stringify(applied, null, 2)}`,
              }],
            };
          }

          // Auto-apply but plan is too large — return for review
          if (autoApply && !empty && totalAffected >= 5) {
            trackEvent("tool_call", { tool: "backpack_normalize", outcome: "auto_deferred" });
            return {
              content: [{
                type: "text" as const,
                text: `Auto-normalization deferred: plan affects ${totalAffected} items (threshold is 5). Review and call with dryRun=false to apply.\n\n${JSON.stringify(plan, null, 2)}`,
              }],
            };
          }

          trackEvent("tool_call", { tool: "backpack_normalize", outcome: "dry_run" });
          const text = empty
            ? `No type drift detected. Graph is already normalized.`
            : `Normalization plan (dry run — nothing written):\n${JSON.stringify(plan, null, 2)}\n\n${plan.nodeTypeRenames.length} node type rename(s) affecting ${totalNode} node(s).\n${plan.edgeTypeRenames.length} edge type rename(s) affecting ${totalEdge} edge(s).\n\nCall again without dryRun (or dryRun=false) to apply.`;
          return { content: [{ type: "text" as const, text }] };
        }

        const { plan, summary } = await backpack.applyNormalization(ontology);
        trackEvent("tool_call", { tool: "backpack_normalize" });
        const empty =
          plan.nodeTypeRenames.length === 0 &&
          plan.edgeTypeRenames.length === 0;
        const text = empty
          ? `No type drift detected. Nothing changed.`
          : `Normalization applied.\n${summary.nodeRenameCount} node type rename(s) affecting ${summary.totalAffectedNodes} node(s).\n${summary.edgeRenameCount} edge type rename(s) affecting ${summary.totalAffectedEdges} edge(s).\n\nPlan:\n${JSON.stringify(plan, null, 2)}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return formatWriteError(backpack, ontology, err);
      }
    },
  );

  server.registerTool(
    "backpack_lock_status",
    {
      title: "Lock Status",
      description:
        "Read the current edit heartbeat for a learning graph. Returns the most recent author and timestamp if there's been activity in the last 5 minutes, otherwise null. Use this to see whether a collaborator is currently editing a shared graph before starting your own changes.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to check"),
      },
    },
    async ({ ontology }) => {
      try {
        const lock = await backpack.getLockInfo(ontology);
        trackEvent("tool_call", { tool: "backpack_lock_status" });
        const text =
          lock === null
            ? `No active editor on "${ontology}". Safe to write.`
            : `Active editor on "${ontology}":\n${JSON.stringify(lock, null, 2)}`;
        return { content: [{ type: "text" as const, text }] };
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
    "backpack_health",
    {
      title: "Graph Health Check",
      description:
        "Run all audits on a learning graph in one call: connectivity audit, three-role rule audit, type drift detection (no commit), token count, lock status. Use this to get a complete picture of a graph's quality before deciding what to fix.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph to check"),
      },
    },
    async ({ ontology }) => {
      try {
        const [describe, audit, roles, normalize, lock, tokens] = await Promise.all([
          backpack.describeOntology(ontology),
          backpack.auditOntology(ontology),
          backpack.auditRoles(ontology),
          backpack.planNormalization(ontology),
          backpack.getLockInfo(ontology),
          backpack.getGraphTokens(ontology),
        ]);
        trackEvent("tool_call", { tool: "backpack_health" });
        const report = {
          name: ontology,
          totalTokens: tokens,
          nodeCount: describe.nodeCount,
          edgeCount: describe.edgeCount,
          density: describe.stats.density,
          orphans: audit.orphans.length,
          weakNodes: audit.weakNodes.length,
          sparseTypes: audit.sparseTypes.length,
          roleViolations: {
            procedural: roles.proceduralCandidates.length,
            briefing: roles.briefingCandidates.length,
          },
          typeDrift: {
            nodeRenames: normalize.nodeTypeRenames.length,
            edgeRenames: normalize.edgeTypeRenames.length,
          },
          activeEditor: lock,
          suggestions: audit.suggestions,
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(report, null, 2) },
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
        return formatWriteError(backpack, ontology, err);
      }
    }
  );
}
