import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import {
  registerBackpack,
  unregisterBackpack,
  listBackpacks,
  getActiveBackpack,
} from "../../core/backpacks-registry.js";

/**
 * Tools that manage the set of registered backpacks and which one is
 * currently active. These live in the meta-layer — they don't touch
 * learning graph content, only the pointer to where graphs live.
 */
export function registerBackpackTools(
  server: McpServer,
  backpack: Backpack,
): void {
  server.registerTool(
    "backpack_register",
    {
      title: "Register a Backpack",
      description:
        "Add a backpack — a pointer to a graphs directory that lets the user switch between multiple collections of learning graphs (personal, a shared OneDrive folder, a project-specific folder, etc). The display name is derived from the last segment of the path (e.g. '/Users/me/OneDrive/work' shows as 'work'). The path is created if it doesn't exist. Registering an already-registered path is a no-op. Does not switch to the new backpack unless activate=true.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute or tilde-expanded path to the directory that will hold learning graphs (e.g. '~/OneDrive/work', '/Users/me/Dropbox/family-backpack', '/Volumes/share/team-backpack')",
          ),
        activate: z
          .boolean()
          .optional()
          .describe(
            "If true, switch the active backpack to this new one immediately after registering",
          ),
      },
    },
    async ({ path, activate }) => {
      try {
        const entry = await registerBackpack(path);
        let switchedTo: string | null = null;
        if (activate) {
          await backpack.switchBackpack(entry.path);
          switchedTo = entry.name;
        }
        trackEvent("tool_call", { tool: "backpack_register" });
        const text =
          switchedTo !== null
            ? `Registered backpack "${entry.name}" at ${entry.path} and switched to it.`
            : `Registered backpack "${entry.name}" at ${entry.path}. Call backpack_switch to make it active.`;
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
    "backpack_switch",
    {
      title: "Switch Active Backpack",
      description:
        "Change which backpack is currently active. All subsequent reads and writes go to the new backpack's graphs directory. The previous backpack's data is untouched and can be switched back to at any time. Accepts either a derived display name (e.g. 'work') or an absolute path.",
      inputSchema: {
        name: z
          .string()
          .describe(
            "Display name OR absolute path of the registered backpack to switch to",
          ),
      },
    },
    async ({ name }) => {
      try {
        const entry = await backpack.switchBackpack(name);
        trackEvent("tool_call", { tool: "backpack_switch" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Active backpack is now "${entry.name}" (${entry.path}).`,
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
    },
  );

  server.registerTool(
    "backpack_active",
    {
      title: "Active Backpack",
      description:
        "Show which backpack is currently active. Cheap to call — the agent should use this any time it needs to confirm context before writing to or reading from a graph.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      try {
        const entry = await getActiveBackpack();
        trackEvent("tool_call", { tool: "backpack_active" });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(entry, null, 2),
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
    },
  );

  server.registerTool(
    "backpack_registered",
    {
      title: "List Registered Backpacks",
      description:
        "List every backpack the user has registered, marking which one is currently active. Use this to show the user their options before a switch.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      try {
        const entries = await listBackpacks();
        const active = await getActiveBackpack();
        trackEvent("tool_call", { tool: "backpack_registered" });
        const marked = entries.map((e) => ({
          ...e,
          active: e.name === active.name,
        }));
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(marked, null, 2) },
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
    "backpack_unregister",
    {
      title: "Unregister a Backpack",
      description:
        "Remove a backpack from the registry. Does NOT delete any data — the graphs directory at the backpack's path is left alone. Refuses to unregister the last remaining backpack. If the removed backpack was active, the first remaining backpack becomes active automatically. Accepts either a display name or an absolute path.",
      inputSchema: {
        name: z
          .string()
          .describe("Display name OR absolute path of the backpack to unregister"),
      },
    },
    async ({ name }) => {
      try {
        const current = backpack.getActiveBackpackEntry();
        const wasActive =
          current &&
          (current.name === name || current.path === name);
        await unregisterBackpack(name);
        if (wasActive) {
          // Registry auto-switched to the first remaining — sync the
          // Backpack instance to match.
          const nowActive = await getActiveBackpack();
          await backpack.switchBackpack(nowActive.path);
        }
        trackEvent("tool_call", { tool: "backpack_unregister" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Unregistered "${name}". Data at its path is untouched.`,
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
    },
  );
}
