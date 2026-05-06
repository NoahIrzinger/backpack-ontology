import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const pkg = require("../../package.json") as { version: string; name: string };

export const PACKAGE_NAME: string = pkg.name;
export const PACKAGE_VERSION: string = pkg.version;

let mcpSdkVersion = "unknown";
try {
  // The SDK's "exports" field doesn't expose package.json, and its top-level
  // CJS entry is missing, so resolve a known subpath that exists in CJS form
  // and walk up directories looking for the package's own package.json.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const entry = require.resolve("@modelcontextprotocol/sdk/server/mcp.js");
  let dir = path.dirname(entry);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      const sdkPkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string; version?: string };
      if (sdkPkg.name === "@modelcontextprotocol/sdk" && sdkPkg.version) {
        mcpSdkVersion = sdkPkg.version;
        break;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
} catch {
  /* SDK not resolvable in this context — fall back to "unknown" */
}
export const MCP_SDK_VERSION: string = mcpSdkVersion;
