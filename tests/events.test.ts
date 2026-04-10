import { describe, it, expect } from "vitest";
import {
  replay,
  diffToEvents,
  parseEventLog,
  serializeEvent,
  parseEvent,
  EventReplayError,
  makeNodeAddEvent,
  makeNodeUpdateEvent,
  makeNodeRemoveEvent,
  makeEdgeAddEvent,
  makeEdgeRemoveEvent,
  makeMetadataUpdateEvent,
  makeSnapshotLabelEvent,
  type GraphEvent,
} from "../src/core/events.js";
import type { Node, Edge, LearningGraphMetadata, LearningGraphData } from "../src/core/types.js";

const baseMeta: LearningGraphMetadata = {
  name: "test",
  description: "",
  createdAt: "2026-04-10T00:00:00Z",
  updatedAt: "2026-04-10T00:00:00Z",
};

function makeNode(id: string, type = "Concept", props: Record<string, unknown> = {}): Node {
  return {
    id,
    type,
    properties: props,
    createdAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-10T00:00:00Z",
  };
}

function makeEdge(id: string, sourceId: string, targetId: string, type = "RELATES_TO"): Edge {
  return {
    id,
    type,
    sourceId,
    targetId,
    properties: {},
    createdAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-10T00:00:00Z",
  };
}

describe("replay — basic operations", () => {
  it("returns empty state for empty event log", () => {
    const result = replay([], baseMeta);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.metadata.name).toBe("test");
  });

  it("applies a single node.add", () => {
    const events = [makeNodeAddEvent(makeNode("n1"))];
    const result = replay(events, baseMeta);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("n1");
  });

  it("applies node.update by merging properties", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1", "Concept", { a: 1 })),
      makeNodeUpdateEvent("n1", { b: 2 }),
    ];
    const result = replay(events, baseMeta);
    expect(result.nodes[0].properties).toEqual({ a: 1, b: 2 });
  });

  it("applies node.update with null to delete a property", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1", "Concept", { a: 1, b: 2 })),
      makeNodeUpdateEvent("n1", { b: null }),
    ];
    const result = replay(events, baseMeta);
    expect(result.nodes[0].properties).toEqual({ a: 1 });
  });

  it("removes a node and cascades to its edges", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeNodeAddEvent(makeNode("n2")),
      makeEdgeAddEvent(makeEdge("e1", "n1", "n2")),
      makeNodeRemoveEvent("n1"),
    ];
    const result = replay(events, baseMeta);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("n2");
    expect(result.edges).toHaveLength(0);
  });

  it("applies edge.add and edge.remove", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeNodeAddEvent(makeNode("n2")),
      makeEdgeAddEvent(makeEdge("e1", "n1", "n2")),
      makeEdgeRemoveEvent("e1"),
    ];
    const result = replay(events, baseMeta);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
  });

  it("applies metadata.update", () => {
    const events = [
      makeMetadataUpdateEvent({ description: "new description" }),
    ];
    const result = replay(events, baseMeta);
    expect(result.metadata.description).toBe("new description");
    expect(result.metadata.name).toBe("test");
  });

  it("treats snapshot.label as a no-op for state", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeSnapshotLabelEvent("v1"),
      makeNodeAddEvent(makeNode("n2")),
    ];
    const result = replay(events, baseMeta);
    expect(result.nodes).toHaveLength(2);
  });
});

describe("replay — error cases", () => {
  it("rejects an unknown event schema version", () => {
    const events: GraphEvent[] = [
      { ...makeNodeAddEvent(makeNode("n1")), v: 999 } as any,
    ];
    expect(() => replay(events, baseMeta)).toThrow(EventReplayError);
  });

  it("rejects duplicate node ids", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeNodeAddEvent(makeNode("n1")),
    ];
    expect(() => replay(events, baseMeta)).toThrow(/already exists/);
  });

  it("rejects update of a non-existent node", () => {
    const events = [makeNodeUpdateEvent("missing", { a: 1 })];
    expect(() => replay(events, baseMeta)).toThrow(/does not exist/);
  });

  it("rejects remove of a non-existent node", () => {
    const events = [makeNodeRemoveEvent("missing")];
    expect(() => replay(events, baseMeta)).toThrow(/does not exist/);
  });

  it("rejects edge with missing source", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeEdgeAddEvent(makeEdge("e1", "missing", "n1")),
    ];
    expect(() => replay(events, baseMeta)).toThrow(/sourceId/);
  });

  it("rejects edge with missing target", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeEdgeAddEvent(makeEdge("e1", "n1", "missing")),
    ];
    expect(() => replay(events, baseMeta)).toThrow(/targetId/);
  });

  it("error includes event index", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeNodeAddEvent(makeNode("n2")),
      makeNodeRemoveEvent("missing"),
    ];
    try {
      replay(events, baseMeta);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EventReplayError);
      expect((err as EventReplayError).eventIndex).toBe(2);
    }
  });
});

describe("diffToEvents — basic", () => {
  function emptyData(): LearningGraphData {
    return { metadata: { ...baseMeta }, nodes: [], edges: [] };
  }

  it("returns empty event list for identical data", () => {
    const before = emptyData();
    const after = emptyData();
    expect(diffToEvents(before, after)).toEqual([]);
  });

  it("emits node.add for new nodes", () => {
    const before = emptyData();
    const after = { ...emptyData(), nodes: [makeNode("n1")] };
    const events = diffToEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("node.add");
  });

  it("emits node.remove for missing nodes", () => {
    const before = { ...emptyData(), nodes: [makeNode("n1")] };
    const after = emptyData();
    const events = diffToEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("node.remove");
  });

  it("emits node.update for property changes", () => {
    const before = { ...emptyData(), nodes: [makeNode("n1", "Concept", { a: 1 })] };
    const after = { ...emptyData(), nodes: [makeNode("n1", "Concept", { a: 2 })] };
    const events = diffToEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("node.update");
    expect((events[0] as any).properties).toEqual({ a: 2 });
  });

  it("emits property delete via null when key removed", () => {
    const before = { ...emptyData(), nodes: [makeNode("n1", "Concept", { a: 1, b: 2 })] };
    const after = { ...emptyData(), nodes: [makeNode("n1", "Concept", { a: 1 })] };
    const events = diffToEvents(before, after);
    const update = events[0] as any;
    expect(update.op).toBe("node.update");
    expect(update.properties).toEqual({ b: null });
  });

  it("emits remove+add for type change", () => {
    const before = { ...emptyData(), nodes: [makeNode("n1", "Concept")] };
    const after = { ...emptyData(), nodes: [makeNode("n1", "Topic")] };
    const events = diffToEvents(before, after);
    expect(events).toHaveLength(2);
    expect(events[0].op).toBe("node.remove");
    expect(events[1].op).toBe("node.add");
  });

  it("emits edge.add for new edges", () => {
    const before = { ...emptyData(), nodes: [makeNode("n1"), makeNode("n2")] };
    const after = { ...before, edges: [makeEdge("e1", "n1", "n2")] };
    const events = diffToEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("edge.add");
  });

  it("does not emit explicit edge.remove when endpoint node is being removed", () => {
    const before = {
      ...emptyData(),
      nodes: [makeNode("n1"), makeNode("n2")],
      edges: [makeEdge("e1", "n1", "n2")],
    };
    const after = { ...emptyData(), nodes: [makeNode("n2")] };
    const events = diffToEvents(before, after);
    // Should be: node.remove n1 (cascades the edge), nothing else
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("node.remove");
  });

  it("emits metadata.update on description change", () => {
    const before = { ...emptyData(), metadata: { ...baseMeta, description: "old" } };
    const after = { ...emptyData(), metadata: { ...baseMeta, description: "new" } };
    const events = diffToEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("metadata.update");
  });
});

describe("diffToEvents + replay — round trip", () => {
  it("round trips empty state", () => {
    const before: LearningGraphData = { metadata: { ...baseMeta }, nodes: [], edges: [] };
    const after: LearningGraphData = { metadata: { ...baseMeta }, nodes: [], edges: [] };
    const events = diffToEvents(before, after);
    const result = replay(events, baseMeta);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("round trips a graph with nodes and edges", () => {
    const before: LearningGraphData = { metadata: { ...baseMeta }, nodes: [], edges: [] };
    const after: LearningGraphData = {
      metadata: { ...baseMeta, description: "filled" },
      nodes: [
        makeNode("n1", "Concept", { label: "A" }),
        makeNode("n2", "Concept", { label: "B" }),
      ],
      edges: [makeEdge("e1", "n1", "n2")],
    };
    const events = diffToEvents(before, after);
    const result = replay(events, baseMeta);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.metadata.description).toBe("filled");
  });

  it("round trips node updates", () => {
    const before: LearningGraphData = {
      metadata: { ...baseMeta },
      nodes: [makeNode("n1", "Concept", { a: 1, b: 2 })],
      edges: [],
    };
    const after: LearningGraphData = {
      metadata: { ...baseMeta },
      nodes: [makeNode("n1", "Concept", { a: 1, c: 3 })],
      edges: [],
    };
    const events = diffToEvents(before, after);
    // Apply diff starting from `before`
    const allEvents = [...diffToEvents({ metadata: baseMeta, nodes: [], edges: [] }, before), ...events];
    const result = replay(allEvents, baseMeta);
    expect(result.nodes[0].properties).toEqual({ a: 1, c: 3 });
  });
});

describe("serializeEvent + parseEvent", () => {
  it("round trips a node.add event", () => {
    const event = makeNodeAddEvent(makeNode("n1"));
    const line = serializeEvent(event);
    const parsed = parseEvent(line);
    expect(parsed).toEqual(event);
  });

  it("rejects empty lines", () => {
    expect(() => parseEvent("")).toThrow();
    expect(() => parseEvent("   ")).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => parseEvent('"string"')).toThrow();
    expect(() => parseEvent("42")).toThrow();
  });
});

describe("parseEventLog", () => {
  it("parses multiple events from a JSONL document", () => {
    const events = [
      makeNodeAddEvent(makeNode("n1")),
      makeNodeAddEvent(makeNode("n2")),
    ];
    const text = events.map(serializeEvent).join("\n");
    const parsed = parseEventLog(text);
    expect(parsed).toHaveLength(2);
  });

  it("skips blank lines", () => {
    const text =
      serializeEvent(makeNodeAddEvent(makeNode("n1"))) +
      "\n\n" +
      serializeEvent(makeNodeAddEvent(makeNode("n2"))) +
      "\n";
    const parsed = parseEventLog(text);
    expect(parsed).toHaveLength(2);
  });

  it("includes line number in error message", () => {
    const text = "valid line is not\nactually valid";
    expect(() => parseEventLog(text)).toThrow(/line 1/);
  });
});
