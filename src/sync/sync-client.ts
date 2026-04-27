// SyncClient — orchestrates per-backpack bidirectional sync against a relay.
//
// Identity:
//   - Each backpack has a stable UUID stored in <backpack>/.sync/state.json
//   - Each artifact has id "graph:<name>" or "kb_doc:<id>"
//
// Algorithm (see backpack-ontology/docs/sync-protocol.md §5):
//   pull-then-push: fetch manifest, reconcile each artifact in turn
//   - local-only: push (expected_version=0)
//   - remote-only (not tombstoned): pull, write locally
//   - both, hashes equal: skip
//   - both, local newer than synced ancestor: push
//   - both, remote newer than synced ancestor: pull
//   - both, diverged: write conflict file, take remote as canonical

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { EventSourcedBackend } from "../storage/event-sourced-backend.js";
import { DocumentStore } from "../core/document-store.js";
import { getKBMounts } from "../core/backpacks-registry.js";
import type { LearningGraphData } from "../core/types.js";
import type { KBDocument } from "../core/document-store.js";
import type { KBMountConfig } from "../core/backpacks-registry.js";

import {
  ARTIFACT_KIND_GRAPH,
  ARTIFACT_KIND_KB_DOC,
  SyncVersionConflictError,
  type ArtifactSyncState,
  type BackpackSyncState,
  type GraphArtifactContent,
  type KBDocArtifactContent,
  type SyncManifest,
  type SyncRunResult,
} from "./types.js";
import {
  emptyArtifactState,
  isStateInitialized,
  readSyncState,
  writeSyncState,
  deleteSyncState,
} from "./sync-state.js";
import { SyncRelayClient } from "./sync-relay.js";

export interface SyncClientOptions {
  /** Absolute path to the backpack on disk (where graphs/ + _documents/ live). */
  backpackPath: string;
  /** Relay client (constructed by caller, who handles auth). */
  relay: SyncRelayClient;
  /** Display name of the backpack (used at register time). */
  name?: string;
  /** Color (hex) of the backpack — derived from path by default. */
  color?: string;
  /** Tags to assign at register time. */
  tags?: string[];
}

export interface RegisterOptions {
  name: string;
  color?: string;
  tags?: string[];
  /** Optional pre-existing UUID (for idempotent re-registration). */
  backpackId?: string;
}

export class SyncClient {
  private readonly backpackPath: string;
  private readonly relay: SyncRelayClient;
  private graphsBackend: EventSourcedBackend | null = null;
  private docStore: DocumentStore | null = null;
  private kbMounts: KBMountConfig[] | null = null;

  constructor(opts: SyncClientOptions) {
    this.backpackPath = opts.backpackPath;
    this.relay = opts.relay;
  }

  // --- Lifecycle ---

  /** Read sync state from disk, or null if this backpack is not registered. */
  async getState(): Promise<BackpackSyncState | null> {
    return readSyncState(this.backpackPath);
  }

  /**
   * Register this backpack with the relay. Idempotent — if the backpack is
   * already registered and the relay knows about it, returns existing state.
   * If a backpack_id is provided (e.g. from a previous registration), reuses it.
   */
  async register(opts: RegisterOptions): Promise<BackpackSyncState> {
    const existing = await this.getState();
    const backpackId = opts.backpackId ?? existing?.backpack_id ?? randomUUID();

    const remote = await this.relay.register({
      id: backpackId,
      name: opts.name,
      color: opts.color,
      tags: opts.tags ?? [],
    });

    const state: BackpackSyncState = existing
      ? { ...existing, backpack_id: remote.id, name: remote.name }
      : {
          backpack_id: remote.id,
          name: remote.name,
          relay_url: this.getRelayBaseUrl(),
          registered_at: new Date().toISOString(),
          last_sync_at: null,
          last_synced_metadata_version: 0,
          artifacts: {},
        };
    state.last_synced_metadata_version = remote.metadata_version;
    await writeSyncState(this.backpackPath, state);
    return state;
  }

  /** Unregister: delete server-side and local sync state. */
  async unregister(): Promise<void> {
    const state = await this.getState();
    if (!state) return;
    try {
      await this.relay.deleteBackpack(state.backpack_id);
    } catch {
      // Even if remote delete fails, drop local state
    }
    await deleteSyncState(this.backpackPath);
  }

  // --- Status ---

  /**
   * Compute a status diff without performing any writes. Useful for
   * `backpack-sync status` and the viewer's pending-changes badge.
   */
  async status(): Promise<{
    registered: boolean;
    state: BackpackSyncState | null;
    localOnly: string[];
    remoteOnly: string[];
    diverged: string[];
    upToDate: number;
  }> {
    const state = await this.getState();
    if (!isStateInitialized(state)) {
      return { registered: false, state: null, localOnly: [], remoteOnly: [], diverged: [], upToDate: 0 };
    }
    const local = await this.scanLocalArtifacts();
    const manifest = await this.relay.manifest(state.backpack_id);

    const localById = new Map(local.map((a) => [a.id, a]));
    const remoteById = new Map<string, { version: number; hash: string; deleted: boolean }>();
    for (const a of manifest.artifacts ?? []) {
      remoteById.set(a.artifact_id, {
        version: a.version,
        hash: a.content_hash,
        deleted: !!a.deleted,
      });
    }

    const localOnly: string[] = [];
    const remoteOnly: string[] = [];
    const diverged: string[] = [];
    let upToDate = 0;

    const allIds = new Set<string>([...localById.keys(), ...remoteById.keys()]);
    for (const id of allIds) {
      const l = localById.get(id);
      const r = remoteById.get(id);
      const trackedHash = state.artifacts[id]?.content_hash ?? "";
      if (l && !r) {
        localOnly.push(id);
      } else if (r && !l) {
        if (!r.deleted) remoteOnly.push(id);
      } else if (l && r) {
        if (r.deleted) {
          // Remote tombstoned but we still have it: pull will delete locally
          remoteOnly.push(id);
        } else if (l.hash === r.hash) {
          upToDate++;
        } else if (trackedHash === r.hash) {
          // local advanced
          localOnly.push(id);
        } else if (trackedHash === l.hash) {
          // remote advanced
          remoteOnly.push(id);
        } else {
          diverged.push(id);
        }
      }
    }

    return { registered: true, state, localOnly, remoteOnly, diverged, upToDate };
  }

  // --- Operations ---

  /** Push every local artifact whose hash differs from its tracked synced hash. */
  async push(): Promise<SyncRunResult> {
    const state = await this.requireState();
    const result = newResult();
    const local = await this.scanLocalArtifacts();
    let mutated = false;

    for (const art of local) {
      const tracked = state.artifacts[art.id] ?? emptyArtifactState();
      if (tracked.content_hash === art.hash) continue;

      try {
        const expectedVersion = tracked.last_synced_version;
        const remote = await this.relay.putArtifact(
          state.backpack_id,
          art.id,
          art.content,
          expectedVersion,
        );
        state.artifacts[art.id] = {
          version: remote.version,
          content_hash: remote.content_hash,
          last_synced_version: remote.version,
          modified_at: remote.modified_at,
        };
        result.pushed.push(art.id);
        mutated = true;
      } catch (err) {
        if (err instanceof SyncVersionConflictError) {
          // Pull-and-conflict path
          await this.handleConflict(state, art.id, art.content, err, result);
          mutated = true;
        } else {
          result.errors.push({ artifact_id: art.id, message: (err as Error).message });
        }
      }
    }

    if (mutated) {
      state.last_sync_at = new Date().toISOString();
      await writeSyncState(this.backpackPath, state);
    }
    return result;
  }

  /** Pull every remote artifact whose version is newer than the locally tracked one. */
  async pull(): Promise<SyncRunResult> {
    const state = await this.requireState();
    const result = newResult();
    const manifest = await this.relay.manifest(state.backpack_id);
    let mutated = false;

    const localArtifacts = await this.scanLocalArtifacts();
    const localById = new Map(localArtifacts.map((a) => [a.id, a]));

    for (const remote of manifest.artifacts ?? []) {
      const tracked = state.artifacts[remote.artifact_id] ?? emptyArtifactState();
      const local = localById.get(remote.artifact_id);

      if (remote.deleted) {
        if (local) {
          await this.deleteLocalArtifact(remote.artifact_id);
          result.deleted_local.push(remote.artifact_id);
        }
        delete state.artifacts[remote.artifact_id];
        mutated = true;
        continue;
      }

      if (local && local.hash === remote.content_hash) {
        if (tracked.last_synced_version !== remote.version) {
          state.artifacts[remote.artifact_id] = {
            version: remote.version,
            content_hash: remote.content_hash,
            last_synced_version: remote.version,
            modified_at: remote.modified_at,
          };
          mutated = true;
        }
        continue;
      }

      const localChanged =
        local && tracked.content_hash !== "" && local.hash !== tracked.content_hash;

      // Remote newer than tracked AND local has not changed → pull
      if (remote.version > tracked.last_synced_version && !localChanged) {
        const fetched = await this.relay.getArtifact(state.backpack_id, remote.artifact_id);
        await this.writeLocalArtifact(remote.artifact_id, fetched.content);
        state.artifacts[remote.artifact_id] = {
          version: remote.version,
          content_hash: remote.content_hash,
          last_synced_version: remote.version,
          modified_at: remote.modified_at,
        };
        result.pulled.push(remote.artifact_id);
        mutated = true;
        continue;
      }

      // Local changed AND remote also changed → conflict.
      // Write the LOCAL content as a conflict file FIRST so that even if the
      // subsequent local overwrite fails (disk full, perms, crash), the
      // user's local edits are preserved on disk.
      if (localChanged && remote.version > tracked.last_synced_version) {
        const conflictPath = await this.writeConflictFile(remote.artifact_id, local.content);
        const fetched = await this.relay.getArtifact(state.backpack_id, remote.artifact_id);
        await this.writeLocalArtifact(remote.artifact_id, fetched.content);
        state.artifacts[remote.artifact_id] = {
          version: remote.version,
          content_hash: remote.content_hash,
          last_synced_version: remote.version,
          modified_at: remote.modified_at,
        };
        result.conflicts.push({
          artifact_id: remote.artifact_id,
          conflict_path: conflictPath,
          remote_version: remote.version,
        });
        mutated = true;
      }
    }

    // Detect locally-deleted artifacts (in tracked state but not on disk
    // AND not just pulled from the relay this run). Re-scan local because
    // the loop above wrote new files that the initial scan missed.
    const justPulled = new Set([...result.pulled, ...result.conflicts.map((c) => c.artifact_id)]);
    const localAfterPull = await this.scanLocalArtifacts();
    const localByIdAfter = new Map(localAfterPull.map((a) => [a.id, a]));
    for (const [id, tracked] of Object.entries(state.artifacts)) {
      if (justPulled.has(id)) continue;
      if (localByIdAfter.has(id)) continue;
      if (tracked.last_synced_version <= 0 || tracked.content_hash === "") continue;
      const remoteEntry = (manifest.artifacts ?? []).find((a) => a.artifact_id === id);
      if (remoteEntry?.deleted) continue;
      try {
        await this.relay.deleteArtifact(state.backpack_id, id);
        delete state.artifacts[id];
        result.deleted_remote.push(id);
        mutated = true;
      } catch (err) {
        result.errors.push({ artifact_id: id, message: (err as Error).message });
      }
    }

    if (mutated) {
      state.last_sync_at = new Date().toISOString();
      state.last_synced_metadata_version = manifest.metadata_version;
      await writeSyncState(this.backpackPath, state);
    }
    return result;
  }

  /** Bidirectional: pull then push. */
  async sync(): Promise<SyncRunResult> {
    const a = await this.pull();
    const b = await this.push();
    return {
      pushed: [...a.pushed, ...b.pushed],
      pulled: [...a.pulled, ...b.pulled],
      deleted_local: [...a.deleted_local, ...b.deleted_local],
      deleted_remote: [...a.deleted_remote, ...b.deleted_remote],
      conflicts: [...a.conflicts, ...b.conflicts],
      errors: [...a.errors, ...b.errors],
    };
  }

  // --- Internal helpers ---

  private async requireState(): Promise<BackpackSyncState> {
    const state = await this.getState();
    if (!isStateInitialized(state)) {
      throw new Error(
        "backpack is not registered for sync; run `backpack-sync register <name>` first",
      );
    }
    return state;
  }

  private getRelayBaseUrl(): string {
    // SyncRelayClient hides this — recover via `(this.relay as any).baseUrl` is
    // tempting but we'd rather keep a copy at register time. Callers pass the
    // intended relay url in the constructor; we store it in the state file then.
    // For now, read from env or default.
    return (
      process.env.BACKPACK_APP_URL ??
      process.env.BACKPACK_RELAY_URL ??
      "https://app.backpackontology.com"
    );
  }

  private async getGraphsBackend(): Promise<EventSourcedBackend> {
    if (!this.graphsBackend) {
      // The registered backpack path IS the graphs directory itself
      // (each subdir of it is a graph). This matches the convention used
      // by the viewer (bin/serve.js: graphsDirOverride = entry.path) and
      // by the backpack registry (paths point at graphs dirs). Without
      // this override, EventSourcedBackend would look at <path>/graphs/
      // which is normally empty for synced backpacks.
      this.graphsBackend = new EventSourcedBackend(undefined, {
        graphsDirOverride: this.backpackPath,
      });
      await this.graphsBackend.initialize();
    }
    return this.graphsBackend;
  }

  private async getKBStore(): Promise<{ store: DocumentStore; mounts: KBMountConfig[] }> {
    if (!this.docStore || !this.kbMounts) {
      try {
        this.kbMounts = await getKBMounts(this.backpackPath);
      } catch {
        this.kbMounts = [];
      }
      this.docStore = new DocumentStore(
        this.kbMounts.map((m) => ({
          name: m.name,
          path: m.path,
          writable: m.writable !== false,
        })),
      );
    }
    return { store: this.docStore, mounts: this.kbMounts };
  }

  private async scanLocalArtifacts(): Promise<
    Array<{ id: string; hash: string; content: GraphArtifactContent | KBDocArtifactContent }>
  > {
    const out: Array<{
      id: string;
      hash: string;
      content: GraphArtifactContent | KBDocArtifactContent;
    }> = [];

    // Graphs
    const backend = await this.getGraphsBackend();
    const graphs = await backend.listOntologies();
    for (const g of graphs) {
      try {
        const data = await backend.loadOntology(g.name);
        const content: GraphArtifactContent = {
          kind: ARTIFACT_KIND_GRAPH,
          name: g.name,
          data,
        };
        out.push({
          id: `${ARTIFACT_KIND_GRAPH}:${g.name}`,
          hash: hashContent(content),
          content,
        });
      } catch (err) {
        // Skip unreadable graphs
        process.stderr.write(`sync: skipping graph "${g.name}" — ${(err as Error).message}\n`);
      }
    }

    // KB documents from synced mounts
    try {
      const { store, mounts } = await this.getKBStore();
      const syncedMountNames = new Set(
        mounts.filter((m) => isMountSynced(m)).map((m) => m.name),
      );
      const result = await store.list();
      for (const summary of result.documents) {
        if (syncedMountNames.size > 0 && !syncedMountNames.has(summary.collection)) continue;
        try {
          const doc = await store.read(summary.id);
          const content: KBDocArtifactContent = {
            kind: ARTIFACT_KIND_KB_DOC,
            id: doc.id,
            title: doc.title,
            content: doc.content,
            tags: doc.tags ?? [],
            source_graphs: doc.sourceGraphs ?? [],
            source_node_ids: doc.sourceNodeIds ?? [],
            collection: doc.collection,
            created_at: doc.createdAt,
            updated_at: doc.updatedAt,
          };
          out.push({
            id: `${ARTIFACT_KIND_KB_DOC}:${doc.id}`,
            hash: hashContent(content),
            content,
          });
        } catch (err) {
          process.stderr.write(`sync: skipping KB doc "${summary.id}" — ${(err as Error).message}\n`);
        }
      }
    } catch {
      // KB not configured — skip
    }

    return out;
  }

  private async writeLocalArtifact(artifactId: string, content: unknown): Promise<void> {
    const { kind, key } = parseArtifactId(artifactId);
    if (kind === ARTIFACT_KIND_GRAPH) {
      const c = content as GraphArtifactContent;
      const data = c.data as LearningGraphData;
      const backend = await this.getGraphsBackend();
      const existing = await backend.listOntologies();
      if (!existing.find((o) => o.name === key)) {
        await backend.createOntology(key, data.metadata?.description ?? "");
      }
      await backend.saveOntology(key, data);
    } else if (kind === ARTIFACT_KIND_KB_DOC) {
      const c = content as KBDocArtifactContent;
      const { store } = await this.getKBStore();
      const doc: KBDocument = {
        id: c.id,
        title: c.title,
        content: c.content,
        tags: c.tags ?? [],
        sourceGraphs: c.source_graphs ?? [],
        sourceNodeIds: c.source_node_ids ?? [],
        collection: c.collection,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
      await store.save(doc);
    } else {
      throw new Error(`unsupported artifact kind: ${kind}`);
    }
  }

  private async deleteLocalArtifact(artifactId: string): Promise<void> {
    const { kind, key } = parseArtifactId(artifactId);
    if (kind === ARTIFACT_KIND_GRAPH) {
      const backend = await this.getGraphsBackend();
      try {
        await backend.deleteOntology(key);
      } catch {
        // ignore
      }
    } else if (kind === ARTIFACT_KIND_KB_DOC) {
      const { store } = await this.getKBStore();
      try {
        await store.delete(key);
      } catch {
        // ignore
      }
    }
  }

  private async writeConflictFile(artifactId: string, content: unknown): Promise<string> {
    const { kind, key } = parseArtifactId(artifactId);
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(this.backpackPath, ".sync", "conflicts");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${kind}_${safeKey}.conflict-${ts}.json`);
    await fs.writeFile(file, JSON.stringify(content, null, 2), "utf8");
    return file;
  }

  private async handleConflict(
    state: BackpackSyncState,
    artifactId: string,
    localContent: unknown,
    err: SyncVersionConflictError,
    result: SyncRunResult,
  ): Promise<void> {
    // Server has a newer version. Save our local content as a conflict file
    // FIRST (so it survives any failure in the subsequent overwrite), then
    // pull the server version and update tracked state. Per spec §8.2:
    // relay wins canonical, local preserved as a conflict file for manual reconciliation.
    const conflictPath = await this.writeConflictFile(artifactId, localContent);
    const fetched = await this.relay.getArtifact(state.backpack_id, artifactId);
    await this.writeLocalArtifact(artifactId, fetched.content);
    state.artifacts[artifactId] = {
      version: fetched.version,
      content_hash: fetched.content_hash,
      last_synced_version: fetched.version,
      modified_at: fetched.modified_at,
    };
    result.conflicts.push({
      artifact_id: artifactId,
      conflict_path: conflictPath,
      remote_version: err.serverVersion,
    });
  }
}

// --- helpers ---

/**
 * Canonical hash: sorted-keys at every level of the JSON tree, no
 * whitespace. Matches backpack-app's `repository.canonicalContentHash`
 * so client-computed hashes survive a round-trip through PostgreSQL JSONB
 * normalization.
 */
export function hashContent(content: unknown): string {
  const canonical = canonicalStringify(content);
  return "sha256:" + crypto.createHash("sha256").update(canonical).digest("hex");
}

function canonicalStringify(v: unknown): string {
  // JSON has no representation for undefined; coerce to null so the hash
  // stays a valid JSON string and survives a roundtrip through the wire.
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return (
      "[" +
      v.map((x) => canonicalStringify(x === undefined ? null : x)).join(",") +
      "]"
    );
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]))
      .join(",") +
    "}"
  );
}

export function parseArtifactId(id: string): { kind: string; key: string } {
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) {
    throw new Error(`invalid artifact_id: ${id}`);
  }
  return { kind: id.slice(0, idx), key: id.slice(idx + 1) };
}

function isMountSynced(mount: KBMountConfig & { sync?: boolean }): boolean {
  // Default sync = true for writable mounts. External mounts can opt out by
  // setting sync: false in backpacks.json.
  if ((mount as { sync?: boolean }).sync === false) return false;
  return mount.writable !== false;
}

function newResult(): SyncRunResult {
  return {
    pushed: [],
    pulled: [],
    deleted_local: [],
    deleted_remote: [],
    conflicts: [],
    errors: [],
  };
}

/** Manifest = SyncManifest, re-exported here for convenience. */
export type { SyncManifest };
