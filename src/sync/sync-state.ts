// Per-backpack sync state, persisted to <backpack-path>/.sync/state.json.
// Atomic writes (.tmp + rename) for crash safety.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BackpackSyncState, ArtifactSyncState } from "./types.js";

const STATE_DIR = ".sync";
const STATE_FILE = "state.json";

function stateDir(backpackPath: string): string {
  return path.join(backpackPath, STATE_DIR);
}

function statePath(backpackPath: string): string {
  return path.join(stateDir(backpackPath), STATE_FILE);
}

export async function readSyncState(backpackPath: string): Promise<BackpackSyncState | null> {
  try {
    const raw = await fs.readFile(statePath(backpackPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<BackpackSyncState>;
    if (!parsed.backpack_id || !parsed.relay_url) return null;
    return {
      backpack_id: parsed.backpack_id,
      name: parsed.name ?? "",
      relay_url: parsed.relay_url,
      registered_at: parsed.registered_at ?? new Date().toISOString(),
      last_sync_at: parsed.last_sync_at ?? null,
      last_synced_metadata_version: parsed.last_synced_metadata_version ?? 0,
      artifacts: parsed.artifacts ?? {},
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeSyncState(
  backpackPath: string,
  state: BackpackSyncState,
): Promise<void> {
  const dir = stateDir(backpackPath);
  await fs.mkdir(dir, { recursive: true });
  const target = statePath(backpackPath);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, target);
}

export async function deleteSyncState(backpackPath: string): Promise<void> {
  try {
    await fs.rm(stateDir(backpackPath), { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export function emptyArtifactState(): ArtifactSyncState {
  return {
    version: 0,
    content_hash: "",
    last_synced_version: 0,
    modified_at: new Date(0).toISOString(),
  };
}

export function isStateInitialized(state: BackpackSyncState | null): state is BackpackSyncState {
  return state !== null && !!state.backpack_id && !!state.relay_url;
}
