// Auto-sync hooks for the local MCP server.
//
// Runs in the background on MCP server startup: for each registered backpack
// that has sync state on disk, run a `pull` so the user picks up any changes
// that landed via cloud MCP / phone / web while the local MCP wasn't running.
//
// All errors are logged to stderr (stdout is reserved for the MCP protocol)
// and never block server startup.

import * as crypto from "node:crypto";

import { listBackpacks } from "../core/backpacks-registry.js";
import { OAuthClient } from "../auth/oauth.js";

import { SyncClient } from "./sync-client.js";
import { SyncRelayClient } from "./sync-relay.js";
import { readSyncState } from "./sync-state.js";

export interface AutoSyncOptions {
  /** Suppress all output (used in tests). */
  silent?: boolean;
}

/**
 * Trigger a pull for every registered backpack that has sync state.
 * Returns immediately; the actual sync runs in the background.
 */
export function runStartupSync(opts: AutoSyncOptions = {}): void {
  void runStartupSyncAsync(opts).catch((err) => {
    if (!opts.silent) {
      process.stderr.write(`auto-sync: top-level error — ${(err as Error).message}\n`);
    }
  });
}

async function runStartupSyncAsync(opts: AutoSyncOptions): Promise<void> {
  let backpacks;
  try {
    backpacks = await listBackpacks();
  } catch (err) {
    if (!opts.silent) {
      process.stderr.write(`auto-sync: could not list backpacks — ${(err as Error).message}\n`);
    }
    return;
  }

  for (const entry of backpacks) {
    const state = await readSyncState(entry.path).catch(() => null);
    if (!state || !state.relay_url || !state.backpack_id) continue;

    const tokenProvider = await buildTokenProvider(state.relay_url);
    if (!tokenProvider) {
      if (!opts.silent) {
        process.stderr.write(
          `auto-sync: ${entry.name} has sync state but no auth available — skipping\n`,
        );
      }
      continue;
    }

    const relay = new SyncRelayClient({ baseUrl: state.relay_url, token: tokenProvider });
    const client = new SyncClient({ backpackPath: entry.path, relay });

    try {
      const result = await client.pull();
      if (!opts.silent) {
        const summary =
          result.pulled.length === 0 && result.deleted_local.length === 0 && result.errors.length === 0
            ? "in sync"
            : `pulled ${result.pulled.length}, deleted ${result.deleted_local.length}, errors ${result.errors.length}`;
        process.stderr.write(`auto-sync: ${entry.name} — ${summary}\n`);
      }
    } catch (err) {
      if (!opts.silent) {
        process.stderr.write(`auto-sync: ${entry.name} — ${(err as Error).message}\n`);
      }
    }
  }
}

async function buildTokenProvider(relayUrl: string): Promise<(() => Promise<string>) | null> {
  // Static bearer token from env (CI / scripted setups)
  if (process.env.BACKPACK_APP_TOKEN) {
    const tok = process.env.BACKPACK_APP_TOKEN;
    return () => Promise.resolve(tok);
  }
  // OAuth via .mcp.json (same path the MCP server already uses)
  const clientId = process.env.BACKPACK_APP_CLIENT_ID;
  const issuerUrl = process.env.BACKPACK_APP_ISSUER_URL;
  if (!clientId || !issuerUrl) return null;
  const cacheKey = crypto.createHash("sha256").update(relayUrl).digest("hex").slice(0, 12);
  const oauth = new OAuthClient(clientId, issuerUrl, cacheKey);
  return () => oauth.getAccessToken();
}
