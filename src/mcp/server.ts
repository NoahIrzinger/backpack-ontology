import * as crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Backpack } from "../core/backpack.js";
import type { StorageBackend } from "../core/types.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { BackpackAppBackend } from "../storage/backpack-app-backend.js";
import { OAuthClient } from "../auth/oauth.js";
import { initTelemetry } from "../core/telemetry.js";
import { registerOntologyTools } from "./tools/ontology-tools.js";
import { registerNodeTools } from "./tools/node-tools.js";
import { registerEdgeTools } from "./tools/edge-tools.js";
import { registerBulkTools } from "./tools/bulk-tools.js";

/** Configuration for local file-based storage. */
export interface BackpackLocalConfig {
  mode: "local";
  dataDir?: string;
}

/** Configuration for Backpack App with a static token. */
export interface BackpackAppTokenConfig {
  mode: "app";
  url: string;
  token: string;
}

/** Configuration for Backpack App with OAuth2/OIDC SSO. */
export interface BackpackAppOAuthConfig {
  mode: "app";
  url: string;
  clientId: string;
  issuerUrl: string;
}

export type BackpackAppConfig = BackpackAppTokenConfig | BackpackAppOAuthConfig;
export type BackpackServerConfig = BackpackLocalConfig | BackpackAppConfig;

/**
 * Create and configure the MCP server.
 *
 * Supports two modes:
 *   - "local" (default): JSON files on disk
 *   - "app": Backpack App cloud API (via static token or OAuth2 SSO)
 */
export async function createMcpServer(
  config?: BackpackServerConfig
): Promise<McpServer> {
  let backend: StorageBackend;

  if (!config || config.mode === "local") {
    backend = new JsonFileBackend(config?.dataDir);
  } else if ("token" in config) {
    backend = new BackpackAppBackend(config.url, config.token);
  } else {
    // OAuth2 SSO — opens browser on first run, caches tokens
    const cacheKey = crypto
      .createHash("sha256")
      .update(config.url)
      .digest("hex")
      .slice(0, 12);
    const oauth = new OAuthClient(config.clientId, config.issuerUrl, cacheKey);
    backend = new BackpackAppBackend(config.url, () => oauth.getAccessToken());
  }

  const backpack = new Backpack(backend);
  await backpack.initialize();

  // Initialize telemetry (non-blocking, fails silently)
  try {
    await initTelemetry(backpack);
  } catch {
    /* noop */
  }

  const server = new McpServer(
    {
      name: "backpack",
      version: "0.2.0",
    },
    {
      instructions: `Backpack is the user's persistent knowledge base that carries what matters across conversations. Think of it as a single backpack the user carries everywhere — inside it are learning graphs, each one about a different topic (clients, processes, architecture, etc.).

There is one backpack. Inside it are learning graphs. Each learning graph contains nodes (things) connected by edges (relationships). Use backpack_list to see what's in the backpack, and backpack_describe to understand a graph's structure before adding to it. Create a new learning graph when the topic is distinct from existing ones.

After updating a learning graph, let the user know they can visualize it by running: npx backpack-viewer (opens http://localhost:5173)

Deep links: when showing the user specific nodes, include a viewer URL so they can jump directly to them. Format: http://localhost:5173#graph-name?node=nodeId1,nodeId2 — this opens the viewer, loads the graph, and focuses on those nodes.

Be selective — not every conversation needs to be captured. Focus on knowledge with lasting value: relationships, decisions, architecture, processes, domain concepts, conventions.`,
    }
  );

  // Register all tool groups
  registerOntologyTools(server, backpack);
  registerNodeTools(server, backpack);
  registerEdgeTools(server, backpack);
  registerBulkTools(server, backpack);

  return server;
}
