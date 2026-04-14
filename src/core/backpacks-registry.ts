// ============================================================
// Registry of backpacks (graph directories).
//
// A "backpack" is a named pointer to a directory of learning graphs.
// Users can own multiple backpacks (personal, work, family, a shared
// OneDrive folder, etc) and switch between them — only one is active
// at a time. All reads and writes go to the active backpack's path.
//
// On-disk config (single file):
//   ~/.config/backpack/backpacks.json
//   {
//     "version": 2,
//     "paths": [
//       "/Users/noah/.local/share/backpack/graphs",
//       "/Users/noah/OneDrive/work"
//     ],
//     "active": "/Users/noah/OneDrive/work"
//   }
//
// Display names and colors are NOT stored — they're derived from the
// path on every read. Name = last path segment, with "personal" as a
// special case for the default personal graphs directory. Collisions
// get "-2", "-3" suffixes in registration order. Color is a stable
// hash of the path.
//
// Env var $BACKPACK_ACTIVE overrides the persisted active for the
// current process only (per-session isolation for power users).
//
// Auto-migration: on first load, if we see the old v1 format
// ({ version: 1, backpacks: [{ name, path, color }] }), we extract
// the paths, drop the names and colors, and rewrite the file as v2.
// The old separate active.json file (also v1) is merged in as the
// active path by looking up the path by name.
// ============================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { configDir, dataDir } from "./paths.js";

// --- Types ---

/**
 * A registered backpack as the user sees it. The path is the canonical
 * identity. Name and color are derived from the path — not stored.
 */
export interface BackpackEntry {
  /** Absolute filesystem path to the graphs directory. */
  path: string;
  /** Display name derived from the last path segment. */
  name: string;
  /** 6-digit hex color derived from a hash of the path. */
  color: string;
}

/** Per-backpack KB mount configuration. */
export interface KBMountConfig {
  name: string;
  path: string;
  writable?: boolean; // default true
}

/**
 * On-disk config file shape (v2).
 */
export interface BackpacksConfigFile {
  version: number;
  paths: string[];
  active: string;
  kb?: Record<string, KBMountConfig[]>;
}

// Legacy v1 shapes used by the migration code.
interface LegacyBackpacksFileV1 {
  version: number;
  backpacks: Array<{ name: string; path: string; color?: string }>;
}
interface LegacyActiveFileV1 {
  version: number;
  name: string;
}

const CONFIG_VERSION = 2;
const DEFAULT_PERSONAL_NAME = "personal";

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

// --- Derivation helpers ---

/**
 * The default personal graphs path. Honors BACKPACK_DIR and XDG_DATA_HOME
 * so users who customized their data directory keep it.
 */
function defaultPersonalPath(): string {
  return path.join(dataDir(), "graphs");
}

/**
 * Last non-empty path segment, used as the base for the display name.
 * Strips trailing separators. For `/OneDrive/work/` returns `work`.
 */
function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last || trimmed;
}

/**
 * Derive a stable 6-digit hex color from a path. Same path always
 * produces the same color. Luminance clamped so the result is readable
 * on both light and dark backgrounds.
 */
export function colorForPath(p: string): string {
  const hash = crypto.createHash("sha256").update(p).digest();
  const r = 80 + (hash[0] % 140);
  const g = 80 + (hash[7] % 140);
  const b = 80 + (hash[15] % 140);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Given a path and the full ordered list of paths, return the display
 * name that should be used for it. Special-cases the default personal
 * path to `personal`. On collision (two paths ending in the same
 * segment), appends a disambiguating suffix in registration order.
 */
export function deriveName(p: string, allPaths: string[]): string {
  const defaultPersonal = path.resolve(defaultPersonalPath());

  if (path.resolve(p) === defaultPersonal) {
    return DEFAULT_PERSONAL_NAME;
  }
  const base = basename(p);

  // Count how many earlier paths would display with the same base name.
  // The default personal path is included in the count when the base is
  // `personal` — otherwise a user registering another `/whatever/personal`
  // path would silently collide with the special-cased default.
  let priorCount = 0;
  for (const other of allPaths) {
    if (other === p) break;
    const otherBase =
      path.resolve(other) === defaultPersonal
        ? DEFAULT_PERSONAL_NAME
        : basename(other);
    if (otherBase === base) priorCount++;
  }
  return priorCount === 0 ? base : `${base}-${priorCount + 1}`;
}

/**
 * Expand a leading `~/` to the user's home directory. Does NOT do any
 * other shell-like expansion (no `$VARS`, no globs).
 */
function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Normalize a user-provided path for storage: tilde-expand and resolve absolute. */
function normalizePath(p: string): string {
  return path.resolve(expandHome(p));
}

// --- File paths ---

function backpacksConfigFile(): string {
  return path.join(configDir(), "backpacks.json");
}

function legacyActiveFile(): string {
  return path.join(configDir(), "active.json");
}

// --- IO helpers ---

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

// --- Migration ---

/**
 * Convert a v1 file in memory to v2 shape, reading the separate
 * legacy active.json to find the active entry. If the legacy active
 * file is missing or points at an unknown name, default to the first
 * path.
 */
async function migrateV1ToV2(v1: LegacyBackpacksFileV1): Promise<BackpacksConfigFile> {
  const paths = v1.backpacks.map((b) => normalizePath(b.path));
  let active = paths[0] ?? "";
  const legacyActive = await readJsonOrNull<LegacyActiveFileV1>(legacyActiveFile());
  if (legacyActive && typeof legacyActive.name === "string") {
    const match = v1.backpacks.find((b) => b.name === legacyActive.name);
    if (match) active = normalizePath(match.path);
  }
  return { version: CONFIG_VERSION, paths, active };
}

// --- Public API ---

/**
 * Load the registry, seeding with the default personal path if the file
 * doesn't exist, and auto-migrating from v1 format if it does. Always
 * returns a well-formed v2 config. Safe to call many times.
 */
export async function loadRegistry(): Promise<BackpacksConfigFile> {
  const raw = await readJsonOrNull<unknown>(backpacksConfigFile());

  if (raw === null) {
    // First run: seed with the personal default
    const seeded: BackpacksConfigFile = {
      version: CONFIG_VERSION,
      paths: [defaultPersonalPath()],
      active: defaultPersonalPath(),
    };
    await writeJsonAtomic(backpacksConfigFile(), seeded);
    return seeded;
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "paths" in raw &&
    Array.isArray((raw as BackpacksConfigFile).paths)
  ) {
    // Already v2
    const cfg = raw as BackpacksConfigFile;
    // Defensive: ensure `active` is one of the paths, else pick the first
    if (!cfg.paths.includes(cfg.active)) {
      cfg.active = cfg.paths[0] ?? defaultPersonalPath();
    }
    return {
      version: CONFIG_VERSION,
      paths: cfg.paths.slice(),
      active: cfg.active,
      ...(cfg.kb ? { kb: cfg.kb } : {}),
    };
  }

  if (
    typeof raw === "object" &&
    raw !== null &&
    "backpacks" in raw &&
    Array.isArray((raw as LegacyBackpacksFileV1).backpacks)
  ) {
    // v1 format — migrate, write the v2 file, and remove the legacy
    // active.json file to keep the config directory tidy.
    const migrated = await migrateV1ToV2(raw as LegacyBackpacksFileV1);
    await writeJsonAtomic(backpacksConfigFile(), migrated);
    await fs.rm(legacyActiveFile()).catch(() => {});
    return migrated;
  }

  // Garbage — treat as first run
  const seeded: BackpacksConfigFile = {
    version: CONFIG_VERSION,
    paths: [defaultPersonalPath()],
    active: defaultPersonalPath(),
  };
  await writeJsonAtomic(backpacksConfigFile(), seeded);
  return seeded;
}

/** List all registered backpacks as derived entries. */
export async function listBackpacks(): Promise<BackpackEntry[]> {
  const cfg = await loadRegistry();
  return cfg.paths.map((p) => ({
    path: p,
    name: deriveName(p, cfg.paths),
    color: colorForPath(p),
  }));
}

/**
 * Look up a backpack by either its absolute path or its derived name.
 * Returns null if no match. Name lookup is case-sensitive.
 */
export async function getBackpack(pathOrName: string): Promise<BackpackEntry | null> {
  const entries = await listBackpacks();
  // Try exact path match first (after normalization)
  const resolved = normalizePath(pathOrName);
  const byPath = entries.find((e) => e.path === resolved);
  if (byPath) return byPath;
  // Try derived name match
  const byName = entries.find((e) => e.name === pathOrName);
  return byName ?? null;
}

/**
 * Register a new backpack at the given path. Creates the directory
 * if missing. Idempotent: if the path is already registered, returns
 * the existing entry without duplicating.
 */
export async function registerBackpack(rawPath: string): Promise<BackpackEntry> {
  const resolved = normalizePath(rawPath);
  const cfg = await loadRegistry();

  // Idempotent
  if (cfg.paths.includes(resolved)) {
    const entry = (await listBackpacks()).find((e) => e.path === resolved);
    if (entry) return entry;
  }

  // Make sure the directory is usable
  try {
    await fs.mkdir(resolved, { recursive: true });
  } catch (err) {
    throw new BackpackRegistryError(
      `cannot create or access path "${resolved}": ${(err as Error).message}`,
      "PATH_UNUSABLE",
    );
  }

  cfg.paths.push(resolved);
  await writeJsonAtomic(backpacksConfigFile(), cfg);

  const all = cfg.paths;
  return {
    path: resolved,
    name: deriveName(resolved, all),
    color: colorForPath(resolved),
  };
}

/**
 * Unregister a backpack by path or derived name. Does NOT delete its
 * data. Refuses to unregister the last remaining backpack. If the
 * removed backpack was active, the first remaining becomes active.
 */
export async function unregisterBackpack(pathOrName: string): Promise<void> {
  const cfg = await loadRegistry();
  const entry = await getBackpack(pathOrName);
  if (!entry) {
    throw new BackpackRegistryError(
      `backpack "${pathOrName}" is not registered`,
      "NOT_FOUND",
    );
  }
  if (cfg.paths.length <= 1) {
    throw new BackpackRegistryError(
      `cannot unregister the last remaining backpack`,
      "LAST_BACKPACK",
    );
  }
  cfg.paths = cfg.paths.filter((p) => p !== entry.path);
  if (cfg.active === entry.path) {
    cfg.active = cfg.paths[0];
  }
  await writeJsonAtomic(backpacksConfigFile(), cfg);
}

/**
 * Return the currently active backpack. Resolution order:
 *   1. $BACKPACK_ACTIVE env var (accepts path or derived name)
 *   2. config.active
 *   3. first entry in the registry (fallback)
 */
export async function getActiveBackpack(): Promise<BackpackEntry> {
  const cfg = await loadRegistry();
  const entries = await listBackpacks();
  if (entries.length === 0) {
    // Shouldn't happen — loadRegistry seeds — but guard.
    const fallback = defaultPersonalPath();
    cfg.paths.push(fallback);
    cfg.active = fallback;
    await writeJsonAtomic(backpacksConfigFile(), cfg);
    return {
      path: fallback,
      name: DEFAULT_PERSONAL_NAME,
      color: colorForPath(fallback),
    };
  }

  // 1. Env var override
  const envInput = process.env.BACKPACK_ACTIVE;
  if (envInput) {
    const match = await getBackpack(envInput);
    if (match) return match;
  }

  // 2. Config active
  const configMatch = entries.find((e) => e.path === cfg.active);
  if (configMatch) return configMatch;

  // 3. First
  return entries[0];
}

/**
 * Persist a new active backpack. Accepts either a path or a derived
 * name. Does NOT touch the env var override.
 */
export async function setActiveBackpack(pathOrName: string): Promise<BackpackEntry> {
  const cfg = await loadRegistry();
  const entry = await getBackpack(pathOrName);
  if (!entry) {
    throw new BackpackRegistryError(
      `backpack "${pathOrName}" is not registered`,
      "NOT_FOUND",
    );
  }
  cfg.active = entry.path;
  await writeJsonAtomic(backpacksConfigFile(), cfg);
  return entry;
}

// --- KB mount configuration ---

/**
 * Get the KB mounts for a backpack. If none configured, returns a
 * single default "knowledge-base" mount as a sibling to the graphs directory.
 * e.g., if graphsDir is ~/.local/share/backpack/graphs,
 * the default KB is ~/.local/share/backpack/knowledge-base.
 */
export async function getKBMounts(backpackPath: string): Promise<KBMountConfig[]> {
  const cfg = await loadRegistry();
  const resolved = path.resolve(backpackPath);
  const mounts = cfg.kb?.[resolved];
  if (mounts && mounts.length > 0) return mounts;
  return [{ name: "knowledge-base", path: path.join(resolved, "..", "knowledge-base") }];
}

/** Replace all KB mounts for a backpack. */
export async function setKBMounts(backpackPath: string, mounts: KBMountConfig[]): Promise<void> {
  if (mounts.length === 0) {
    throw new BackpackRegistryError("cannot set empty KB mount list", "INVALID");
  }
  const cfg = await loadRegistry();
  const resolved = path.resolve(backpackPath);
  if (!cfg.kb) cfg.kb = {};
  cfg.kb[resolved] = mounts.map((m) => ({
    name: m.name,
    path: normalizePath(m.path),
    ...(m.writable === false ? { writable: false } : {}),
  }));
  await writeJsonAtomic(backpacksConfigFile(), cfg);
}

/** Add a KB mount to a backpack. Idempotent by name. */
export async function addKBMount(backpackPath: string, mount: KBMountConfig): Promise<void> {
  const mounts = await getKBMounts(backpackPath);
  if (mounts.some((m) => m.name === mount.name)) {
    throw new BackpackRegistryError(
      `KB mount "${mount.name}" already exists`,
      "DUPLICATE",
    );
  }
  mounts.push({
    name: mount.name,
    path: normalizePath(mount.path),
    ...(mount.writable === false ? { writable: false } : {}),
  });
  await setKBMounts(backpackPath, mounts);
}

/** Remove a KB mount by name. Cannot remove the last mount. */
export async function removeKBMount(backpackPath: string, mountName: string): Promise<void> {
  const mounts = await getKBMounts(backpackPath);
  const filtered = mounts.filter((m) => m.name !== mountName);
  if (filtered.length === mounts.length) {
    throw new BackpackRegistryError(
      `KB mount "${mountName}" not found`,
      "NOT_FOUND",
    );
  }
  if (filtered.length === 0) {
    throw new BackpackRegistryError(
      "cannot remove the last KB mount",
      "LAST_MOUNT",
    );
  }
  await setKBMounts(backpackPath, filtered);
}

/** Update the path of an existing KB mount by name. */
export async function editKBMount(backpackPath: string, mountName: string, newPath: string): Promise<void> {
  const mounts = await getKBMounts(backpackPath);
  const mount = mounts.find((m) => m.name === mountName);
  if (!mount) {
    throw new BackpackRegistryError(
      `KB mount "${mountName}" not found`,
      "NOT_FOUND",
    );
  }
  mount.path = normalizePath(newPath);
  await setKBMounts(backpackPath, mounts);
}
