import { describe, it, expect } from "vitest";
import {
  planNormalization,
  eventsForPlan,
  planSummary,
} from "../src/core/normalize.js";
import type { LearningGraphData, Node, Edge } from "../src/core/types.js";

function makeNode(id: string, type: string, label = "x"): Node {
  return {
    id,
    type,
    properties: { name: label },
    createdAt: "",
    updatedAt: "",
  };
}

function makeEdge(id: string, type: string, sourceId: string, targetId: string): Edge {
  return {
    id,
    type,
    sourceId,
    targetId,
    properties: {},
    createdAt: "",
    updatedAt: "",
  };
}

function graphWith(nodes: Node[], edges: Edge[] = []): LearningGraphData {
  return {
    metadata: { name: "t", description: "", createdAt: "", updatedAt: "" },
    nodes,
    edges,
  };
}

describe("planNormalization — node type drift", () => {
  it("returns an empty plan for a clean graph", () => {
    const graph = graphWith([
      makeNode("n1", "Service"),
      makeNode("n2", "Service"),
      makeNode("n3", "Database"),
    ]);
    const plan = planNormalization(graph);
    expect(plan.nodeTypeRenames).toHaveLength(0);
    expect(plan.edgeTypeRenames).toHaveLength(0);
  });

  it("collapses case drift to the dominant variant", () => {
    const graph = graphWith([
      makeNode("n1", "Service"),
      makeNode("n2", "Service"),
      makeNode("n3", "Service"),
      makeNode("n4", "service"),
    ]);
    const plan = planNormalization(graph);
    expect(plan.nodeTypeRenames).toHaveLength(1);
    expect(plan.nodeTypeRenames[0]).toEqual({
      from: "service",
      to: "Service",
      count: 1,
    });
  });

  it("collapses separator drift to the dominant variant", () => {
    const graph = graphWith([
      makeNode("n1", "PersonNode"),
      makeNode("n2", "PersonNode"),
      makeNode("n3", "person_node"),
    ]);
    const plan = planNormalization(graph);
    expect(plan.nodeTypeRenames).toHaveLength(1);
    expect(plan.nodeTypeRenames[0].from).toBe("person_node");
    expect(plan.nodeTypeRenames[0].to).toBe("PersonNode");
  });

  it("does not flag distinct types that share a substring", () => {
    const graph = graphWith([
      makeNode("n1", "Service"),
      makeNode("n2", "MicroService"),
    ]);
    const plan = planNormalization(graph);
    expect(plan.nodeTypeRenames).toHaveLength(0);
  });

  it("handles three variants in one cluster", () => {
    const graph = graphWith([
      makeNode("n1", "Service"),
      makeNode("n2", "Service"),
      makeNode("n3", "service"),
      makeNode("n4", "SERVICE"),
    ]);
    const plan = planNormalization(graph);
    // Service has count 2, others 1 each → both rename to Service
    expect(plan.nodeTypeRenames).toHaveLength(2);
    expect(plan.nodeTypeRenames.every((r) => r.to === "Service")).toBe(true);
  });

  it("ties broken lexicographically by canonical pick", () => {
    const graph = graphWith([
      makeNode("n1", "alpha"),
      makeNode("n2", "Alpha"),
    ]);
    const plan = planNormalization(graph);
    // Tie at count=1, lexicographic: "Alpha" < "alpha" so Alpha wins
    expect(plan.nodeTypeRenames).toHaveLength(1);
    expect(plan.nodeTypeRenames[0].to).toBe("Alpha");
  });
});

describe("planNormalization — edge type drift", () => {
  it("normalizes edge types independently of nodes", () => {
    const graph = graphWith(
      [makeNode("n1", "A"), makeNode("n2", "A")],
      [
        makeEdge("e1", "DEPENDS_ON", "n1", "n2"),
        makeEdge("e2", "DEPENDS_ON", "n1", "n2"),
        makeEdge("e3", "depends_on", "n1", "n2"),
      ],
    );
    const plan = planNormalization(graph);
    expect(plan.edgeTypeRenames).toHaveLength(1);
    expect(plan.edgeTypeRenames[0]).toEqual({
      from: "depends_on",
      to: "DEPENDS_ON",
      count: 1,
    });
  });
});

describe("eventsForPlan", () => {
  it("emits a node.retype for every node matching a renamed type", () => {
    // Service has count 2, service has count 1 → Service is canonical
    const graph = graphWith([
      makeNode("n1", "Service"),
      makeNode("n2", "Service"),
      makeNode("n3", "service"),
    ]);
    const plan = planNormalization(graph);
    const events = eventsForPlan(graph, plan);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("node.retype");
    if (events[0].op === "node.retype") {
      expect(events[0].type).toBe("Service");
      expect(events[0].id).toBe("n3");
    }
  });

  it("emits an edge.retype for every edge matching a renamed type", () => {
    const graph = graphWith(
      [makeNode("n1", "A"), makeNode("n2", "A")],
      [
        makeEdge("e1", "DEPENDS_ON", "n1", "n2"),
        makeEdge("e2", "DEPENDS_ON", "n1", "n2"),
        makeEdge("e3", "depends_on", "n1", "n2"),
      ],
    );
    const plan = planNormalization(graph);
    const events = eventsForPlan(graph, plan);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("edge.retype");
  });

  it("emits no events for an empty plan", () => {
    const graph = graphWith([makeNode("n1", "Service")]);
    const plan = planNormalization(graph);
    const events = eventsForPlan(graph, plan);
    expect(events).toHaveLength(0);
  });
});

describe("planSummary", () => {
  it("counts affected nodes and edges", () => {
    // Service x2 dominant over service x1; DEPENDS_ON x2 dominant over depends_on x1
    const graph = graphWith(
      [
        makeNode("n1", "Service"),
        makeNode("n2", "Service"),
        makeNode("n3", "service"),
      ],
      [
        makeEdge("e1", "DEPENDS_ON", "n1", "n2"),
        makeEdge("e2", "DEPENDS_ON", "n2", "n3"),
        makeEdge("e3", "depends_on", "n1", "n3"),
      ],
    );
    const plan = planNormalization(graph);
    const summary = planSummary(plan);
    expect(summary.nodeRenameCount).toBe(1);
    expect(summary.totalAffectedNodes).toBe(1);
    expect(summary.edgeRenameCount).toBe(1);
    expect(summary.totalAffectedEdges).toBe(1);
  });
});
