// Public entry point for the sync module.
export { SyncClient, hashContent, parseArtifactId } from "./sync-client.js";
export type { SyncClientOptions, RegisterOptions } from "./sync-client.js";
export { SyncRelayClient } from "./sync-relay.js";
export type { SyncRelayClientOptions, TokenProvider } from "./sync-relay.js";
export {
  ARTIFACT_KIND_GRAPH,
  ARTIFACT_KIND_KB_DOC,
  SYNC_PROTOCOL_VERSION,
  SyncVersionConflictError,
} from "./types.js";
export type {
  ArtifactKind,
  ArtifactSyncState,
  BackpackSyncState,
  ConflictRecord,
  GraphArtifactContent,
  KBDocArtifactContent,
  SyncArtifact,
  SyncArtifactSummary,
  SyncBackpack,
  SyncError,
  SyncManifest,
  SyncRunResult,
} from "./types.js";
export {
  readSyncState,
  writeSyncState,
  deleteSyncState,
  isStateInitialized,
  emptyArtifactState,
} from "./sync-state.js";
export { runStartupSync } from "./auto-sync.js";
export type { AutoSyncOptions } from "./auto-sync.js";
