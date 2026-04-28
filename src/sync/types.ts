// Sync Protocol v0.1 types — shared by client + relay implementations.
// Mirrors backpack-app's internal/model/sync.go shapes.

export const SYNC_PROTOCOL_VERSION = "1";

/** Stable kind tags used to namespace artifact ids. */
export const ARTIFACT_KIND_GRAPH = "graph" as const;
export const ARTIFACT_KIND_KB_DOC = "kb_doc" as const;

export type ArtifactKind = typeof ARTIFACT_KIND_GRAPH | typeof ARTIFACT_KIND_KB_DOC;

export interface SyncBackpack {
  id: string;
  owner_user_id: string;
  name: string;
  color: string;
  tags: string[];
  metadata_version: number;
  metadata_content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SyncArtifactSummary {
  artifact_id: string;
  version: number;
  content_hash: string;
  modified_at: string;
  deleted?: boolean;
}

export interface SyncManifest {
  backpack_id: string;
  name: string;
  color: string;
  tags: string[];
  metadata_version: number;
  metadata_content_hash: string;
  artifacts: SyncArtifactSummary[];
}

export interface SyncArtifact {
  artifact_id: string;
  version: number;
  content_hash: string;
  modified_at: string;
  content: unknown;
}

/** Content shape for graph artifacts (matches relay's wrapping). */
export interface GraphArtifactContent {
  kind: typeof ARTIFACT_KIND_GRAPH;
  name: string;
  data: unknown; // LearningGraphData on disk; opaque on the wire
}

/** Content shape for KB document artifacts. */
export interface KBDocArtifactContent {
  kind: typeof ARTIFACT_KIND_KB_DOC;
  id: string;
  title: string;
  content: string;
  tags: string[];
  source_graphs: string[];
  source_node_ids: string[];
  collection: string;
  created_at: string;
  updated_at: string;
}

/** Per-artifact local sync state, persisted in <backpack>/.sync/state.json. */
export interface ArtifactSyncState {
  version: number;
  content_hash: string;
  last_synced_version: number;
  modified_at: string;
}

/** On-disk state for one backpack's sync registration. */
export interface BackpackSyncState {
  backpack_id: string;
  name: string;
  relay_url: string;
  registered_at: string;
  last_sync_at: string | null;
  /**
   * Last metadata_version observed at sync time. Reserved for future
   * use when backpack-level metadata (name, color, tags) syncs through
   * the protocol; v0.1 sets but does not act on this field.
   */
  last_synced_metadata_version: number;
  artifacts: Record<string, ArtifactSyncState>;
}

/** Result of a sync run. */
export interface SyncRunResult {
  pushed: string[];
  pulled: string[];
  deleted_local: string[];
  deleted_remote: string[];
  conflicts: ConflictRecord[];
  /**
   * Artifacts the client deliberately did not act on. Today: relay
   * manifest referenced an artifact that 404'd on download (stale
   * manifest). The next sync run picks them up automatically.
   * Surfaced so callers can warn users without crashing the run.
   */
  skipped: SkippedRecord[];
  errors: SyncError[];
}

export interface ConflictRecord {
  artifact_id: string;
  conflict_path: string;
  remote_version: number;
}

export interface SkippedRecord {
  artifact_id: string;
  reason: "remote-missing" | string;
}

export interface SyncError {
  artifact_id?: string;
  message: string;
}

/** Thrown when the server's version disagrees with the client's expectation. */
export class SyncVersionConflictError extends Error {
  constructor(
    public readonly artifactId: string,
    public readonly serverVersion: number,
    public readonly serverHash: string,
  ) {
    super(`sync version conflict on ${artifactId} (server version ${serverVersion})`);
    this.name = "SyncVersionConflictError";
  }
}
