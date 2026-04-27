// Public API — everything a consumer needs to use Backpack programmatically.

// Core
export { Backpack } from "./core/backpack.js";
export { Graph } from "./core/graph.js";
export { configDir, dataDir, configFile } from "./core/paths.js";
export { loadConfig } from "./core/config.js";
export type { BackpackConfig } from "./core/config.js";
export type {
  Node,
  Edge,
  LearningGraphData,
  LearningGraphMetadata,
  LearningGraphSummary,
  NodeSummary,
  EdgeSummary,
  NodeTypeInfo,
  EdgeTypeInfo,
  ListNodesResult,
  GetNodeResult,
  NeighborResult,
  NeighborEntry,
} from "./core/types.js";

// Storage backends
export { JsonFileBackend } from "./storage/json-file-backend.js";
export {
  EventSourcedBackend,
  ConcurrencyError,
  LOCK_FRESH_MS,
} from "./storage/event-sourced-backend.js";
export type { LockInfo } from "./storage/event-sourced-backend.js";
export { CloudCacheBackend } from "./storage/cloud-cache-backend.js";

// Author name generator (docker-style fallback when BACKPACK_AUTHOR is unset)
export { generateAuthorName, resolveAuthorName } from "./core/author-name.js";

// Backpacks registry (multi-backpack management)
export {
  loadRegistry,
  listBackpacks,
  getBackpack,
  registerBackpack,
  unregisterBackpack,
  getActiveBackpack,
  setActiveBackpack,
  getKBMounts,
  setKBMounts,
  addKBMount,
  removeKBMount,
  editKBMount,
  colorForPath,
  deriveName,
  BackpackRegistryError,
} from "./core/backpacks-registry.js";
export type { BackpackEntry, KBMountConfig } from "./core/backpacks-registry.js";

// Knowledge Base (document store)
export { DocumentStore } from "./core/document-store.js";
export type {
  KBMount,
  KBDocument,
  KBDocumentMeta,
  KBDocumentSummary,
  KBListResult,
  KBMountInfo,
  WikilinkRef,
} from "./core/document-store.js";
export { parseWikilinks } from "./core/document-store.js";

// Signals (the third primitive)
export { SignalStore } from "./core/signal-store.js";
export type {
  Signal,
  SignalFile,
  SignalConfig,
  SignalResult,
  SignalKind,
  SignalCategory,
  SignalSeverity,
  GraphSignalDetector,
  CrossCuttingSignalDetector,
} from "./core/signal-types.js";
export { GRAPH_DETECTORS, CROSS_CUTTING_DETECTORS } from "./core/signal-detectors.js";

// Remote graph registry (subscriptions to graphs hosted at HTTPS URLs)
export { RemoteRegistry, RemoteRegistryError } from "./core/remote-registry.js";
export type { RemoteEntry } from "./core/remote-registry.js";
export { remoteFetch, RemoteFetchError, isBlockedIp } from "./core/remote-fetch.js";
export type { RemoteFetchOptions, RemoteFetchResult } from "./core/remote-fetch.js";
export { validateRemoteGraph, RemoteSchemaError, REMOTE_GRAPH_LIMITS } from "./core/remote-schema.js";

// Telemetry
export { initTelemetry, trackEvent, trackTokenSavings, shutdown as shutdownTelemetry } from "./core/telemetry.js";

// Token estimation
export { estimateTokens, estimateGraphTokens, computeSavings, formatSavingsFooter } from "./core/token-estimate.js";

// Sharing (envelope format, age encryption, relay client)
export {
  createEnvelope,
  parseEnvelope,
  generateKeyPair,
  encrypt,
  decrypt,
  encodeKeyForFragment,
  decodeKeyFromFragment,
  downloadFromRelay,
  getShareMeta,
} from "./sharing/index.js";
export type {
  EnvelopeHeader,
  Envelope,
  KeyPair,
  ShareResult,
  RelayConfig,
} from "./sharing/index.js";

// MCP server factory
export { createMcpServer } from "./mcp/server.js";
export type { BackpackServerConfig, BackpackLocalConfig, BackpackAppConfig } from "./mcp/server.js";

// Sync Protocol v0.1
export {
  SyncClient,
  SyncRelayClient,
  SyncVersionConflictError,
  ARTIFACT_KIND_GRAPH,
  ARTIFACT_KIND_KB_DOC,
  SYNC_PROTOCOL_VERSION,
  hashContent as hashSyncContent,
  parseArtifactId,
  readSyncState,
  writeSyncState,
  deleteSyncState,
  isStateInitialized,
  runStartupSync,
} from "./sync/index.js";
export type {
  SyncClientOptions,
  RegisterOptions,
  SyncRelayClientOptions,
  TokenProvider,
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
} from "./sync/index.js";
