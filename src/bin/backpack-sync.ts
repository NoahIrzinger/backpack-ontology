#!/usr/bin/env node
//
// backpack-sync — Sync Protocol v0.1 CLI for backpack-ontology.
//
// Subcommands:
//   register <name> [--color #...] [--tags a,b]   Register backpack with relay
//   push    [<name>]                              Push local → relay
//   pull    [<name>]                              Pull relay → local
//   sync    [<name>]                              Bidirectional (pull then push)
//   status  [<name>]                              Show pending changes
//   unregister [<name>]                           Drop sync state and remote record
//   legacy                                        Run the previous one-shot uploader
//
// If <name> is omitted, defaults to the active backpack from
// backpacks-registry. Authentication: BACKPACK_APP_TOKEN env var (preferred
// for CI/scripting), otherwise OAuth via .mcp.json discovery (same as legacy).

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { JsonFileBackend } from "../storage/json-file-backend.js";
import { BackpackAppBackend } from "../storage/backpack-app-backend.js";
import { OAuthClient } from "../auth/oauth.js";
import { loadConfig } from "../core/config.js";
import { DocumentStore } from "../core/document-store.js";
import {
  getActiveBackpack,
  getBackpack,
  getKBMounts,
  colorForPath,
} from "../core/backpacks-registry.js";

import { SyncClient } from "../sync/sync-client.js";
import { SyncRelayClient } from "../sync/sync-relay.js";
import type { SyncRunResult } from "../sync/types.js";

const DEFAULTS = {
  url: "https://app.backpackontology.com",
  clientId: "YOUR_ENTRA_CLIENT_ID_HERE",
  issuerUrl: "https://YOUR_TENANT.ciamlogin.com/YOUR_TENANT_ID/v2.0",
};

// ---------- shared auth setup ----------

interface AuthEnv {
  apiUrl: string;
  clientId: string;
  issuerUrl: string;
  staticToken?: string;
}

async function discoverMcpConfig(): Promise<Partial<AuthEnv> & { token?: string }> {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const mcpPath = path.join(dir, ".mcp.json");
    try {
      const raw = await fs.readFile(mcpPath, "utf-8");
      const config = JSON.parse(raw) as {
        mcpServers?: Record<string, { env?: Record<string, string> }>;
      };
      for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
        if (name.startsWith("backpack-app") && server.env) {
          if (server.env.NODE_TLS_REJECT_UNAUTHORIZED) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = server.env.NODE_TLS_REJECT_UNAUTHORIZED;
          }
          return {
            apiUrl: server.env.BACKPACK_APP_URL,
            clientId: server.env.BACKPACK_APP_CLIENT_ID,
            issuerUrl: server.env.BACKPACK_APP_ISSUER_URL,
            token: server.env.BACKPACK_APP_TOKEN,
          };
        }
      }
    } catch {
      // ignore
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

async function buildAuth(): Promise<AuthEnv & { tokenProvider: () => Promise<string> }> {
  const discovered = await discoverMcpConfig();
  const apiUrl = process.env.BACKPACK_APP_URL || discovered.apiUrl || DEFAULTS.url;
  const clientId = process.env.BACKPACK_APP_CLIENT_ID || discovered.clientId || DEFAULTS.clientId;
  const issuerUrl = process.env.BACKPACK_APP_ISSUER_URL || discovered.issuerUrl || DEFAULTS.issuerUrl;
  const staticToken = process.env.BACKPACK_APP_TOKEN || discovered.token;

  let tokenProvider: () => Promise<string>;
  if (staticToken) {
    tokenProvider = async () => staticToken;
  } else {
    const cacheKey = crypto.createHash("sha256").update(apiUrl).digest("hex").slice(0, 12);
    const oauth = new OAuthClient(clientId, issuerUrl, cacheKey);
    tokenProvider = () => oauth.getAccessToken();
  }
  return { apiUrl, clientId, issuerUrl, staticToken, tokenProvider };
}

async function buildClient(name?: string): Promise<{
  client: SyncClient;
  backpackPath: string;
  backpackName: string;
  apiUrl: string;
}> {
  const auth = await buildAuth();
  const entry = name ? await getBackpack(name) : await getActiveBackpack();
  if (!entry) {
    throw new Error(`backpack not found: ${name ?? "<active>"}`);
  }
  const relay = new SyncRelayClient({ baseUrl: auth.apiUrl, token: auth.tokenProvider });
  const client = new SyncClient({ backpackPath: entry.path, relay });
  return { client, backpackPath: entry.path, backpackName: entry.name, apiUrl: auth.apiUrl };
}

// ---------- subcommands ----------

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        flags[a.slice(2)] = args[++i] ?? "";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cmdRegister(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  if (positional.length === 0) {
    throw new Error("usage: backpack-sync register <name> [--color #hex] [--tags a,b]");
  }
  const name = positional[0];
  const { client, backpackPath, apiUrl } = await buildClient(name);
  const color = flags.color ?? colorForPath(backpackPath);
  const tags = flags.tags ? flags.tags.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const state = await client.register({ name, color, tags });
  console.log("");
  console.log(`  Registered "${name}" with ${apiUrl}`);
  console.log(`  Backpack ID: ${state.backpack_id}`);
  console.log(`  Run \`backpack-sync push ${name}\` to upload artifacts.`);
  console.log("");
}

function describeResult(name: string, result: SyncRunResult): void {
  console.log(`  Backpack: ${name}`);
  if (result.pushed.length) console.log(`  Pushed:        ${result.pushed.length}`);
  if (result.pulled.length) console.log(`  Pulled:        ${result.pulled.length}`);
  if (result.deleted_remote.length) console.log(`  Deleted (cloud): ${result.deleted_remote.length}`);
  if (result.deleted_local.length) console.log(`  Deleted (local): ${result.deleted_local.length}`);
  if (result.conflicts.length) {
    console.log(`  Conflicts:     ${result.conflicts.length}`);
    for (const c of result.conflicts) {
      console.log(`    - ${c.artifact_id} → ${c.conflict_path}`);
    }
  }
  if (result.errors.length) {
    console.log(`  Errors:        ${result.errors.length}`);
    for (const e of result.errors) {
      console.log(`    - ${e.artifact_id ?? "(none)"}: ${e.message}`);
    }
  }
  if (
    result.pushed.length === 0 &&
    result.pulled.length === 0 &&
    result.deleted_remote.length === 0 &&
    result.deleted_local.length === 0 &&
    result.conflicts.length === 0 &&
    result.errors.length === 0
  ) {
    console.log("  Already in sync.");
  }
}

async function cmdPush(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const { client, backpackName } = await buildClient(positional[0]);
  const result = await client.push();
  describeResult(backpackName, result);
}

async function cmdPull(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const { client, backpackName } = await buildClient(positional[0]);
  const result = await client.pull();
  describeResult(backpackName, result);
}

async function cmdSync(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const { client, backpackName } = await buildClient(positional[0]);
  const result = await client.sync();
  describeResult(backpackName, result);
}

async function cmdStatus(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const { client, backpackName } = await buildClient(positional[0]);
  const status = await client.status();
  console.log("");
  console.log(`  Backpack: ${backpackName}`);
  if (!status.registered) {
    console.log("  Not registered. Run `backpack-sync register <name>` to enable sync.");
    console.log("");
    return;
  }
  console.log(`  Registered: ${status.state?.backpack_id}`);
  console.log(`  Last sync:  ${status.state?.last_sync_at ?? "never"}`);
  console.log(`  Up to date: ${status.upToDate}`);
  console.log(`  Local only: ${status.localOnly.length}`);
  if (status.localOnly.length) {
    for (const id of status.localOnly) console.log(`    + ${id}`);
  }
  console.log(`  Remote only: ${status.remoteOnly.length}`);
  if (status.remoteOnly.length) {
    for (const id of status.remoteOnly) console.log(`    - ${id}`);
  }
  console.log(`  Diverged:   ${status.diverged.length}`);
  if (status.diverged.length) {
    for (const id of status.diverged) console.log(`    ! ${id}`);
  }
  console.log("");
}

async function cmdUnregister(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const { client, backpackName } = await buildClient(positional[0]);
  await client.unregister();
  console.log(`  Unregistered ${backpackName} (sync state cleared, remote record deleted if present).`);
}

// ---------- legacy one-shot uploader (preserved for backward compat) ----------

async function cmdLegacy(): Promise<void> {
  const auth = await buildAuth();
  console.log("");
  console.log("  Backpack Sync (legacy mode) — upload local ontologies to Backpack App");
  console.log(`  Target: ${auth.apiUrl}`);
  console.log("");

  const config = await loadConfig();
  const local = new JsonFileBackend(config.dataDir);
  await local.initialize();

  const tokenProvider = auth.tokenProvider;
  const remote = new BackpackAppBackend(auth.apiUrl, tokenProvider);

  const localOntologies = await local.listOntologies();
  if (localOntologies.length === 0) {
    console.log("  No local ontologies found. Nothing to sync.");
    console.log("");
    return;
  }
  console.log(`  Found ${localOntologies.length} local ontology(s):`);
  for (const o of localOntologies) {
    console.log(`    - ${o.name} (${o.nodeCount} nodes, ${o.edgeCount} edges)`);
  }
  console.log("");

  let remoteNames: Set<string>;
  try {
    const remoteOntologies = await remote.listOntologies();
    remoteNames = new Set(remoteOntologies.map((o) => o.name));
  } catch (err) {
    console.error(`  Failed to connect to Backpack App at ${auth.apiUrl}:`, (err as Error).message);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const summary of localOntologies) {
    const data = await local.loadOntology(summary.name);
    const exists = remoteNames.has(summary.name);
    if (exists) {
      await remote.saveOntology(summary.name, data);
      updated++;
      console.log(`  Updated: ${summary.name}`);
    } else {
      try {
        await remote.createOntology(summary.name, data.metadata.description);
        await remote.saveOntology(summary.name, data);
        created++;
        console.log(`  Created: ${summary.name}`);
      } catch (err) {
        console.error(`  Failed: ${summary.name} — ${(err as Error).message}`);
        skipped++;
      }
    }
  }

  console.log("");
  console.log(`  Done. ${created} created, ${updated} updated, ${skipped} failed.`);

  // Sync KB documents from active backpack default mount
  let docsSynced = 0;
  try {
    const activeEntry = await getActiveBackpack();
    const mountConfigs = await getKBMounts(activeEntry.path);
    const docStore = new DocumentStore(
      mountConfigs.map((m) => ({ name: m.name, path: m.path, writable: m.writable !== false })),
    );
    const result = await docStore.list();
    if (result.documents.length > 0) {
      console.log("");
      console.log(`  Found ${result.documents.length} KB document(s) to sync.`);
      for (const summary of result.documents) {
        try {
          const doc = await docStore.read(summary.id);
          const token = await tokenProvider();
          const resp = await fetch(
            `${auth.apiUrl}/api/kb/documents/${encodeURIComponent(doc.id)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify(doc),
            },
          );
          if (resp.ok) {
            docsSynced++;
            console.log(`  Synced doc: ${doc.title}`);
          } else {
            console.error(`  Failed doc: ${doc.title} — ${resp.status}`);
          }
        } catch (err) {
          console.error(`  Failed doc: ${summary.title} — ${(err as Error).message}`);
        }
      }
    }
  } catch {
    // No KB configured
  }
  console.log("");
}

// ---------- entry ----------

function printHelp(): void {
  console.log("");
  console.log("  backpack-sync — bidirectional sync for Backpack");
  console.log("");
  console.log("  USAGE:");
  console.log("    backpack-sync register <name> [--color #hex] [--tags a,b]");
  console.log("    backpack-sync push   [<name>]");
  console.log("    backpack-sync pull   [<name>]");
  console.log("    backpack-sync sync   [<name>]   (bidirectional, default if no subcommand)");
  console.log("    backpack-sync status [<name>]");
  console.log("    backpack-sync unregister [<name>]");
  console.log("    backpack-sync legacy             (one-shot publish, original behavior)");
  console.log("");
  console.log("  AUTH:");
  console.log("    BACKPACK_APP_TOKEN=...             Static bearer token");
  console.log("    BACKPACK_APP_URL=...               Override relay URL");
  console.log("    Otherwise OAuth via .mcp.json discovery (same as MCP server)");
  console.log("");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printHelp();
    return;
  }

  switch (sub) {
    case "register":
      await cmdRegister(rest);
      return;
    case "push":
      await cmdPush(rest);
      return;
    case "pull":
      await cmdPull(rest);
      return;
    case "sync":
      await cmdSync(rest);
      return;
    case "status":
      await cmdStatus(rest);
      return;
    case "unregister":
      await cmdUnregister(rest);
      return;
    case "legacy":
      await cmdLegacy();
      return;
    default:
      // Backward compatibility: if invoked with no subcommand-style arg
      // (e.g. someone passes a backpack name directly), treat as legacy.
      console.error(`unknown subcommand: ${sub}`);
      printHelp();
      process.exit(2);
  }
}

main().catch((error) => {
  console.error("Error:", error?.message ?? error);
  process.exit(1);
});
