import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Backpack } from "../core/backpack.js";
import type { StorageBackend } from "../core/types.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { registerOntologyTools } from "./tools/ontology-tools.js";
import { registerNodeTools } from "./tools/node-tools.js";
import { registerEdgeTools } from "./tools/edge-tools.js";
import { registerBulkTools } from "./tools/bulk-tools.js";

/**
 * Create and configure the MCP server.
 *
 * Pass a custom StorageBackend to use something other than JSON files.
 * If omitted, defaults to JsonFileBackend (~/.backpack/).
 */
export async function createMcpServer(
  storage?: StorageBackend
): Promise<McpServer> {
  const backend = storage ?? new JsonFileBackend();
  const backpack = new Backpack(backend);
  await backpack.initialize();

  const server = new McpServer({
    name: "backpack",
    version: "0.1.0",
  });

  // Register all tool groups
  registerOntologyTools(server, backpack);
  registerNodeTools(server, backpack);
  registerEdgeTools(server, backpack);
  registerBulkTools(server, backpack);

  return server;
}
