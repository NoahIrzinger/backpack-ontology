#!/usr/bin/env node
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `backpack-init` — set up Claude Code hooks for automatic knowledge capture.
 *
 * Writes hook configuration to .claude/settings.json in the current project,
 * enabling:
 *   1. Auto-capture (Stop hook) — background agent reviews conversations and
 *      updates ontologies when meaningful knowledge is discussed.
 *   2. Viewer suggestions (PostToolUse hook) — reminds the user they can
 *      visualize their knowledge graph after write operations.
 */

interface HookRule {
  matcher?: string;
  hooks?: Array<{ type?: string; prompt?: string; command?: string; [key: string]: unknown }>;
}

interface HooksConfig {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Check if a hook rule array already contains a backpack-originated rule. */
function hasBackpackRule(rules: HookRule[]): boolean {
  return rules.some(
    (r) =>
      r.hooks?.some(
        (h) =>
          (h.prompt && h.prompt.includes("Backpack")) ||
          (h.command && h.command.includes("backpack")),
      ) ?? false,
  );
}

async function main() {
  const projectDir = process.cwd();
  const claudeDir = path.join(projectDir, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  // Load the hooks configuration shipped with backpack-ontology
  const thisFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(thisFile), "..", "..");
  const hooksJsonPath = path.join(packageRoot, "hooks", "hooks.json");

  let hooksConfig: HooksConfig;
  try {
    const raw = await fs.readFile(hooksJsonPath, "utf-8");
    hooksConfig = JSON.parse(raw) as HooksConfig;
  } catch {
    console.error("Error: could not read hooks configuration from backpack-ontology package.");
    console.error(`Expected at: ${hooksJsonPath}`);
    process.exit(1);
  }

  // Ensure .claude directory exists
  await fs.mkdir(claudeDir, { recursive: true });

  // Read existing settings or start fresh
  let settings: HooksConfig = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    settings = JSON.parse(raw) as HooksConfig;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  // Merge hooks — backpack hooks are added alongside any existing hooks
  if (!settings.hooks) {
    settings.hooks = {};
  }
  const existingHooks = settings.hooks as Record<string, unknown>;
  const newHooks = (hooksConfig.hooks ?? {}) as Record<string, unknown>;

  let alreadyConfigured = false;
  for (const [event, rules] of Object.entries(newHooks)) {
    if (!existingHooks[event]) {
      existingHooks[event] = rules;
    } else {
      const existing = existingHooks[event];
      if (Array.isArray(existing) && hasBackpackRule(existing as HookRule[])) {
        // Backpack hooks already present for this event — skip to avoid duplicates
        alreadyConfigured = true;
        continue;
      }
      // Append backpack hook rules to existing event rules
      if (Array.isArray(existing) && Array.isArray(rules)) {
        existingHooks[event] = [...existing, ...rules];
      } else {
        existingHooks[event] = rules;
      }
    }
  }

  if (alreadyConfigured) {
    console.log("");
    console.log("  Backpack hooks are already configured in: " + settingsPath);
    console.log("  No changes made. To reconfigure, remove the existing backpack hooks first.");
    console.log("");
    return;
  }

  settings.hooks = existingHooks;

  // Write settings
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

  console.log("");
  console.log("  Backpack hooks configured successfully!");
  console.log("");
  console.log("  Enabled in: " + settingsPath);
  console.log("");
  console.log("  What's enabled:");
  console.log("    - Auto-capture: a background agent reviews your Claude conversations");
  console.log("      and automatically builds knowledge graphs from meaningful discussions.");
  console.log("    - Viewer suggestions: after ontology updates, you'll be reminded to");
  console.log("      visualize your knowledge graph with `npx backpack-viewer`.");
  console.log("");
  console.log("  To disable, remove the backpack hooks from .claude/settings.json");
  console.log("");
}

main().catch((error) => {
  console.error("Error:", error.message ?? error);
  process.exit(1);
});
