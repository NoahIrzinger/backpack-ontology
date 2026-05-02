// Public exports for connector authors.
// Connectors import from "backpack-ontology/connector" — not from the root —
// so this surface stays narrow and stable independently of internal changes.

export type {
  GraphEvent,
  EventOp,
  BaseEvent,
  NodeAddEvent,
  NodeUpdateEvent,
  NodeRetypeEvent,
  NodeRemoveEvent,
  EdgeAddEvent,
  EdgeRemoveEvent,
  EdgeRetypeEvent,
  MetadataUpdateEvent,
  SnapshotLabelEvent,
} from "./core/events.js";

export {
  EVENT_SCHEMA_VERSION,
  parseEvent,
  parseEventLog,
  serializeEvent,
} from "./core/events.js";

export type { Node, Edge, LearningGraphData, LearningGraphMetadata } from "./core/types.js";

export { dataDir, signalConfigFile } from "./core/paths.js";

// Re-export McpServer so downstream packages (like backpack-connector) can import
// the type from one place without duplicating the @modelcontextprotocol/sdk dep.
export type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export {
  getActiveBackpack,
  listBackpacks,
} from "./core/backpacks-registry.js";

export type { BackpackEntry } from "./core/backpacks-registry.js";

export type { Signal, SignalKind, SignalSeverity, GlobalSignalConfig, DetectorUserConfig } from "./core/signal-types.js";
