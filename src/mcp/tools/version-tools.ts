import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";

export function registerVersionTools(
  server: McpServer,
  backpack: Backpack
): void {
  // --- Branch tools ---

  server.registerTool(
    "backpack_branch_list",
    {
      title: "List Branches",
      description: "List all branches for a learning graph with node/edge counts and which is active.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
      },
    },
    async ({ ontology }) => {
      try {
        const branches = await backpack.listBranches(ontology);
        trackEvent("tool_call", { tool: "backpack_branch_list" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(branches, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_branch_create",
    {
      title: "Create Branch",
      description: "Create a new branch by forking the active branch (or a specified source branch). Use this to create variants of a graph or start fresh while preserving the original.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        name: z.string().describe("Name for the new branch"),
        from: z.string().optional().describe("Source branch to fork from (defaults to active branch)"),
      },
    },
    async ({ ontology, name, from }) => {
      try {
        await backpack.createBranch(ontology, name, from as string | undefined);
        trackEvent("tool_call", { tool: "backpack_branch_create" });
        return {
          content: [{ type: "text" as const, text: `Branch "${name}" created.` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_branch_switch",
    {
      title: "Switch Branch",
      description: "Switch the active branch for a learning graph. All subsequent operations will read/write this branch.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        name: z.string().describe("Branch to switch to"),
      },
    },
    async ({ ontology, name }) => {
      try {
        await backpack.switchBranch(ontology, name);
        trackEvent("tool_call", { tool: "backpack_branch_switch" });
        return {
          content: [{ type: "text" as const, text: `Switched to branch "${name}".` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_branch_delete",
    {
      title: "Delete Branch",
      description: "Delete a branch and its snapshots. Cannot delete the active branch — switch to another branch first.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        name: z.string().describe("Branch to delete"),
      },
    },
    async ({ ontology, name }) => {
      try {
        await backpack.deleteBranch(ontology, name);
        trackEvent("tool_call", { tool: "backpack_branch_delete" });
        return {
          content: [{ type: "text" as const, text: `Branch "${name}" deleted.` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Snapshot tools ---

  server.registerTool(
    "backpack_snapshot",
    {
      title: "Create Snapshot",
      description: "Save a snapshot of the current branch state. Use this before making risky changes. Snapshots are automatically pruned when the limit is reached.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        label: z.string().optional().describe("Optional label for this snapshot (e.g. 'before restructuring')"),
      },
    },
    async ({ ontology, label }) => {
      try {
        const version = await backpack.createSnapshot(ontology, label as string | undefined);
        trackEvent("tool_call", { tool: "backpack_snapshot" });
        return {
          content: [{ type: "text" as const, text: `Snapshot #${version} created.` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_versions",
    {
      title: "List Snapshots",
      description: "List available snapshots for the active branch of a learning graph.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
      },
    },
    async ({ ontology }) => {
      try {
        const snapshots = await backpack.listSnapshots(ontology);
        trackEvent("tool_call", { tool: "backpack_versions" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(snapshots, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_rollback",
    {
      title: "Rollback to Snapshot",
      description: "Restore the active branch to a previous snapshot. The current state is NOT automatically saved — create a snapshot first if you want to preserve it.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        version: z.number().int().describe("Snapshot version number to restore"),
      },
    },
    async ({ ontology, version }) => {
      try {
        await backpack.rollback(ontology, version);
        trackEvent("tool_call", { tool: "backpack_rollback" });
        return {
          content: [{ type: "text" as const, text: `Rolled back to snapshot #${version}.` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_diff",
    {
      title: "Diff with Snapshot",
      description: "Compare the current active branch state with a snapshot. Returns nodes and edges that were added or removed.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        version: z.number().int().describe("Snapshot version number to compare against"),
      },
    },
    async ({ ontology, version }) => {
      try {
        const diff = await backpack.diffWithSnapshot(ontology, version);
        trackEvent("tool_call", { tool: "backpack_diff" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(diff, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- Snippet tools ---

  server.registerTool(
    "backpack_save_snippet",
    {
      title: "Save Snippet",
      description: "Save a named subgraph snippet — a subset of nodes and edges from a learning graph. If edgeIds is omitted, all edges between the given nodes are included automatically.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        label: z.string().describe("Human-readable label for the snippet"),
        description: z.string().optional().describe("Optional description of what this snippet captures"),
        nodeIds: z.array(z.string()).describe("Node IDs to include in the snippet"),
        edgeIds: z.array(z.string()).optional().describe("Edge IDs to include (auto-detected if omitted)"),
      },
    },
    async ({ ontology, label, description, nodeIds, edgeIds }) => {
      try {
        const id = await backpack.saveSnippet(ontology, {
          label,
          description: description as string | undefined,
          nodeIds,
          edgeIds: edgeIds ?? [],
        });
        trackEvent("tool_call", { tool: "backpack_save_snippet" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id, label }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_list_snippets",
    {
      title: "List Snippets",
      description: "List saved snippets for a learning graph.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
      },
    },
    async ({ ontology }) => {
      try {
        const snippets = await backpack.listSnippets(ontology);
        trackEvent("tool_call", { tool: "backpack_list_snippets" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(snippets, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_load_snippet",
    {
      title: "Load Snippet",
      description: "Load the full data for a saved snippet, including its nodes and edges.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        snippetId: z.string().describe("ID of the snippet to load"),
      },
    },
    async ({ ontology, snippetId }) => {
      try {
        const snippet = await backpack.loadSnippet(ontology, snippetId);
        trackEvent("tool_call", { tool: "backpack_load_snippet" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(snippet, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "backpack_delete_snippet",
    {
      title: "Delete Snippet",
      description: "Delete a saved snippet from a learning graph.",
      inputSchema: {
        ontology: z.string().describe("Name or tag of the learning graph"),
        snippetId: z.string().describe("ID of the snippet to delete"),
      },
    },
    async ({ ontology, snippetId }) => {
      try {
        await backpack.deleteSnippet(ontology, snippetId);
        trackEvent("tool_call", { tool: "backpack_delete_snippet" });
        return {
          content: [{ type: "text" as const, text: `Snippet "${snippetId}" deleted.` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
