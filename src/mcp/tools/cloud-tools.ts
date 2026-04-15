import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Backpack } from "../../core/backpack.js";
import { OAuthClient } from "../../auth/oauth.js";
import { configDir } from "../../core/paths.js";
import { trackEvent } from "../../core/telemetry.js";

const RELAY_URL = process.env.BACKPACK_APP_URL || "https://app.backpackontology.com";
const CLIENT_ID = process.env.BACKPACK_APP_CLIENT_ID || "2d84f4b4-0c8c-4eb5-8f26-4dabc7f07551";
const ISSUER_URL = process.env.BACKPACK_APP_ISSUER_URL || "https://8522cad6-89da-465d-ad30-7c1ac03c52c7.ciamlogin.com/8522cad6-89da-465d-ad30-7c1ac03c52c7/v2.0";

/** Try to find a valid cloud token from viewer settings or OAuth cache. */
export async function resolveCloudToken(): Promise<string | null> {
  // 1. Check viewer extension settings (from Sign In in the viewer)
  try {
    const settingsPath = path.join(configDir(), "extensions", "share", "settings.json");
    const raw = await fs.readFile(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    if (settings.relay_token && typeof settings.relay_token === "string") {
      // Check JWT expiry
      const parts = settings.relay_token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        if (!payload.exp || payload.exp * 1000 > Date.now()) {
          return settings.relay_token;
        }
      }
    }
  } catch { /* no viewer settings */ }

  // 2. Check OAuth token cache (from backpack_cloud_login or backpack-sync)
  try {
    const cacheKey = crypto.createHash("sha256").update(RELAY_URL).digest("hex").slice(0, 12);
    const cachePath = path.join(configDir(), "app-tokens", `${cacheKey}.json`);
    const raw = await fs.readFile(cachePath, "utf8");
    const cached = JSON.parse(raw);
    const token = cached.id_token || cached.access_token;
    if (token && (!cached.expires_at || cached.expires_at * 1000 > Date.now())) {
      return token;
    }
  } catch { /* no cached token */ }

  return null;
}

/** Decode email from a JWT token. */
function emailFromToken(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      return payload.email || payload.preferred_username;
    }
  } catch {}
  return undefined;
}

export function registerCloudTools(
  server: McpServer,
  backpack: Backpack,
): void {
  // --- backpack_cloud_login ---
  server.registerTool(
    "backpack_cloud_login",
    {
      title: "Sign In to Cloud",
      description:
        "Authenticate with Backpack App to access cloud-synced graphs. " +
        "Opens the system browser for sign-in. If already signed in, returns the current account.",
    },
    async () => {
      trackEvent("tool_call", { tool: "backpack_cloud_login" });

      // Check if already authenticated
      const existing = await resolveCloudToken();
      if (existing) {
        const email = emailFromToken(existing);
        return {
          content: [{ type: "text" as const, text: `Already signed in${email ? ` as ${email}` : ""}. Use backpack_cloud_list to see cloud graphs.` }],
        };
      }

      // Start OAuth flow
      const cacheKey = crypto.createHash("sha256").update(RELAY_URL).digest("hex").slice(0, 12);
      const oauth = new OAuthClient(CLIENT_ID, ISSUER_URL, cacheKey);
      const token = await oauth.getAccessToken();
      const email = emailFromToken(token);

      return {
        content: [{ type: "text" as const, text: `Signed in${email ? ` as ${email}` : ""}. Use backpack_cloud_list to see your cloud graphs.` }],
      };
    }
  );

  // --- backpack_cloud_list ---
  server.registerTool(
    "backpack_cloud_list",
    {
      title: "List Cloud Graphs",
      description:
        "List all learning graphs in the user's cloud backpack (Backpack App). " +
        "Shows names, descriptions, node/edge counts, and whether each graph is encrypted. " +
        "Requires authentication — use backpack_cloud_login first if not signed in.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      trackEvent("tool_call", { tool: "backpack_cloud_list" });
      const token = await resolveCloudToken();
      if (!token) {
        return {
          content: [{ type: "text" as const, text: "Not signed in to Backpack App. Use backpack_cloud_login to authenticate, then try again." }],
        };
      }

      const res = await fetch(`${RELAY_URL}/api/graphs`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          return {
            content: [{ type: "text" as const, text: "Cloud session expired. Use backpack_cloud_login to re-authenticate." }],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Failed to list cloud graphs: ${res.status}` }],
        };
      }

      const graphs = await res.json() as { name: string; description?: string; nodeCount?: number; edgeCount?: number; encrypted?: boolean; source?: string }[];
      if (graphs.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No graphs in your cloud backpack. Use the viewer's Share extension to sync local graphs to the cloud." }],
        };
      }

      const email = emailFromToken(token);
      const lines = [`Cloud backpack${email ? ` (${email})` : ""}: ${graphs.length} graph(s)\n`];
      for (const g of graphs) {
        const badges: string[] = [];
        if (g.encrypted) badges.push("encrypted");
        if (g.source === "local") badges.push("synced");
        const badgeStr = badges.length > 0 ? ` [${badges.join(", ")}]` : "";
        lines.push(`- ${g.name}${badgeStr}: ${g.nodeCount ?? "?"} nodes, ${g.edgeCount ?? "?"} edges`);
        if (g.description) lines.push(`  ${g.description}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  // --- backpack_cloud_import ---
  server.registerTool(
    "backpack_cloud_import",
    {
      title: "Import Cloud Graph",
      description:
        "Pull a graph from the cloud backpack into the local backpack as an editable copy. " +
        "Encrypted graphs cannot be imported this way — use the viewer to decrypt them first. " +
        "If a local graph with the same name exists, use asLocalName to rename on import.",
      inputSchema: {
        name: z.string().describe("Name of the cloud graph to import"),
        asLocalName: z.string().optional().describe("Local name for the imported graph (defaults to the cloud name)"),
      },
    },
    async ({ name, asLocalName }) => {
      trackEvent("tool_call", { tool: "backpack_cloud_import" });
      const token = await resolveCloudToken();
      if (!token) {
        return {
          content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }],
        };
      }

      // Check if it's encrypted
      const listRes = await fetch(`${RELAY_URL}/api/graphs`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!listRes.ok) {
        return { content: [{ type: "text" as const, text: "Failed to access cloud backpack." }] };
      }
      const graphs = await listRes.json() as { name: string; encrypted?: boolean }[];
      const target = graphs.find(g => g.name === name);
      if (!target) {
        return { content: [{ type: "text" as const, text: `Graph "${name}" not found in cloud backpack.` }] };
      }
      if (target.encrypted) {
        return { content: [{ type: "text" as const, text: `Graph "${name}" is encrypted. Encrypted graphs cannot be imported via MCP — open the graph in the viewer to decrypt it, or re-sync it as plaintext from the viewer's Share panel.` }] };
      }

      // Download the graph
      const dataRes = await fetch(`${RELAY_URL}/api/graphs/${encodeURIComponent(name)}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!dataRes.ok) {
        return { content: [{ type: "text" as const, text: `Failed to download graph "${name}": ${dataRes.status}` }] };
      }
      const data = await dataRes.json();

      // Save locally
      const localName = asLocalName || name;
      const exists = await backpack.ontologyExists(localName);
      if (exists) {
        return { content: [{ type: "text" as const, text: `A local graph named "${localName}" already exists. Use a different name with asLocalName, or delete the local one first.` }] };
      }
      await backpack.createOntologyFromData(localName, data);

      return {
        content: [{ type: "text" as const, text: `Imported "${name}" from cloud as "${localName}". ${data.nodes?.length ?? 0} nodes, ${data.edges?.length ?? 0} edges. You can now use backpack_search, backpack_describe, etc.` }],
      };
    }
  );
}

/** Count cloud graphs (for the hint in backpack_list). Returns 0 on any error. */
export async function countCloudGraphs(): Promise<number> {
  try {
    const token = await resolveCloudToken();
    if (!token) return 0;
    const res = await fetch(`${RELAY_URL}/api/graphs`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return 0;
    const graphs = await res.json();
    return Array.isArray(graphs) ? graphs.length : 0;
  } catch {
    return 0;
  }
}
