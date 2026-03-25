#!/usr/bin/env node
/**
 * Prints a fresh Authorization header for MCP SSE connections.
 * Reads the cached Entra id_token, refreshes if expired.
 *
 * Usage: npx -p backpack-ontology@latest backpack-token
 * Output: Authorization: Bearer <id_token>
 *
 * Used with Claude Code's --header-command flag for SSE auth.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { configDir } from "../core/paths.js";
import { OAuthClient } from "../auth/oauth.js";

const DEFAULTS = {
  clientId: "2d84f4b4-0c8c-4eb5-8f26-4dabc7f07551",
  issuerUrl:
    "https://8522cad6-89da-465d-ad30-7c1ac03c52c7.ciamlogin.com/8522cad6-89da-465d-ad30-7c1ac03c52c7/v2.0",
};

async function main() {
  const clientId = process.env.BACKPACK_APP_CLIENT_ID || DEFAULTS.clientId;
  const issuerUrl = process.env.BACKPACK_APP_ISSUER_URL || DEFAULTS.issuerUrl;
  const url = process.env.BACKPACK_APP_URL || "https://app.backpackontology.com";

  // Static token override
  const staticToken = process.env.BACKPACK_APP_TOKEN;
  if (staticToken) {
    process.stdout.write(`Authorization: Bearer ${staticToken}\n`);
    process.exit(0);
  }

  // Use OAuth client with same cache key as backpack-app
  const crypto = await import("node:crypto");
  const cacheKey = crypto
    .createHash("sha256")
    .update(url)
    .digest("hex")
    .slice(0, 12);

  const oauth = new OAuthClient(clientId, issuerUrl, cacheKey);
  const token = await oauth.getAccessToken();
  process.stdout.write(`Authorization: Bearer ${token}\n`);
}

main().catch((err) => {
  console.error("Failed to get token:", err.message);
  process.exit(1);
});
