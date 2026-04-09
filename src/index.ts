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

// Telemetry
export { initTelemetry, trackEvent, trackTokenSavings, shutdown as shutdownTelemetry } from "./core/telemetry.js";

// Token estimation
export { estimateTokens, estimateGraphTokens, computeSavings, formatSavingsFooter } from "./core/token-estimate.js";

// MCP server factory
export { createMcpServer } from "./mcp/server.js";
export type { BackpackServerConfig, BackpackLocalConfig, BackpackAppConfig } from "./mcp/server.js";
