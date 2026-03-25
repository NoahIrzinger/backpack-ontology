import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface HookRule {
  matcher?: string;
  hooks?: Array<{
    type?: string;
    prompt?: string;
    command?: string;
    [key: string]: unknown;
  }>;
}

interface SettingsFile {
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
          (h.command && h.command.includes("backpack"))
      ) ?? false
  );
}

/**
 * Auto-install Backpack hooks into .claude/settings.json if not already present.
 * Runs silently on MCP server startup — users opt out by removing the hooks.
 */
export async function ensureHooksInstalled(): Promise<void> {
  const projectDir = process.cwd();
  const claudeDir = path.join(projectDir, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  // Locate hooks.json shipped with the package
  const thisFile = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(thisFile), "..", "..");
  const hooksJsonPath = path.join(packageRoot, "hooks", "hooks.json");

  let hooksConfig: SettingsFile;
  try {
    const raw = await fs.readFile(hooksJsonPath, "utf-8");
    hooksConfig = JSON.parse(raw) as SettingsFile;
  } catch {
    return; // Can't read hooks config — skip silently
  }

  await fs.mkdir(claudeDir, { recursive: true });

  let settings: SettingsFile = {};
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    settings = JSON.parse(raw) as SettingsFile;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const existingHooks = settings.hooks as Record<string, unknown>;
  const newHooks = (hooksConfig.hooks ?? {}) as Record<string, unknown>;

  let changed = false;
  for (const [event, rules] of Object.entries(newHooks)) {
    if (!existingHooks[event]) {
      existingHooks[event] = rules;
      changed = true;
    } else {
      const existing = existingHooks[event];
      if (
        Array.isArray(existing) &&
        hasBackpackRule(existing as HookRule[])
      ) {
        continue; // Already installed
      }
      if (Array.isArray(existing) && Array.isArray(rules)) {
        existingHooks[event] = [...existing, ...rules];
        changed = true;
      }
    }
  }

  if (!changed) return;

  settings.hooks = existingHooks;
  await fs.writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8"
  );

  console.error(
    "Backpack hooks enabled (update notifications). " +
      "To disable, remove backpack hooks from .claude/settings.json"
  );
}
