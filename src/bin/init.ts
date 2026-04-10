#!/usr/bin/env node
import { removeBackpackHooks } from "../core/hooks.js";

/**
 * `backpack-init` — clean up any Backpack hooks left in .claude/settings.json
 * by older versions. Auto-installation of hooks is no longer supported; this
 * command exists so users can explicitly run the cleanup without restarting
 * their MCP server.
 */
async function main() {
  await removeBackpackHooks();
  console.log("");
  console.log("  Backpack hook cleanup complete.");
  console.log("");
  console.log("  Backpack no longer installs hooks into .claude/settings.json.");
  console.log("");
}

main().catch((error) => {
  console.error("Error:", error.message ?? error);
  process.exit(1);
});
