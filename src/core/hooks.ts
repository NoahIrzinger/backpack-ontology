import * as fs from "node:fs/promises";
import * as path from "node:path";

interface HookEntry {
  type?: string;
  prompt?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookRule {
  matcher?: string;
  hooks?: HookEntry[];
}

interface SettingsFile {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

function isBackpackHook(h: HookEntry): boolean {
  const prompt = (h.prompt ?? "").toLowerCase();
  const command = (h.command ?? "").toLowerCase();
  return prompt.includes("backpack") || command.includes("backpack");
}

function ruleHasBackpackHook(rule: HookRule): boolean {
  return rule.hooks?.some(isBackpackHook) ?? false;
}

/**
 * Remove any Backpack-originated hook entries from .claude/settings.json.
 *
 * Older versions of backpack-ontology auto-installed Stop and PostToolUse
 * hooks. The Stop hook ran a long-running agent on every conversation Stop
 * event, causing multi-minute pauses for users. Even after the install code
 * was removed, orphaned entries linger in existing settings files.
 *
 * This cleanup runs silently on MCP startup. It only touches hook rules whose
 * command or prompt mentions "backpack" — unrelated user-installed hooks are
 * left alone.
 */
export async function removeBackpackHooks(): Promise<void> {
  const settingsPath = path.join(process.cwd(), ".claude", "settings.json");

  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, "utf-8");
  } catch {
    return; // No settings file — nothing to clean up
  }

  let settings: SettingsFile;
  try {
    settings = JSON.parse(raw) as SettingsFile;
  } catch {
    return; // Malformed JSON — leave it alone
  }

  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return;

  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const rules = hooks[event];
    if (!Array.isArray(rules)) continue;

    const filtered = (rules as HookRule[]).filter((rule) => !ruleHasBackpackHook(rule));
    const dropped = rules.length - filtered.length;
    if (dropped === 0) continue;

    removed += dropped;
    if (filtered.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = filtered;
    }
  }

  if (removed === 0) return;

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  // Atomic write: write to .tmp then rename, so a concurrent reader/editor
  // can't see a half-written file.
  const tmpPath = settingsPath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, settingsPath);

  console.error(
    `Backpack: removed ${removed} orphaned hook${removed === 1 ? "" : "s"} from .claude/settings.json`
  );
}
