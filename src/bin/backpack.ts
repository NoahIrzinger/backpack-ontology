#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { loadConfig } from "../core/config.js";
import { shutdown as shutdownTelemetry } from "../core/telemetry.js";

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

// Graceful shutdown — flush telemetry before exit
async function gracefulShutdown() {
  await shutdownTelemetry();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
