#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { loadConfig } from "../core/config.js";

async function main() {
  const config = await loadConfig();

  // Config dataDir overrides the default XDG path
  const backend = new JsonFileBackend(config.dataDir);

  const server = await createMcpServer(backend);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr because stdout is reserved for the MCP protocol
  console.error("Backpack MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
