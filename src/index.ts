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

// Backpacks registry (multi-backpack management)
export {
  loadRegistry,
  listBackpacks,
  getBackpack,
  registerBackpack,
  unregisterBackpack,
  getActiveBackpack,
  setActiveBackpack,
  colorForPath,
  deriveName,
  BackpackRegistryError,
} from "./core/backpacks-registry.js";
export type { BackpackEntry } from "./core/backpacks-registry.js";

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

// MCP server factory
export { createMcpServer } from "./mcp/server.js";
export type { BackpackServerConfig, BackpackLocalConfig, BackpackAppConfig } from "./mcp/server.js";
