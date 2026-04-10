import { describe, it, expect } from "vitest";
import {
  validateRemoteGraph,
  RemoteSchemaError,
  REMOTE_GRAPH_LIMITS,
} from "../src/core/remote-schema.js";

function minimalGraph(overrides: any = {}) {
  return {
    metadata: { name: "test", description: "" },
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe("validateRemoteGraph", () => {
  it("accepts a minimal valid graph", () => {
    const result = validateRemoteGraph(minimalGraph());
    expect(result.data.metadata.name).toBe("test");
    expect(result.data.nodes).toEqual([]);
    expect(result.data.edges).toEqual([]);
    expect(result.droppedEdges).toBe(0);
  });

  it("accepts a graph with valid nodes and edges", () => {
    const result = validateRemoteGraph({
      metadata: { name: "test" },
      nodes: [
        { id: "a", type: "Concept", properties: { label: "A" } },
        { id: "b", type: "Concept", properties: { label: "B" } },
      ],
      edges: [
        {
          id: "e1",
          type: "RELATES_TO",
          sourceId: "a",
          targetId: "b",
          properties: {},
        },
      ],
    });
    expect(result.data.nodes).toHaveLength(2);
    expect(result.data.edges).toHaveLength(1);
  });

  it("drops edges that reference unknown node ids", () => {
    const result = validateRemoteGraph({
      metadata: { name: "test" },
      nodes: [{ id: "a", type: "Concept", properties: {} }],
      edges: [
        {
          id: "e1",
          type: "X",
          sourceId: "a",
          targetId: "missing",
          properties: {},
        },
      ],
    });
    expect(result.data.edges).toHaveLength(0);
    expect(result.droppedEdges).toBe(1);
  });

  it("rejects non-object root", () => {
    expect(() => validateRemoteGraph(null)).toThrow(RemoteSchemaError);
    expect(() => validateRemoteGraph([])).toThrow(RemoteSchemaError);
    expect(() => validateRemoteGraph("string")).toThrow(RemoteSchemaError);
    expect(() => validateRemoteGraph(42)).toThrow(RemoteSchemaError);
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      validateRemoteGraph({ metadata: { name: "x" }, nodes: [], edges: [], extra: 1 }),
    ).toThrow(/unknown top-level key 'extra'/);
  });

  it("rejects missing metadata", () => {
    expect(() => validateRemoteGraph({ nodes: [], edges: [] })).toThrow(
      RemoteSchemaError,
    );
  });

  it("rejects missing metadata.name", () => {
    expect(() =>
      validateRemoteGraph({ metadata: {}, nodes: [], edges: [] }),
    ).toThrow(/metadata.name/);
  });

  it("rejects nodes that aren't an array", () => {
    expect(() =>
      validateRemoteGraph({ metadata: { name: "x" }, nodes: {}, edges: [] }),
    ).toThrow(/nodes must be an array/);
  });

  it("rejects edges that aren't an array", () => {
    expect(() =>
      validateRemoteGraph({ metadata: { name: "x" }, nodes: [], edges: {} }),
    ).toThrow(/edges must be an array/);
  });

  it("rejects too many nodes", () => {
    const tooMany = Array.from({ length: REMOTE_GRAPH_LIMITS.maxNodes + 1 }, (_, i) => ({
      id: `n${i}`,
      type: "T",
      properties: {},
    }));
    expect(() =>
      validateRemoteGraph(minimalGraph({ nodes: tooMany })),
    ).toThrow(/exceeds max/);
  });

  it("rejects duplicate node ids", () => {
    expect(() =>
      validateRemoteGraph({
        metadata: { name: "x" },
        nodes: [
          { id: "a", type: "T", properties: {} },
          { id: "a", type: "T", properties: {} },
        ],
        edges: [],
      }),
    ).toThrow(/duplicate node id/);
  });

  it("rejects nodes with non-string id", () => {
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: 42, type: "T", properties: {} }],
        }),
      ),
    ).toThrow(/expected string/);
  });

  it("rejects nodes missing required type", () => {
    expect(() =>
      validateRemoteGraph(
        minimalGraph({ nodes: [{ id: "a", properties: {} }] }),
      ),
    ).toThrow(/missing required string/);
  });

  it("rejects properties that aren't a plain object", () => {
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: "string" }],
        }),
      ),
    ).toThrow(/plain object/);
  });

  it("rejects nested object property values", () => {
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [
            {
              id: "a",
              type: "T",
              properties: { nested: { foo: "bar" } },
            },
          ],
        }),
      ),
    ).toThrow(/string, number, boolean/);
  });

  it("rejects __proto__ property keys (prototype pollution)", () => {
    // Object literal `{ __proto__: ... }` sets the prototype, not an own
    // property. To test the defense we need an actual own property, which
    // Object.fromEntries creates.
    const props = Object.fromEntries([["__proto__", "evil"]]);
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: props }],
        }),
      ),
    ).toThrow(/not allowed/);
  });

  it("rejects constructor property keys", () => {
    // Need to use Object.fromEntries to bypass JS quirks around constructor key
    const props = Object.fromEntries([["constructor", "evil"]]);
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: props }],
        }),
      ),
    ).toThrow(/not allowed/);
  });

  it("rejects non-finite numbers", () => {
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: { x: Infinity } }],
        }),
      ),
    ).toThrow(/finite/);
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: { x: NaN } }],
        }),
      ),
    ).toThrow(/finite/);
  });

  it("accepts arrays of primitives", () => {
    const result = validateRemoteGraph(
      minimalGraph({
        nodes: [
          {
            id: "a",
            type: "T",
            properties: { tags: ["foo", "bar"], scores: [1, 2, 3] },
          },
        ],
      }),
    );
    expect((result.data.nodes[0].properties as any).tags).toEqual(["foo", "bar"]);
  });

  it("rejects arrays of objects", () => {
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [
            {
              id: "a",
              type: "T",
              properties: { items: [{ nested: 1 }] },
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("rejects oversized property strings", () => {
    const huge = "x".repeat(REMOTE_GRAPH_LIMITS.maxPropertyStringLength + 1);
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: { big: huge } }],
        }),
      ),
    ).toThrow(/exceeds max length/);
  });

  it("rejects too many property keys", () => {
    const props: Record<string, string> = {};
    for (let i = 0; i <= REMOTE_GRAPH_LIMITS.maxPropertyKeys; i++) {
      props[`k${i}`] = "v";
    }
    expect(() =>
      validateRemoteGraph(
        minimalGraph({
          nodes: [{ id: "a", type: "T", properties: props }],
        }),
      ),
    ).toThrow(/too many property keys/);
  });

  it("preserves edge properties when valid", () => {
    const result = validateRemoteGraph({
      metadata: { name: "x" },
      nodes: [
        { id: "a", type: "T", properties: {} },
        { id: "b", type: "T", properties: {} },
      ],
      edges: [
        {
          id: "e1",
          type: "X",
          sourceId: "a",
          targetId: "b",
          properties: { weight: 0.5, label: "hi" },
        },
      ],
    });
    expect((result.data.edges[0].properties as any).weight).toBe(0.5);
    expect((result.data.edges[0].properties as any).label).toBe("hi");
  });

  it("auto-fills missing createdAt/updatedAt timestamps", () => {
    const result = validateRemoteGraph({
      metadata: { name: "x" },
      nodes: [{ id: "a", type: "T", properties: {} }],
      edges: [],
    });
    expect(result.data.nodes[0].createdAt).toBeTruthy();
    expect(result.data.nodes[0].updatedAt).toBeTruthy();
  });
});
