#!/usr/bin/env node
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { BackpackAppBackend } from "../storage/backpack-app-backend.js";
import { OAuthClient } from "../auth/oauth.js";
import { loadConfig } from "../core/config.js";
import { DocumentStore } from "../core/document-store.js";
import { getKBMounts } from "../core/backpacks-registry.js";
import { getActiveBackpack } from "../core/backpacks-registry.js";

const DEFAULTS = {
  url: "https://app.backpackontology.com",
  clientId: "YOUR_ENTRA_CLIENT_ID_HERE",
  issuerUrl: "https://YOUR_TENANT.ciamlogin.com/YOUR_TENANT_ID/v2.0",
};

/**
 * Try to read backpack-app config from .mcp.json in the current directory
 * or parent directories. This lets sync reuse the same auth as the MCP server.
 */
async function discoverMcpConfig(): Promise<{
  url?: string;
  clientId?: string;
  issuerUrl?: string;
  token?: string;
} | null> {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const mcpPath = path.join(dir, ".mcp.json");
    try {
      const raw = await fs.readFile(mcpPath, "utf-8");
      const config = JSON.parse(raw) as {
        mcpServers?: Record<string, { env?: Record<string, string> }>;
      };

      // Look for any backpack-app server config
      for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
        if (name.startsWith("backpack-app") && server.env) {
          // Apply TLS override if configured (for local dev with self-signed certs)
          if (server.env.NODE_TLS_REJECT_UNAUTHORIZED) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED =
              server.env.NODE_TLS_REJECT_UNAUTHORIZED;
          }
          return {
            url: server.env.BACKPACK_APP_URL,
            clientId: server.env.BACKPACK_APP_CLIENT_ID,
            issuerUrl: server.env.BACKPACK_APP_ISSUER_URL,
            token: server.env.BACKPACK_APP_TOKEN,
          };
        }
      }
    } catch {
      // No .mcp.json here, try parent
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main() {
  // Auto-discover config from .mcp.json if no env vars are set
  const discovered = await discoverMcpConfig();

  const apiUrl =
    process.env.BACKPACK_APP_URL ||
    discovered?.url ||
    DEFAULTS.url;
  const clientId =
    process.env.BACKPACK_APP_CLIENT_ID ||
    discovered?.clientId ||
    DEFAULTS.clientId;
  const issuerUrl =
    process.env.BACKPACK_APP_ISSUER_URL ||
    discovered?.issuerUrl ||
    DEFAULTS.issuerUrl;
  const staticToken =
    process.env.BACKPACK_APP_TOKEN ||
    discovered?.token;

  console.log("");
  console.log("  Backpack Sync — upload local ontologies to Backpack App");
  console.log(`  Target: ${apiUrl}`);
  console.log("");

  // Set up local backend
  const config = await loadConfig();
  const local = new JsonFileBackend(config.dataDir);
  await local.initialize();

  // Set up remote backend + token provider for KB sync
  let remote: BackpackAppBackend;
  let getToken: () => Promise<string>;
  if (staticToken) {
    remote = new BackpackAppBackend(apiUrl, staticToken);
    getToken = async () => staticToken;
  } else {
    const cacheKey = crypto
      .createHash("sha256")
      .update(apiUrl)
      .digest("hex")
      .slice(0, 12);
    const oauth = new OAuthClient(clientId, issuerUrl, cacheKey);
    remote = new BackpackAppBackend(apiUrl, () => oauth.getAccessToken());
    getToken = () => oauth.getAccessToken();
  }

  // List local ontologies
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

  // Check which already exist remotely
  let remoteNames: Set<string>;
  try {
    const remoteOntologies = await remote.listOntologies();
    remoteNames = new Set(remoteOntologies.map((o) => o.name));
  } catch (err) {
    console.error(
      `  Failed to connect to Backpack App at ${apiUrl}:`,
      (err as Error).message
    );
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
        console.error(
          `  Failed: ${summary.name} — ${(err as Error).message}`
        );
        skipped++;
      }
    }
  }

  console.log("");
  console.log(
    `  Done. ${created} created, ${updated} updated, ${skipped} failed.`
  );

  // --- Sync KB documents ---
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
          // Upload document as a graph-associated resource via the app API
          const token = await getToken();
          const resp = await fetch(
            `${apiUrl}/api/kb/documents/${encodeURIComponent(doc.id)}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
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
    // No KB configured — skip
  }

  if (created + updated > 0 || docsSynced > 0) {
    console.log("");
    console.log(`  Your ontologies${docsSynced > 0 ? ` and ${docsSynced} KB document(s)` : ""} are now in Backpack App.`);
    console.log(
      "  To switch to cloud mode, update your .mcp.json to use backpack-app"
    );
    console.log("  instead of backpack.");
  }
  console.log("");
}

main().catch((error) => {
  console.error("Error:", error.message ?? error);
  process.exit(1);
});
