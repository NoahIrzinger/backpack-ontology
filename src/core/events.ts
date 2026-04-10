// ============================================================
// Event types and replay logic for event-sourced learning graphs.
//
// A graph branch is an append-only sequence of events. The current
// state of the branch is the result of replaying all events from the
// beginning. Snapshots are events with a `label` field. Rollback is
// truncating the event log at a snapshot's position.
//
// This module is pure: events in, state out, no IO. The storage
// backend handles persistence; this module handles semantics.
// ============================================================

import type { Node, Edge, LearningGraphData, LearningGraphMetadata } from "./types.js";

// --- Event schema version ---
//
// Bumped when the event format changes incompatibly. The replay function
// rejects events with a version it doesn't know.

export const EVENT_SCHEMA_VERSION = 1;

// --- Event types ---

export type EventOp =
  | "node.add"
  | "node.update"
  | "node.remove"
  | "edge.add"
  | "edge.remove"
  | "metadata.update"
  | "snapshot.label";

export interface BaseEvent {
  /** Schema version for forward-compat checks. */
  v: number;
  /** ISO timestamp the event was created. */
  ts: string;
  /** Optional author identifier (e.g. machine ID, user email). */
  author?: string;
  /** Operation discriminator. */
  op: EventOp;
}

export interface NodeAddEvent extends BaseEvent {
  op: "node.add";
  node: Node;
}

export interface NodeUpdateEvent extends BaseEvent {
  op: "node.update";
  id: string;
  /** Properties to merge into the existing node. Pass `null` for a key to delete it. */
  properties: Record<string, unknown>;
}

export interface NodeRemoveEvent extends BaseEvent {
  op: "node.remove";
  id: string;
}

export interface EdgeAddEvent extends BaseEvent {
  op: "edge.add";
  edge: Edge;
}

export interface EdgeRemoveEvent extends BaseEvent {
  op: "edge.remove";
  id: string;
}

export interface MetadataUpdateEvent extends BaseEvent {
  op: "metadata.update";
  patch: Partial<Pick<LearningGraphMetadata, "name" | "description">>;
}

export interface SnapshotLabelEvent extends BaseEvent {
  op: "snapshot.label";
  /** Optional human-readable label. */
  label?: string;
}

export type GraphEvent =
  | NodeAddEvent
  | NodeUpdateEvent
  | NodeRemoveEvent
  | EdgeAddEvent
  | EdgeRemoveEvent
  | MetadataUpdateEvent
  | SnapshotLabelEvent;

// --- Errors ---

export class EventReplayError extends Error {
  constructor(
    message: string,
    public readonly eventIndex: number,
    public readonly event: GraphEvent | null,
  ) {
    super(`event ${eventIndex}: ${message}`);
    this.name = "EventReplayError";
  }
}

// --- Helpers ---

function nowISO(): string {
  return new Date().toISOString();
}

export function makeNodeAddEvent(node: Node, author?: string): NodeAddEvent {
  return { v: EVENT_SCHEMA_VERSION, ts: nowISO(), author, op: "node.add", node };
}

export function makeNodeUpdateEvent(
  id: string,
  properties: Record<string, unknown>,
  author?: string,
): NodeUpdateEvent {
  return {
    v: EVENT_SCHEMA_VERSION,
    ts: nowISO(),
    author,
    op: "node.update",
    id,
    properties,
  };
}

export function makeNodeRemoveEvent(id: string, author?: string): NodeRemoveEvent {
  return { v: EVENT_SCHEMA_VERSION, ts: nowISO(), author, op: "node.remove", id };
}

export function makeEdgeAddEvent(edge: Edge, author?: string): EdgeAddEvent {
  return { v: EVENT_SCHEMA_VERSION, ts: nowISO(), author, op: "edge.add", edge };
}

export function makeEdgeRemoveEvent(id: string, author?: string): EdgeRemoveEvent {
  return { v: EVENT_SCHEMA_VERSION, ts: nowISO(), author, op: "edge.remove", id };
}

export function makeMetadataUpdateEvent(
  patch: Partial<Pick<LearningGraphMetadata, "name" | "description">>,
  author?: string,
): MetadataUpdateEvent {
  return {
    v: EVENT_SCHEMA_VERSION,
    ts: nowISO(),
    author,
    op: "metadata.update",
    patch,
  };
}

export function makeSnapshotLabelEvent(
  label?: string,
  author?: string,
): SnapshotLabelEvent {
  return { v: EVENT_SCHEMA_VERSION, ts: nowISO(), author, op: "snapshot.label", label };
}

// --- Replay / apply ---

/**
 * Apply a sequence of events on top of an existing state. Pure function:
 * does not mutate inputs. Use this when you already have a materialized
 * state and want to extend it with newly-appended events.
 */
export function applyEvents(
  state: LearningGraphData,
  events: GraphEvent[],
): LearningGraphData {
  return doReplay(events, state.metadata, state);
}

/**
 * Replay a sequence of events into a LearningGraphData state, starting
 * from an empty state with the given metadata. Pure function: no IO, no
 * mutation of inputs.
 *
 * Throws EventReplayError on the first invalid event. The error
 * carries the event index so the caller can locate the problem in
 * the source log.
 */
export function replay(
  events: GraphEvent[],
  initialMetadata: LearningGraphMetadata,
): LearningGraphData {
  return doReplay(events, initialMetadata, null);
}

function doReplay(
  events: GraphEvent[],
  initialMetadata: LearningGraphMetadata,
  startingState: LearningGraphData | null,
): LearningGraphData {
  // Mutable accumulators (released as the immutable result on return)
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  let metadata: LearningGraphMetadata = { ...initialMetadata };

  if (startingState) {
    for (const node of startingState.nodes) {
      nodes.set(node.id, { ...node });
    }
    for (const edge of startingState.edges) {
      edges.set(edge.id, { ...edge });
    }
    metadata = { ...startingState.metadata };
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || typeof event !== "object") {
      throw new EventReplayError("event is not an object", i, null);
    }
    if (event.v !== EVENT_SCHEMA_VERSION) {
      throw new EventReplayError(
        `unknown event schema version ${event.v}`,
        i,
        event,
      );
    }
    switch (event.op) {
      case "node.add": {
        if (nodes.has(event.node.id)) {
          throw new EventReplayError(
            `node ${event.node.id} already exists`,
            i,
            event,
          );
        }
        nodes.set(event.node.id, { ...event.node });
        break;
      }
      case "node.update": {
        const existing = nodes.get(event.id);
        if (!existing) {
          throw new EventReplayError(
            `node ${event.id} does not exist`,
            i,
            event,
          );
        }
        const merged: Record<string, unknown> = { ...existing.properties };
        for (const [key, value] of Object.entries(event.properties)) {
          if (value === null) {
            delete merged[key];
          } else {
            merged[key] = value;
          }
        }
        nodes.set(event.id, {
          ...existing,
          properties: merged,
          updatedAt: event.ts,
        });
        break;
      }
      case "node.remove": {
        if (!nodes.has(event.id)) {
          throw new EventReplayError(
            `node ${event.id} does not exist`,
            i,
            event,
          );
        }
        nodes.delete(event.id);
        // Cascade delete edges that reference this node
        for (const [edgeId, edge] of edges) {
          if (edge.sourceId === event.id || edge.targetId === event.id) {
            edges.delete(edgeId);
          }
        }
        break;
      }
      case "edge.add": {
        if (edges.has(event.edge.id)) {
          throw new EventReplayError(
            `edge ${event.edge.id} already exists`,
            i,
            event,
          );
        }
        // Both endpoints must exist at the time of replay
        if (!nodes.has(event.edge.sourceId)) {
          throw new EventReplayError(
            `edge ${event.edge.id} sourceId ${event.edge.sourceId} not in graph`,
            i,
            event,
          );
        }
        if (!nodes.has(event.edge.targetId)) {
          throw new EventReplayError(
            `edge ${event.edge.id} targetId ${event.edge.targetId} not in graph`,
            i,
            event,
          );
        }
        edges.set(event.edge.id, { ...event.edge });
        break;
      }
      case "edge.remove": {
        if (!edges.has(event.id)) {
          throw new EventReplayError(
            `edge ${event.id} does not exist`,
            i,
            event,
          );
        }
        edges.delete(event.id);
        break;
      }
      case "metadata.update": {
        metadata = {
          ...metadata,
          ...event.patch,
          updatedAt: event.ts,
        };
        break;
      }
      case "snapshot.label": {
        // Snapshots are markers in the log. They don't change state.
        break;
      }
      default: {
        const exhaustive: never = event;
        throw new EventReplayError(
          `unknown event op: ${(exhaustive as GraphEvent).op}`,
          i,
          exhaustive as GraphEvent,
        );
      }
    }
  }

  return {
    metadata,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

// --- Diff ---

/**
 * Compute the minimal sequence of events that would transform `before`
 * into `after`. Used by the storage backend's `saveOntology` to support
 * coarse-grained "save the whole graph" callers transparently.
 *
 * Detection rules:
 *   - Nodes present in `after` but not `before`: node.add
 *   - Nodes present in `before` but not `after`: node.remove (cascades to edges)
 *   - Nodes present in both with different properties: node.update
 *   - Edges present in `after` but not `before`: edge.add
 *   - Edges present in `before` but not `after`: edge.remove
 *   - Metadata name/description differences: metadata.update
 */
export function diffToEvents(
  before: LearningGraphData,
  after: LearningGraphData,
  author?: string,
): GraphEvent[] {
  const events: GraphEvent[] = [];

  // Metadata
  const metaPatch: Partial<Pick<LearningGraphMetadata, "name" | "description">> = {};
  if (before.metadata.name !== after.metadata.name) {
    metaPatch.name = after.metadata.name;
  }
  if (before.metadata.description !== after.metadata.description) {
    metaPatch.description = after.metadata.description;
  }
  if (Object.keys(metaPatch).length > 0) {
    events.push(makeMetadataUpdateEvent(metaPatch, author));
  }

  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));

  // Removed edges first (so cascade-delete from removed nodes doesn't double-emit)
  // Removed nodes will cascade their own edges in replay; we only need explicit
  // edge removes for edges whose endpoints are NOT being removed.
  const removedNodeIds = new Set<string>();
  for (const id of beforeNodes.keys()) {
    if (!afterNodes.has(id)) removedNodeIds.add(id);
  }

  for (const [id, edge] of beforeEdges) {
    if (afterEdges.has(id)) continue;
    // Skip edges whose endpoints are being removed — the node.remove cascade handles them
    if (removedNodeIds.has(edge.sourceId) || removedNodeIds.has(edge.targetId)) {
      continue;
    }
    events.push(makeEdgeRemoveEvent(id, author));
  }

  // Removed nodes
  for (const id of removedNodeIds) {
    events.push(makeNodeRemoveEvent(id, author));
  }

  // Added + updated nodes
  for (const [id, node] of afterNodes) {
    const prev = beforeNodes.get(id);
    if (!prev) {
      events.push(makeNodeAddEvent(node, author));
    } else if (
      JSON.stringify(prev.properties) !== JSON.stringify(node.properties) ||
      prev.type !== node.type
    ) {
      // Type changes are encoded as a remove+add to preserve invariants;
      // property-only changes use update
      if (prev.type !== node.type) {
        events.push(makeNodeRemoveEvent(id, author));
        events.push(makeNodeAddEvent(node, author));
      } else {
        // Compute property delta: keys in `after` not equal in `before` are
        // updated, keys in `before` not in `after` are deleted (set to null)
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node.properties)) {
          if (!Object.prototype.hasOwnProperty.call(prev.properties, k)) {
            patch[k] = v;
          } else if (JSON.stringify(prev.properties[k]) !== JSON.stringify(v)) {
            patch[k] = v;
          }
        }
        for (const k of Object.keys(prev.properties)) {
          if (!Object.prototype.hasOwnProperty.call(node.properties, k)) {
            patch[k] = null;
          }
        }
        events.push(makeNodeUpdateEvent(id, patch, author));
      }
    }
  }

  // Added edges
  for (const [id, edge] of afterEdges) {
    if (!beforeEdges.has(id)) {
      events.push(makeEdgeAddEvent(edge, author));
    }
  }

  return events;
}

// --- Serialization ---

/**
 * Serialize an event to a single JSONL line (no trailing newline).
 */
export function serializeEvent(event: GraphEvent): string {
  return JSON.stringify(event);
}

/**
 * Parse a single JSONL line into an event. Throws on malformed input.
 */
export function parseEvent(line: string): GraphEvent {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new Error("empty event line");
  }
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("event must be an object");
  }
  return parsed as GraphEvent;
}

/**
 * Parse a full JSONL document into an array of events. Skips blank lines.
 */
export function parseEventLog(text: string): GraphEvent[] {
  const events: GraphEvent[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    try {
      events.push(parseEvent(line));
    } catch (err) {
      throw new Error(`parse error on line ${i + 1}: ${(err as Error).message}`);
    }
  }
  return events;
}
