#!/usr/bin/env node
import { ensureHooksInstalled } from "../core/hooks.js";

/**
 * `backpack-init` — manually install Backpack hooks.
 *
 * Note: Hooks are now installed automatically when the MCP server starts.
 * This command exists for users who want to explicitly reinstall or verify.
 */
async function main() {
  await ensureHooksInstalled();
  console.log("");
  console.log("  Backpack hooks are installed.");
  console.log("");
  console.log("  What's enabled:");
  console.log("    - Auto-capture: a background agent reviews your Claude conversations");
  console.log("      and saves meaningful knowledge to your backpack.");
  console.log("    - Viewer suggestions: after updates, you'll be reminded to");
  console.log("      visualize your knowledge graph.");
  console.log("");
  console.log("  To disable, remove the backpack hooks from .claude/settings.json");
  console.log("");
}

main().catch((error) => {
  console.error("Error:", error.message ?? error);
  process.exit(1);
});
