#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";
import { ensureHooksInstalled } from "../core/hooks.js";
import { shutdown as shutdownTelemetry } from "../core/telemetry.js";

// Production defaults — users never need to configure these.
// Env vars override for development/testing only.
const DEFAULTS = {
  url: "https://app.backpackontology.com",
  clientId: "2d84f4b4-0c8c-4eb5-8f26-4dabc7f07551",
  issuerUrl: "https://8522cad6-89da-465d-ad30-7c1ac03c52c7.ciamlogin.com/8522cad6-89da-465d-ad30-7c1ac03c52c7/v2.0",
};

async function main() {
  // Install hooks on first run (silent, non-blocking)
  ensureHooksInstalled().catch(() => {});

  const apiUrl = process.env.BACKPACK_APP_URL || DEFAULTS.url;
  const clientId = process.env.BACKPACK_APP_CLIENT_ID || DEFAULTS.clientId;
  const issuerUrl = process.env.BACKPACK_APP_ISSUER_URL || DEFAULTS.issuerUrl;
  const staticToken = process.env.BACKPACK_APP_TOKEN;

  const server = await createMcpServer(
    staticToken
      ? { mode: "app", url: apiUrl, token: staticToken }
      : { mode: "app", url: apiUrl, clientId, issuerUrl }
  );

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
