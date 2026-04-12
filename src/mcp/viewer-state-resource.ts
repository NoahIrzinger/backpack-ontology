import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataDir } from "../core/paths.js";

const VIEWER_STATE_FILENAME = "viewer-state.json";
const STALE_AFTER_MS = 30_000;

function viewerStatePath(): string {
  return path.join(dataDir(), VIEWER_STATE_FILENAME);
}

/**
 * Register the viewer-state MCP resource.
 *
 * The Backpack viewer publishes its current state (active graph, selection,
 * focus) to a local file via its serve.js. This resource exposes that file
 * to any MCP client (Claude Code, Claude Desktop, etc.) so the LLM can ask
 * "what is the user looking at right now?" and get a grounded answer
 * without the user having to retype context.
 *
 * Returns a small JSON object with the active graph name, selected node
 * ids, optional focus state, an updatedAt timestamp, and a `stale` flag
 * that flips true if the viewer hasn't published anything in the last
 * STALE_AFTER_MS — useful for the LLM to know whether to trust it.
 */
export function registerViewerStateResource(server: McpServer): void {
  server.registerResource(
    "viewer-current",
    "backpack://viewer/current",
    {
      title: "Backpack Viewer — Current View",
      description:
        "What the user is currently looking at in the Backpack viewer: active graph, selected nodes, focus state. Read this to ground graph questions in the user's current visual context. Returns { graph, selection, focus, updatedAt, stale } or { error } if the viewer isn't running.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const raw = await fs.readFile(viewerStatePath(), "utf8");
        const state = JSON.parse(raw);
        const updatedAtMs = state.updatedAt
          ? new Date(state.updatedAt).getTime()
          : 0;
        const stale = !updatedAtMs || Date.now() - updatedAtMs > STALE_AFTER_MS;
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ ...state, stale }, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  error:
                    "Viewer state not available — the Backpack viewer may not be running. Start it with: npx backpack-viewer",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
