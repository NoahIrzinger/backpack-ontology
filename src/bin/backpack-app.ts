#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";
import { shutdown as shutdownTelemetry } from "../core/telemetry.js";

async function main() {
  const apiUrl = process.env.BACKPACK_APP_URL;
  const apiToken = process.env.BACKPACK_APP_TOKEN;

  if (!apiUrl || !apiToken) {
    console.error("Required env vars: BACKPACK_APP_URL, BACKPACK_APP_TOKEN");
    process.exit(1);
  }

  const server = await createMcpServer({ mode: "app", url: apiUrl, token: apiToken });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Backpack App MCP server running on stdio (${apiUrl})`);
}

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
