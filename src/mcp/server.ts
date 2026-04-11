import * as crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Backpack } from "../core/backpack.js";
import { RemoteRegistry } from "../core/remote-registry.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { BackpackAppBackend } from "../storage/backpack-app-backend.js";
import { OAuthClient } from "../auth/oauth.js";
import { initTelemetry } from "../core/telemetry.js";
import { registerOntologyTools, registerDiscoveryAuditTool } from "./tools/ontology-tools.js";
import { registerNodeTools } from "./tools/node-tools.js";
import { registerEdgeTools } from "./tools/edge-tools.js";
import { registerBulkTools } from "./tools/bulk-tools.js";
import { registerVersionTools } from "./tools/version-tools.js";
import { registerIntelligenceTools } from "./tools/intelligence-tools.js";
import { registerRemoteTools } from "./tools/remote-tools.js";
import { registerBackpackTools } from "./tools/backpack-tools.js";

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
  let backpack: Backpack;

  if (!config || config.mode === "local") {
    // Local mode: resolve the active backpack from the registry. First
    // run seeds a default "personal" entry pointing at the user's
    // existing graphs directory, so upgrades from 0.3.x are transparent.
    // A custom `config.dataDir` is honored only when explicitly passed —
    // mostly used by tests. Normal users go through the registry.
    if (config?.dataDir) {
      backpack = new Backpack(new JsonFileBackend(config.dataDir));
    } else {
      backpack = await Backpack.fromActiveBackpack();
    }
  } else if ("token" in config) {
    backpack = new Backpack(new BackpackAppBackend(config.url, config.token));
  } else {
    // OAuth2 SSO — opens browser on first run, caches tokens
    const cacheKey = crypto
      .createHash("sha256")
      .update(config.url)
      .digest("hex")
      .slice(0, 12);
    const oauth = new OAuthClient(config.clientId, config.issuerUrl, cacheKey);
    backpack = new Backpack(
      new BackpackAppBackend(config.url, () => oauth.getAccessToken()),
    );
  }

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

Viewer links: when the user asks to see a graph, show a graph, or wants a link, construct a clickable URL.
- Graph link: http://localhost:5173#graph-name
- Graph with focused nodes: http://localhost:5173#graph-name?node=nodeId1,nodeId2
Always provide these as clickable markdown links, e.g. [View graph](http://localhost:5173#my-graph)
If the viewer isn't running, tell the user to start it with: npx backpack-viewer

After updating a learning graph, include a link to view it.

Be selective — not every conversation needs to be captured. Focus on knowledge with lasting value: relationships, decisions, architecture, processes, domain concepts, conventions.`,
    }
  );

  // The remote graph registry lives parallel to the local storage. It only
  // matters when running against the local file backend (cloud users get
  // their remotes via the cloud backend's own subscription model in the
  // future). For now we always create one — it's cheap.
  const remoteRegistry = new RemoteRegistry(
    config && config.mode === "local" ? config.dataDir : undefined,
  );
  await remoteRegistry.initialize();

  // Register all tool groups
  registerOntologyTools(server, backpack);
  registerDiscoveryAuditTool(server);
  registerNodeTools(server, backpack);
  registerEdgeTools(server, backpack);
  registerBulkTools(server, backpack);
  registerVersionTools(server, backpack);
  registerIntelligenceTools(server, backpack);
  registerRemoteTools(server, backpack, remoteRegistry);
  // Local mode gets backpack (meta) management tools — cloud mode
  // doesn't need them since the cloud backend is a single target.
  if (!config || config.mode === "local") {
    registerBackpackTools(server, backpack);
  }

  return server;
}
