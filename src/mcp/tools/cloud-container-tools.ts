import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { BackpackAppBackend } from "../../storage/backpack-app-backend.js";

/**
 * Container-level tools for cloud (`mode: "app"`) MCP servers.
 *
 * These manage sync_backpacks — the user's top-level containers (one
 * per local-synced device folder, plus a "cloud" container for
 * cloud-native artifacts). They are deliberately separate from the
 * local-mode `backpack_register` tool, which takes a filesystem path
 * and would be meaningless in the cloud sidecar.
 *
 * Naming overlap with graph-level `backpack_*` tools is unfortunate
 * but kept for backwards-compat; the tool descriptions disambiguate.
 */
export function registerCloudContainerTools(
  server: McpServer,
  backpack: Backpack,
): void {
  // Backend type guard — these tools only make sense against the
  // cloud REST API. Bail out gracefully if the host wired us up wrong.
  const cloud = backpackCloudBackend(backpack);
  if (!cloud) return;

  server.registerTool(
    "backpack_list",
    {
      title: "List Backpacks",
      description:
        "List all backpack containers the user owns in the cloud. Each entry has id, name, color, origin_kind ('cloud' or 'local'), and origin_device_name when synced from a device. Use this before backpack_switch to see what's available, and to pick a target id for backpack_move_graph or backpack_move_kb.",
      inputSchema: {},
    },
    async () => {
      try {
        const list = await cloud.listSyncBackpacks();
        trackEvent("tool_call", { tool: "backpack_list" });
        const lines = list.map((bp) => {
          const where = bp.origin_kind === "cloud"
            ? "cloud-native"
            : `synced from ${bp.origin_device_name ?? "device"}`;
          const active = bp.id === cloud.activeSyncBackpackId ? "  [active]" : "";
          return `- ${bp.name} · ${where} · ${bp.id}${active}`;
        });
        const text = lines.length === 0
          ? "No backpacks yet. Use backpack_register to create one."
          : `Backpacks (${list.length}):\n${lines.join("\n")}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_register",
    {
      title: "Create Backpack (Cloud Container)",
      description:
        "Create a new cloud-native backpack container. Use this when the user wants a brand new top-level backpack to organize a separate area of work (e.g. 'project', 'consulting', 'side-projects'). Returns the new backpack's id; pass it to backpack_switch if you want subsequent graph creates to land there.",
      inputSchema: {
        name: z.string().min(1).describe("Display name for the new backpack (e.g. 'project')"),
        color: z.string().optional().describe("Hex color for the picker dot (defaults to a stable cloud blue)"),
        tags: z.array(z.string()).optional().describe("Optional tags for organization"),
      },
    },
    async ({ name, color, tags }) => {
      try {
        const created = await cloud.registerSyncBackpack(name, color, tags);
        trackEvent("tool_call", { tool: "backpack_register" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created backpack "${created.name}" (id: ${created.id}). Call backpack_switch with this id to make it the active target for new graphs.`,
            },
          ],
        };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_switch",
    {
      title: "Switch Active Backpack",
      description:
        "Set the active backpack container for this MCP session. Subsequent backpack_create (graph) calls and KB writes will land in this backpack. Pass either the backpack id (preferred) or its display name; ambiguous names error out. Pass an empty string or 'cloud' to revert to the user's cloud-native default.",
      inputSchema: {
        target: z.string().describe("Backpack id (UUID) or unique display name"),
      },
    },
    async ({ target }) => {
      try {
        const list = await cloud.listSyncBackpacks();
        const trimmed = target.trim();
        let chosen: typeof list[number] | undefined;
        if (trimmed === "" || trimmed.toLowerCase() === "cloud") {
          chosen = list.find((b) => b.origin_kind === "cloud");
        } else {
          chosen = list.find((b) => b.id === trimmed);
          if (!chosen) {
            const byName = list.filter((b) => b.name === trimmed);
            if (byName.length > 1) {
              return {
                content: [{
                  type: "text" as const,
                  text: `Multiple backpacks named "${trimmed}". Pass an id from backpack_list instead.`,
                }],
                isError: true,
              };
            }
            chosen = byName[0];
          }
        }
        if (!chosen) {
          return {
            content: [{ type: "text" as const, text: `No backpack found matching "${target}".` }],
            isError: true,
          };
        }
        cloud.activeSyncBackpackId = chosen.id;
        trackEvent("tool_call", { tool: "backpack_switch" });
        return {
          content: [{
            type: "text" as const,
            text: `Active backpack is now "${chosen.name}" (id: ${chosen.id}). New graphs and KB docs will land here.`,
          }],
        };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_active",
    {
      title: "Get Active Backpack",
      description:
        "Return which backpack container is currently the target for new graph and KB writes in this session. If unset, the user's cloud-native default is implied.",
      inputSchema: {},
    },
    async () => {
      try {
        const list = await cloud.listSyncBackpacks();
        const active = cloud.activeSyncBackpackId
          ? list.find((b) => b.id === cloud.activeSyncBackpackId)
          : list.find((b) => b.origin_kind === "cloud");
        if (!active) {
          return {
            content: [{ type: "text" as const, text: "No active backpack set and no cloud-native default exists yet." }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Active: "${active.name}" (id: ${active.id}, ${active.origin_kind}).`,
          }],
        };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_rename",
    {
      title: "Rename Backpack",
      description:
        "Rename, recolor, or retag a backpack container. Pass the backpack id from backpack_list. Any field omitted keeps its current value.",
      inputSchema: {
        id: z.string().describe("Backpack id (UUID) — get it from backpack_list"),
        name: z.string().optional().describe("New display name"),
        color: z.string().optional().describe("New hex color"),
        tags: z.array(z.string()).optional().describe("New tags (replaces; not merged)"),
      },
    },
    async ({ id, name, color, tags }) => {
      try {
        const updated = await cloud.renameSyncBackpack(id, { name, color, tags });
        trackEvent("tool_call", { tool: "backpack_rename" });
        return { content: [{ type: "text" as const, text: `Updated backpack: "${updated.name}" (${updated.id})` }] };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_unregister",
    {
      title: "Delete Backpack",
      description:
        "Delete an empty backpack container. Refuses if the backpack still contains graphs or KB docs — call backpack_move_graph / backpack_move_kb first to relocate them, or delete each artifact individually.",
      inputSchema: {
        id: z.string().describe("Backpack id (UUID) — get it from backpack_list"),
      },
    },
    async ({ id }) => {
      try {
        await cloud.deleteSyncBackpack(id);
        if (cloud.activeSyncBackpackId === id) cloud.activeSyncBackpackId = null;
        trackEvent("tool_call", { tool: "backpack_unregister" });
        return { content: [{ type: "text" as const, text: `Deleted backpack ${id}.` }] };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_describe_container",
    {
      title: "Describe Backpack",
      description:
        "Inspect a backpack container's manifest: list of graphs and KB docs it contains, with sync versions. Use this to see what's inside a backpack before deleting or moving things.",
      inputSchema: {
        id: z.string().describe("Backpack id (UUID)"),
      },
    },
    async ({ id }) => {
      try {
        const m = await cloud.getSyncBackpackManifest(id) as {
          name: string;
          artifacts: Array<{ artifact_id: string; version: number; deleted?: boolean }>;
        };
        const live = m.artifacts.filter((a) => !a.deleted);
        const lines = live.map((a) => `- ${a.artifact_id} (v${a.version})`);
        const text = `Backpack "${m.name}" contains ${live.length} artifact(s):\n${lines.join("\n") || "(empty)"}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_move_graph",
    {
      title: "Move Graph to Different Backpack",
      description:
        "Relocate a graph from its current backpack into a different one. The graph keeps its id, history, and shares; only the parent backpack changes. Use this to fix a misplaced graph (e.g. created in 'cloud' when you wanted it in 'project').",
      inputSchema: {
        graphName: z.string().describe("The graph's name"),
        targetBackpackId: z.string().describe("The destination backpack id (UUID) — get from backpack_list"),
      },
    },
    async ({ graphName, targetBackpackId }) => {
      try {
        await cloud.moveGraphToBackpack(targetBackpackId, graphName);
        trackEvent("tool_call", { tool: "backpack_move_graph" });
        return { content: [{ type: "text" as const, text: `Moved graph "${graphName}" to backpack ${targetBackpackId}.` }] };
      } catch (err) {
        return errorOut(err);
      }
    },
  );

  server.registerTool(
    "backpack_move_kb",
    {
      title: "Move KB Document to Different Backpack",
      description:
        "Relocate a KB document into a different backpack container. Same idea as backpack_move_graph but for KB docs.",
      inputSchema: {
        docId: z.string().describe("KB doc id"),
        targetBackpackId: z.string().describe("Destination backpack id (UUID)"),
      },
    },
    async ({ docId, targetBackpackId }) => {
      try {
        await cloud.moveKBToBackpack(targetBackpackId, docId);
        trackEvent("tool_call", { tool: "backpack_move_kb" });
        return { content: [{ type: "text" as const, text: `Moved KB doc "${docId}" to backpack ${targetBackpackId}.` }] };
      } catch (err) {
        return errorOut(err);
      }
    },
  );
}

/** Best-effort guard so cloud-only tools don't blow up on a local backend. */
function backpackCloudBackend(backpack: Backpack): BackpackAppBackend | null {
  // Backpack stores its backend on `.storage` (see core/backpack.ts).
  const candidate = (backpack as unknown as { storage?: unknown }).storage;
  if (candidate instanceof BackpackAppBackend) return candidate;
  return null;
}

function errorOut(err: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
    isError: true,
  };
}
