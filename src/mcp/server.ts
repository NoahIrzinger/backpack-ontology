import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Backpack } from "../core/backpack.js";
import type { StorageBackend } from "../core/types.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { BackpackAppBackend } from "../storage/backpack-app-backend.js";
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

/** Configuration for Backpack App cloud storage. */
export interface BackpackAppConfig {
  mode: "app";
  url: string;
  token: string;
}

export type BackpackServerConfig = BackpackLocalConfig | BackpackAppConfig;

/**
 * Create and configure the MCP server.
 *
 * Supports two modes:
 *   - "local" (default): JSON files on disk
 *   - "app": Backpack App cloud API
 */
export async function createMcpServer(
  config?: BackpackServerConfig
): Promise<McpServer> {
  let backend: StorageBackend;
  if (!config || config.mode === "local") {
    backend = new JsonFileBackend(config?.dataDir);
  } else {
    backend = new BackpackAppBackend(config.url, config.token);
  }

  const backpack = new Backpack(backend);
  await backpack.initialize();

  // Initialize telemetry (non-blocking, fails silently)
  try { await initTelemetry(backpack); } catch { /* noop */ }

  const server = new McpServer(
    {
      name: "backpack",
      version: "0.2.0",
    },
    {
      instructions: `Backpack is a persistent knowledge graph that remembers what matters across conversations.

When you learn something meaningful — a business relationship, a technical decision, a process, a domain concept — consider adding it to backpack. Use backpack_list to see what ontologies exist and backpack_describe to understand their structure before adding to them. Create a new ontology when the topic is distinct from existing ones.

After updating an ontology, let the user know they can visualize their knowledge graph by running: npx backpack-viewer (opens http://localhost:5173)

Be selective — not every conversation needs to be captured. Focus on knowledge with lasting value: relationships, decisions, architecture, processes, domain concepts, conventions.`,
    },
  );

  // Register all tool groups
  registerOntologyTools(server, backpack);
  registerNodeTools(server, backpack);
  registerEdgeTools(server, backpack);
  registerBulkTools(server, backpack);

  return server;
}
