import { describe, it, expect, beforeEach } from "vitest";
import { Graph } from "../src/core/graph.js";
import type { OntologyData } from "../src/core/types.js";

function emptyOntology(): OntologyData {
  const now = new Date().toISOString();
  return {
    metadata: {
      name: "test",
      description: "Test ontology",
      createdAt: now,
      updatedAt: now,
    },
    nodes: [],
    edges: [],
  };
}

describe("Graph", () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph(emptyOntology());
  });

  describe("nodes", () => {
    it("adds a node with generated id and timestamps", () => {
      const node = graph.addNode("Person", { name: "Alice", age: 30 });

      expect(node.id).toMatch(/^n_/);
      expect(node.type).toBe("Person");
      expect(node.properties).toEqual({ name: "Alice", age: 30 });
      expect(node.createdAt).toBeTruthy();
      expect(node.updatedAt).toBeTruthy();
    });

    it("retrieves a node by id", () => {
      const node = graph.addNode("Person", { name: "Bob" });
      const found = graph.getNode(node.id);

      expect(found).toEqual(node);
    });

    it("returns undefined for unknown id", () => {
      expect(graph.getNode("n_nonexistent")).toBeUndefined();
    });

    it("updates node properties by merging", () => {
      const node = graph.addNode("Person", { name: "Charlie", age: 25 });
      const updated = graph.updateNode(node.id, { age: 26, city: "Berlin" });

      expect(updated.properties).toEqual({
        name: "Charlie",
        age: 26,
        city: "Berlin",
      });
      // Properties merged correctly — that's what matters
      expect(updated.properties.name).toBe("Charlie");
    });

    it("throws when updating nonexistent node", () => {
      expect(() => graph.updateNode("n_nope", {})).toThrow("Node not found");
    });

    it("removes a node and cascades edges", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      graph.addEdge("KNOWS", a.id, b.id);

      const removedEdges = graph.removeNode(a.id);

      expect(removedEdges).toBe(1);
      expect(graph.getNode(a.id)).toBeUndefined();
      expect(graph.data.edges.length).toBe(0);
    });

    it("lists nodes with pagination", () => {
      for (let i = 0; i < 5; i++) {
        graph.addNode("Item", { name: `item-${i}` });
      }

      const page1 = graph.listNodes(undefined, 2, 0);
      expect(page1.nodes.length).toBe(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page2 = graph.listNodes(undefined, 2, 4);
      expect(page2.nodes.length).toBe(1);
      expect(page2.hasMore).toBe(false);
    });

    it("lists nodes filtered by type", () => {
      graph.addNode("Person", { name: "Alice" });
      graph.addNode("City", { name: "Berlin" });
      graph.addNode("Person", { name: "Bob" });

      const result = graph.listNodes("Person");
      expect(result.total).toBe(2);
      expect(result.nodes.every((n) => n.type === "Person")).toBe(true);
    });

    it("returns node summaries with label from first string property", () => {
      const node = graph.addNode("Person", { name: "Alice", age: 30 });
      const result = graph.listNodes();

      expect(result.nodes[0].label).toBe("Alice");
    });

    it("falls back to id as label when no string properties exist", () => {
      const node = graph.addNode("Counter", { value: 42 });
      const result = graph.listNodes();

      expect(result.nodes[0].label).toBe(node.id);
    });
  });

  describe("search", () => {
    it("finds nodes by substring in string properties", () => {
      graph.addNode("Person", { name: "Alice Johnson" });
      graph.addNode("Person", { name: "Bob Smith" });
      graph.addNode("City", { name: "Johannesburg" });

      const results = graph.searchNodes("john");
      expect(results.length).toBe(1); // "Johnson" contains "john", "Johannesburg" does not
    });

    it("searches within a specific type", () => {
      graph.addNode("Person", { name: "Alice" });
      graph.addNode("City", { name: "Alice Springs" });

      const results = graph.searchNodes("alice", "Person");
      expect(results.length).toBe(1);
      expect(results[0].type).toBe("Person");
    });

    it("matches the type name itself", () => {
      graph.addNode("Ingredient", { name: "garlic" });

      const results = graph.searchNodes("ingredient");
      expect(results.length).toBe(1);
    });

    it("searches array values", () => {
      graph.addNode("Article", { title: "GraphDB", tags: ["database", "graph"] });

      const results = graph.searchNodes("graph");
      expect(results.length).toBe(1);
    });
  });

  describe("node types", () => {
    it("returns distinct types with counts", () => {
      graph.addNode("Person", { name: "A" });
      graph.addNode("Person", { name: "B" });
      graph.addNode("City", { name: "C" });

      const types = graph.getNodeTypes();
      expect(types).toEqual([
        { type: "Person", count: 2 },
        { type: "City", count: 1 },
      ]);
    });

    it("returns empty array for empty graph", () => {
      expect(graph.getNodeTypes()).toEqual([]);
    });
  });

  describe("edges", () => {
    it("adds an edge between two nodes", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });

      const edge = graph.addEdge("KNOWS", a.id, b.id, { since: "2024" });

      expect(edge.id).toMatch(/^e_/);
      expect(edge.type).toBe("KNOWS");
      expect(edge.sourceId).toBe(a.id);
      expect(edge.targetId).toBe(b.id);
      expect(edge.properties).toEqual({ since: "2024" });
    });

    it("throws when source node doesn't exist", () => {
      const b = graph.addNode("Person", { name: "B" });
      expect(() => graph.addEdge("KNOWS", "n_fake", b.id)).toThrow(
        "Source node not found"
      );
    });

    it("throws when target node doesn't exist", () => {
      const a = graph.addNode("Person", { name: "A" });
      expect(() => graph.addEdge("KNOWS", a.id, "n_fake")).toThrow(
        "Target node not found"
      );
    });

    it("removes an edge", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      const edge = graph.addEdge("KNOWS", a.id, b.id);

      graph.removeEdge(edge.id);
      expect(graph.data.edges.length).toBe(0);
    });

    it("gets node with its connected edges", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      const c = graph.addNode("Person", { name: "C" });
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("KNOWS", c.id, a.id);

      const result = graph.getNodeWithEdges(a.id);
      expect(result.node.id).toBe(a.id);
      expect(result.edges.length).toBe(2);
    });
  });

  describe("importNodesAndEdges", () => {
    it("imports nodes with edges by index", () => {
      const result = graph.importNodesAndEdges(
        [
          { type: "Person", properties: { name: "Alice" } },
          { type: "Person", properties: { name: "Bob" } },
          { type: "Company", properties: { name: "Acme" } },
        ],
        [
          { type: "KNOWS", source: 0, target: 1 },
          { type: "WORKS_AT", source: 0, target: 2 },
          { type: "WORKS_AT", source: 1, target: 2 },
        ]
      );

      expect(result.nodeIds.length).toBe(3);
      expect(result.edgeIds.length).toBe(3);
      expect(result.nodeIds.every((id) => id.startsWith("n_"))).toBe(true);
      expect(result.edgeIds.every((id) => id.startsWith("e_"))).toBe(true);

      // Verify edges point to correct nodes
      const edge0 = graph.getEdge(result.edgeIds[0])!;
      expect(edge0.sourceId).toBe(result.nodeIds[0]);
      expect(edge0.targetId).toBe(result.nodeIds[1]);
    });

    it("imports edges referencing existing nodes by string ID", () => {
      const existing = graph.addNode("City", { name: "Berlin" });

      const result = graph.importNodesAndEdges(
        [{ type: "Person", properties: { name: "Alice" } }],
        [{ type: "LIVES_IN", source: 0, target: existing.id }]
      );

      expect(result.edgeIds.length).toBe(1);
      const edge = graph.getEdge(result.edgeIds[0])!;
      expect(edge.sourceId).toBe(result.nodeIds[0]);
      expect(edge.targetId).toBe(existing.id);
    });

    it("handles mixed references (index + string ID)", () => {
      const existing = graph.addNode("Company", { name: "Acme" });

      const result = graph.importNodesAndEdges(
        [
          { type: "Person", properties: { name: "Alice" } },
          { type: "Person", properties: { name: "Bob" } },
        ],
        [
          { type: "WORKS_AT", source: 0, target: existing.id },
          { type: "KNOWS", source: 0, target: 1 },
        ]
      );

      expect(result.edgeIds.length).toBe(2);
    });

    it("imports nodes without edges (backward compat)", () => {
      const result = graph.importNodesAndEdges([
        { type: "Person", properties: { name: "Alice" } },
        { type: "Person", properties: { name: "Bob" } },
      ]);

      expect(result.nodeIds.length).toBe(2);
      expect(result.edgeIds.length).toBe(0);
    });

    it("throws on out-of-bounds source index, zero mutations", () => {
      const nodesBefore = graph.data.nodes.length;

      expect(() =>
        graph.importNodesAndEdges(
          [{ type: "Person", properties: { name: "Alice" } }],
          [{ type: "KNOWS", source: 5, target: 0 }]
        )
      ).toThrow("source index 5 is out of bounds");

      expect(graph.data.nodes.length).toBe(nodesBefore);
    });

    it("throws on out-of-bounds target index", () => {
      expect(() =>
        graph.importNodesAndEdges(
          [{ type: "Person", properties: { name: "Alice" } }],
          [{ type: "KNOWS", source: 0, target: 3 }]
        )
      ).toThrow("target index 3 is out of bounds");
    });

    it("throws on nonexistent string ID reference, zero mutations", () => {
      const nodesBefore = graph.data.nodes.length;

      expect(() =>
        graph.importNodesAndEdges(
          [{ type: "Person", properties: { name: "Alice" } }],
          [{ type: "KNOWS", source: 0, target: "n_doesnotexist" }]
        )
      ).toThrow("target node not found: n_doesnotexist");

      expect(graph.data.nodes.length).toBe(nodesBefore);
    });

    it("imports edges with properties", () => {
      const result = graph.importNodesAndEdges(
        [
          { type: "Person", properties: { name: "Alice" } },
          { type: "Person", properties: { name: "Bob" } },
        ],
        [{ type: "KNOWS", source: 0, target: 1, properties: { since: "2024", weight: 0.8 } }]
      );

      const edge = graph.getEdge(result.edgeIds[0])!;
      expect(edge.properties).toEqual({ since: "2024", weight: 0.8 });
    });

    it("allows self-referential edges", () => {
      const result = graph.importNodesAndEdges(
        [{ type: "Task", properties: { name: "Review" } }],
        [{ type: "BLOCKS", source: 0, target: 0 }]
      );

      expect(result.edgeIds.length).toBe(1);
      const edge = graph.getEdge(result.edgeIds[0])!;
      expect(edge.sourceId).toBe(edge.targetId);
    });
  });

  describe("getStats", () => {
    it("computes orphan count and connected stats", () => {
      const a = graph.addNode("Person", { name: "Alice" });
      const b = graph.addNode("Person", { name: "Bob" });
      const c = graph.addNode("City", { name: "Berlin" });
      const d = graph.addNode("City", { name: "Paris" }); // orphan
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("LIVES_IN", a.id, c.id);

      const stats = graph.getStats();

      expect(stats.orphanCount).toBe(1);
      expect(stats.orphans[0].label).toBe("Paris");
      expect(stats.mostConnected[0].label).toBe("Alice");
      expect(stats.mostConnected[0].connections).toBe(2);
      expect(stats.avgConnections).toBeCloseTo(1); // 4 total connections / 4 nodes
      expect(stats.density).toBeGreaterThan(0);
      expect(stats.typeConnections.length).toBe(2); // Person<->Person, City<->Person
    });

    it("returns empty stats for empty graph", () => {
      const stats = graph.getStats();
      expect(stats.orphanCount).toBe(0);
      expect(stats.mostConnected).toEqual([]);
      expect(stats.density).toBe(0);
      expect(stats.avgConnections).toBe(0);
    });
  });

  describe("audit", () => {
    it("identifies orphans, weak nodes, and disconnected type pairs", () => {
      const a = graph.addNode("Person", { name: "Alice" });
      const b = graph.addNode("Person", { name: "Bob" });
      const c = graph.addNode("Person", { name: "Carol" });
      graph.addNode("Ship", { name: "Enterprise" }); // orphan, disconnected type
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("KNOWS", a.id, c.id);
      graph.addEdge("KNOWS", b.id, c.id);

      const audit = graph.audit();

      expect(audit.orphans.length).toBe(1);
      expect(audit.orphans[0].label).toBe("Enterprise");
      expect(audit.disconnectedTypePairs.length).toBe(1);
      expect(audit.disconnectedTypePairs[0].typeA).toBeDefined();
      expect(audit.suggestions.length).toBeGreaterThan(0);
      expect(audit.suggestions.some((s) => s.includes("orphan"))).toBe(true);
      expect(audit.suggestions.some((s) => s.includes("no edges between"))).toBe(true);
    });

    it("returns clean report for well-connected graph", () => {
      const a = graph.addNode("Person", { name: "Alice" });
      const b = graph.addNode("Person", { name: "Bob" });
      const c = graph.addNode("Person", { name: "Carol" });
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("KNOWS", b.id, c.id);
      graph.addEdge("KNOWS", a.id, c.id);

      const audit = graph.audit();

      expect(audit.orphans.length).toBe(0);
      expect(audit.suggestions.some((s) => s.includes("well-connected"))).toBe(true);
    });
  });

  describe("importEdges", () => {
    it("bulk-creates edges between existing nodes", () => {
      const a = graph.addNode("Person", { name: "Alice" });
      const b = graph.addNode("Person", { name: "Bob" });
      const c = graph.addNode("City", { name: "Berlin" });

      const ids = graph.importEdges([
        { type: "KNOWS", sourceId: a.id, targetId: b.id },
        { type: "LIVES_IN", sourceId: a.id, targetId: c.id },
      ]);

      expect(ids.length).toBe(2);
      expect(ids.every((id) => id.startsWith("e_"))).toBe(true);
      expect(graph.data.edges.length).toBe(2);
    });

    it("throws on invalid source, zero edges created", () => {
      const a = graph.addNode("Person", { name: "Alice" });

      expect(() =>
        graph.importEdges([
          { type: "KNOWS", sourceId: "n_fake", targetId: a.id },
        ])
      ).toThrow("source node not found");
      expect(graph.data.edges.length).toBe(0);
    });
  });

  describe("neighbors (graph traversal)", () => {
    it("finds immediate neighbors", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      const c = graph.addNode("Person", { name: "C" });
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("KNOWS", a.id, c.id);

      const result = graph.getNeighbors(a.id);
      expect(result.neighbors.length).toBe(2);
      expect(result.neighbors.every((n) => n.depth === 1)).toBe(true);
    });

    it("traverses multiple depths", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      const c = graph.addNode("Person", { name: "C" });
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("KNOWS", b.id, c.id);

      const result = graph.getNeighbors(a.id, undefined, "both", 2);
      expect(result.neighbors.length).toBe(2);

      const depths = result.neighbors.map((n) => n.depth);
      expect(depths).toContain(1);
      expect(depths).toContain(2);
    });

    it("respects direction filter", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      const c = graph.addNode("Person", { name: "C" });
      graph.addEdge("FOLLOWS", a.id, b.id);
      graph.addEdge("FOLLOWS", c.id, a.id);

      const outgoing = graph.getNeighbors(a.id, undefined, "outgoing");
      expect(outgoing.neighbors.length).toBe(1);
      expect(outgoing.neighbors[0].node.label).toBe("B");

      const incoming = graph.getNeighbors(a.id, undefined, "incoming");
      expect(incoming.neighbors.length).toBe(1);
      expect(incoming.neighbors[0].node.label).toBe("C");
    });

    it("filters by edge type", () => {
      const a = graph.addNode("Person", { name: "A" });
      const b = graph.addNode("Person", { name: "B" });
      const c = graph.addNode("City", { name: "Berlin" });
      graph.addEdge("KNOWS", a.id, b.id);
      graph.addEdge("LIVES_IN", a.id, c.id);

      const result = graph.getNeighbors(a.id, "KNOWS");
      expect(result.neighbors.length).toBe(1);
      expect(result.neighbors[0].node.label).toBe("B");
    });

    it("caps depth at 3", () => {
      // Create a chain: A -> B -> C -> D -> E
      const nodes = [];
      for (let i = 0; i < 5; i++) {
        nodes.push(graph.addNode("Node", { name: String.fromCharCode(65 + i) }));
      }
      for (let i = 0; i < 4; i++) {
        graph.addEdge("NEXT", nodes[i].id, nodes[i + 1].id);
      }

      // Even with depth=10, should only go 3 deep
      const result = graph.getNeighbors(nodes[0].id, undefined, "outgoing", 10);
      expect(result.neighbors.length).toBe(3); // B, C, D — not E
    });
  });
});
