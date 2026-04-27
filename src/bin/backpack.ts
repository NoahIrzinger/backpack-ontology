#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";
import { loadConfig } from "../core/config.js";
import { removeBackpackHooks } from "../core/hooks.js";
import { shutdown as shutdownTelemetry } from "../core/telemetry.js";
import { runStartupSync } from "../sync/auto-sync.js";

async function main() {
  const config = await loadConfig();

  // Clean up any hooks installed by older versions (silent, non-blocking)
  removeBackpackHooks().catch(() => {});

  const server = await createMcpServer({ mode: "local", dataDir: config.dataDir });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr because stdout is reserved for the MCP protocol
  console.error("Backpack MCP server running on stdio");

  // Background pull for any sync-registered backpacks. Fire-and-forget;
  // errors go to stderr and never block server startup. Set
  // BACKPACK_SYNC_AUTOPULL=0 to opt out.
  if (process.env.BACKPACK_SYNC_AUTOPULL !== "0") {
    runStartupSync();
  }
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
