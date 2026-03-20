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
  OntologyData,
  OntologyMetadata,
  OntologySummary,
  NodeSummary,
  EdgeSummary,
  NodeTypeInfo,
  EdgeTypeInfo,
  ListNodesResult,
  GetNodeResult,
  NeighborResult,
  NeighborEntry,
  StorageBackend,
} from "./core/types.js";

// Storage backends
export { JsonFileBackend } from "./storage/json-file-backend.js";

// Telemetry
export { initTelemetry, trackEvent, shutdown as shutdownTelemetry } from "./core/telemetry.js";

// MCP server factory
export { createMcpServer } from "./mcp/server.js";
