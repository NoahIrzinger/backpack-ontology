// ============================================================
// Registry of backpacks (graph directories).
//
// A "backpack" in this sense is a named pointer to a directory of
// learning graphs. Users can have multiple backpacks (personal, work,
// family, a shared OneDrive folder, etc) and switch between them —
// only one is ever active at a time. All reads and writes go to the
// active backpack's graphs directory.
//
// Two config files:
//   ~/.config/backpack/backpacks.json   — registered backpack list
//   ~/.config/backpack/active.json      — which one is active
//
// Env var $BACKPACK_ACTIVE overrides the active.json selection for
// the current process (useful for running two Claude Code sessions
// against different backpacks from different shells).
//
// On first run the registry is seeded with one backpack named
// "personal" pointing at the user's existing graphs directory
// (respecting BACKPACK_DIR / XDG_DATA_HOME for backward compat).
// ============================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { configDir, dataDir } from "./paths.js";

// --- Types ---

export interface BackpackEntry {
  /** Short unique name, kebab-case. */
  name: string;
  /** Absolute path to a directory that will hold learning graphs. */
  path: string;
  /** 6-digit hex color derived from the name hash (deterministic). */
  color: string;
}

export interface BackpacksConfigFile {
  version: number;
  backpacks: BackpackEntry[];
}

export interface ActiveConfigFile {
  version: number;
  name: string;
}

const CONFIG_VERSION = 1;
const DEFAULT_NAME = "personal";
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// --- Errors ---

export class BackpackRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BackpackRegistryError";
  }
}

// --- Helpers ---

/**
 * Derive a stable 6-digit hex color from a backpack name. Same name
 * always produces the same color. Used for the viewer's per-backpack
 * indicator so users don't have to pick colors manually.
 */
export function colorForName(name: string): string {
  const hash = crypto.createHash("sha256").update(name).digest();
  // Take three bytes and constrain luminance so the color is readable
  // on both light and dark backgrounds. Pull from different positions
  // of the hash to avoid RGB correlation.
  const r = 80 + (hash[0] % 140);
  const g = 80 + (hash[7] % 140);
  const b = 80 + (hash[15] % 140);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function validateName(name: string): void {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new BackpackRegistryError(
      `invalid backpack name "${name}": must match /^[a-z0-9][a-z0-9_-]{0,31}$/`,
      "INVALID_NAME",
    );
  }
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function normalizePath(p: string): string {
  const expanded = expandHome(p);
  return path.resolve(expanded);
}

// --- File paths ---

function backpacksConfigFile(): string {
  return path.join(configDir(), "backpacks.json");
}

function activeConfigFile(): string {
  return path.join(configDir(), "active.json");
}

// --- IO ---

async function readJsonOrNull<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, p);
}

// --- Seed defaults ---

/**
 * Compute the default path for the "personal" backpack on first run.
 * Honors BACKPACK_DIR and XDG_DATA_HOME so users upgrading from 0.3.x
 * with a custom data directory keep their graphs.
 */
function defaultPersonalPath(): string {
  return path.join(dataDir(), "graphs");
}

function defaultPersonalEntry(): BackpackEntry {
  return {
    name: DEFAULT_NAME,
    path: defaultPersonalPath(),
    color: colorForName(DEFAULT_NAME),
  };
}

// --- Public API ---

/**
 * Load the registry, seeding the default "personal" entry if the file
 * does not yet exist. Also seeds active.json to "personal" on first run.
 */
export async function loadRegistry(): Promise<BackpacksConfigFile> {
  const existing = await readJsonOrNull<BackpacksConfigFile>(backpacksConfigFile());
  if (existing && Array.isArray(existing.backpacks)) return existing;

  const seeded: BackpacksConfigFile = {
    version: CONFIG_VERSION,
    backpacks: [defaultPersonalEntry()],
  };
  await writeJsonAtomic(backpacksConfigFile(), seeded);
  // Seed active too, but only if missing (don't clobber)
  const activeExists = (await readJsonOrNull<ActiveConfigFile>(activeConfigFile())) !== null;
  if (!activeExists) {
    await writeJsonAtomic(activeConfigFile(), {
      version: CONFIG_VERSION,
      name: DEFAULT_NAME,
    });
  }
  return seeded;
}

export async function listBackpacks(): Promise<BackpackEntry[]> {
  const registry = await loadRegistry();
  return registry.backpacks;
}

export async function getBackpack(name: string): Promise<BackpackEntry | null> {
  const registry = await loadRegistry();
  return registry.backpacks.find((b) => b.name === name) ?? null;
}

/**
 * Register a new backpack. Fails if the name is invalid, the name is
 * already taken, or the path is unusable. The path is normalized
 * (tilde-expanded, resolved to absolute) before storage.
 */
export async function registerBackpack(
  name: string,
  rawPath: string,
): Promise<BackpackEntry> {
  validateName(name);
  const registry = await loadRegistry();
  if (registry.backpacks.some((b) => b.name === name)) {
    throw new BackpackRegistryError(
      `backpack "${name}" is already registered`,
      "DUPLICATE_NAME",
    );
  }

  const resolvedPath = normalizePath(rawPath);

  // Ensure the directory exists and is writable. If it doesn't exist,
  // try to create it — a common case for "register a new share before
  // putting anything in it."
  try {
    await fs.mkdir(resolvedPath, { recursive: true });
  } catch (err) {
    throw new BackpackRegistryError(
      `cannot create or access path "${resolvedPath}": ${(err as Error).message}`,
      "PATH_UNUSABLE",
    );
  }

  const entry: BackpackEntry = {
    name,
    path: resolvedPath,
    color: colorForName(name),
  };
  registry.backpacks.push(entry);
  await writeJsonAtomic(backpacksConfigFile(), registry);
  return entry;
}

/**
 * Unregister a backpack. Does not delete its data. Refuses to remove
 * the last remaining backpack (there must always be at least one).
 * If the removed backpack was active, falls back to the first remaining.
 */
export async function unregisterBackpack(name: string): Promise<void> {
  validateName(name);
  const registry = await loadRegistry();
  const idx = registry.backpacks.findIndex((b) => b.name === name);
  if (idx === -1) {
    throw new BackpackRegistryError(
      `backpack "${name}" is not registered`,
      "NOT_FOUND",
    );
  }
  if (registry.backpacks.length <= 1) {
    throw new BackpackRegistryError(
      `cannot unregister the last remaining backpack`,
      "LAST_BACKPACK",
    );
  }
  registry.backpacks.splice(idx, 1);
  await writeJsonAtomic(backpacksConfigFile(), registry);

  // If this was the active one, switch to the first remaining
  const active = await readJsonOrNull<ActiveConfigFile>(activeConfigFile());
  if (active && active.name === name) {
    await writeJsonAtomic(activeConfigFile(), {
      version: CONFIG_VERSION,
      name: registry.backpacks[0].name,
    });
  }
}

/**
 * Return the name of the currently-active backpack. Resolution order:
 *   1. $BACKPACK_ACTIVE env var (if set and resolves to a registered name)
 *   2. name from ~/.config/backpack/active.json
 *   3. first entry in the registry
 *
 * Loads (and seeds) the registry as a side effect, so a fresh install
 * always has something to return.
 */
export async function getActiveBackpack(): Promise<BackpackEntry> {
  const registry = await loadRegistry();
  if (registry.backpacks.length === 0) {
    // Shouldn't happen — loadRegistry seeds — but guard anyway.
    const seed = defaultPersonalEntry();
    registry.backpacks.push(seed);
    await writeJsonAtomic(backpacksConfigFile(), registry);
  }

  // 1. Env var override (opt-in per session)
  const envName = process.env.BACKPACK_ACTIVE;
  if (envName) {
    const match = registry.backpacks.find((b) => b.name === envName);
    if (match) return match;
    // Env var points at an unknown name — ignore it rather than crash.
  }

  // 2. active.json
  const active = await readJsonOrNull<ActiveConfigFile>(activeConfigFile());
  if (active && typeof active.name === "string") {
    const match = registry.backpacks.find((b) => b.name === active.name);
    if (match) return match;
  }

  // 3. Fall through to first entry
  return registry.backpacks[0];
}

/**
 * Persist a new active backpack selection. Rejects unknown names.
 * Does not honor or touch the env var override (that's session-scoped).
 */
export async function setActiveBackpack(name: string): Promise<BackpackEntry> {
  validateName(name);
  const registry = await loadRegistry();
  const entry = registry.backpacks.find((b) => b.name === name);
  if (!entry) {
    throw new BackpackRegistryError(
      `backpack "${name}" is not registered`,
      "NOT_FOUND",
    );
  }
  await writeJsonAtomic(activeConfigFile(), {
    version: CONFIG_VERSION,
    name,
  });
  return entry;
}
