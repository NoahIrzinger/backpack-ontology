import { describe, it, expect } from "vitest";
import { validateProposal } from "../src/core/draft.js";
import type { LearningGraphData, Node } from "../src/core/types.js";

function makeNode(id: string, type: string, props: Record<string, unknown> = {}): Node {
  return { id, type, properties: props, createdAt: "", updatedAt: "" };
}

function emptyGraph(): LearningGraphData {
  return {
    metadata: {
      name: "test",
      description: "",
      createdAt: "",
      updatedAt: "",
    },
    nodes: [],
    edges: [],
  };
}

function graphWith(nodes: Node[]): LearningGraphData {
  return { ...emptyGraph(), nodes };
}

describe("validateProposal — clean batches", () => {
  it("accepts an empty batch", () => {
    const result = validateProposal(emptyGraph(), [], []);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.newNodeCount).toBe(0);
    expect(result.newEdgeCount).toBe(0);
  });

  it("accepts a single new node into an empty graph", () => {
    const result = validateProposal(
      emptyGraph(),
      [{ type: "Service", properties: { name: "auth" } }],
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.newNodeCount).toBe(1);
  });

  it("accepts an edge connecting two new nodes by index", () => {
    const result = validateProposal(
      emptyGraph(),
      [
        { type: "Service", properties: { name: "auth" } },
        { type: "Service", properties: { name: "users" } },
      ],
      [{ type: "DEPENDS_ON", source: 0, target: 1 }],
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts an edge anchoring to an existing node ID", () => {
    const graph = graphWith([makeNode("n_existing", "Service", { name: "platform" })]);
    const result = validateProposal(
      graph,
      [{ type: "Service", properties: { name: "auth" } }],
      [{ type: "DEPENDS_ON", source: 0, target: "n_existing" }],
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateProposal — type drift detection", () => {
  it("warns when a proposed node uses a type with different case", () => {
    const graph = graphWith([makeNode("n1", "Service")]);
    const result = validateProposal(graph, [
      { type: "service", properties: { name: "users" } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe("type_drift");
    expect(result.warnings[0].suggestion).toMatch(/Service/);
  });

  it("warns when type uses underscores vs camelCase", () => {
    const graph = graphWith([makeNode("n1", "PersonNode")]);
    const result = validateProposal(graph, [
      { type: "person_node", properties: { name: "Alice" } },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe("type_drift");
  });

  it("does not warn when the type matches exactly", () => {
    const graph = graphWith([makeNode("n1", "Service")]);
    const result = validateProposal(graph, [
      { type: "Service", properties: { name: "users" } },
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn for genuinely new types", () => {
    const graph = graphWith([makeNode("n1", "Service")]);
    const result = validateProposal(graph, [
      { type: "Database", properties: { name: "main" } },
    ]);
    expect(result.warnings.filter((w) => w.kind === "type_drift")).toHaveLength(0);
  });
});

describe("validateProposal — duplicate detection", () => {
  it("warns when a proposed node has the same type+label as an existing one", () => {
    const graph = graphWith([
      makeNode("n_existing", "Service", { name: "auth" }),
    ]);
    const result = validateProposal(graph, [
      { type: "Service", properties: { name: "auth" } },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe("duplicate_node");
    expect(result.warnings[0].suggestion).toMatch(/n_existing/);
  });

  it("does not flag dupes across different types", () => {
    const graph = graphWith([
      makeNode("n1", "Service", { name: "auth" }),
    ]);
    const result = validateProposal(graph, [
      { type: "Database", properties: { name: "auth" } },
    ]);
    expect(result.warnings.filter((w) => w.kind === "duplicate_node")).toHaveLength(0);
  });

  it("does not flag dupes when proposed node has no label", () => {
    const graph = graphWith([
      makeNode("n1", "Concept", { color: "blue" }),
    ]);
    const result = validateProposal(graph, [
      { type: "Concept", properties: { color: "red" } },
    ]);
    expect(result.warnings.filter((w) => w.kind === "duplicate_node")).toHaveLength(0);
  });
});

describe("validateProposal — three-role rule integration", () => {
  it("flags procedural nodes", () => {
    const result = validateProposal(emptyGraph(), [
      { type: "Step", properties: { label: "Compile the code" } },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe("role_violation_procedural");
    expect(result.warnings[0].nodeIndex).toBe(0);
  });

  it("flags briefing nodes", () => {
    const result = validateProposal(emptyGraph(), [
      { type: "Convention", properties: { rule: "use parameterized queries" } },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe("role_violation_briefing");
  });

  it("does not flag clean nodes", () => {
    const result = validateProposal(emptyGraph(), [
      { type: "Service", properties: { name: "auth" } },
      { type: "Person", properties: { name: "Alice" } },
    ]);
    expect(result.warnings.filter((w) =>
      w.kind === "role_violation_procedural" || w.kind === "role_violation_briefing",
    )).toHaveLength(0);
  });
});

describe("validateProposal — edge validation", () => {
  it("errors on edge source pointing to a missing index", () => {
    const result = validateProposal(
      emptyGraph(),
      [{ type: "Service", properties: { name: "auth" } }],
      [{ type: "DEPENDS_ON", source: 5, target: 0 }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].kind).toBe("invalid_edge_source");
  });

  it("errors on edge target pointing to a missing index", () => {
    const result = validateProposal(
      emptyGraph(),
      [{ type: "Service", properties: { name: "auth" } }],
      [{ type: "DEPENDS_ON", source: 0, target: 99 }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].kind).toBe("invalid_edge_target");
  });

  it("errors on edge source pointing to a non-existent node ID string", () => {
    const result = validateProposal(
      emptyGraph(),
      [{ type: "Service", properties: { name: "auth" } }],
      [{ type: "DEPENDS_ON", source: "n_missing", target: 0 }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].kind).toBe("invalid_edge_source");
  });

  it("errors on a self-loop where source equals target by index", () => {
    const result = validateProposal(
      emptyGraph(),
      [{ type: "Service", properties: { name: "auth" } }],
      [{ type: "DEPENDS_ON", source: 0, target: 0 }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].kind).toBe("self_loop_in_proposal");
  });

  it("accepts edge with valid existing node IDs on both sides", () => {
    const graph = graphWith([
      makeNode("n_a", "Service", { name: "auth" }),
      makeNode("n_b", "Service", { name: "users" }),
    ]);
    const result = validateProposal(
      graph,
      [],
      [{ type: "DEPENDS_ON", source: "n_a", target: "n_b" }],
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateProposal — property shape validation", () => {
  it("errors on a nested object property", () => {
    const result = validateProposal(emptyGraph(), [
      { type: "Service", properties: { config: { foo: "bar" } } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].kind).toBe("invalid_property_shape");
  });

  it("accepts an array of strings", () => {
    const result = validateProposal(emptyGraph(), [
      { type: "Service", properties: { tags: ["x", "y", "z"] } },
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts mixed primitive properties", () => {
    const result = validateProposal(emptyGraph(), [
      {
        type: "Service",
        properties: {
          name: "auth",
          port: 8080,
          enabled: true,
          notes: null,
        },
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it("errors on edge property with nested object", () => {
    const result = validateProposal(
      emptyGraph(),
      [{ type: "Service", properties: { name: "a" } }],
      [
        {
          type: "DEPENDS_ON",
          source: 0,
          target: 0,
          properties: { config: { x: 1 } },
        },
      ],
    );
    expect(result.errors.some((e) => e.kind === "invalid_property_shape")).toBe(true);
  });
});

describe("validateProposal — counts and ok flag", () => {
  it("counts new nodes and edges", () => {
    const result = validateProposal(
      emptyGraph(),
      [
        { type: "A", properties: { name: "a" } },
        { type: "B", properties: { name: "b" } },
        { type: "C", properties: { name: "c" } },
      ],
      [
        { type: "X", source: 0, target: 1 },
        { type: "X", source: 1, target: 2 },
      ],
    );
    expect(result.newNodeCount).toBe(3);
    expect(result.newEdgeCount).toBe(2);
  });

  it("ok=false when there are errors", () => {
    const result = validateProposal(
      emptyGraph(),
      [],
      [{ type: "X", source: 99, target: 99 }],
    );
    expect(result.ok).toBe(false);
  });

  it("ok=true with only warnings", () => {
    const graph = graphWith([makeNode("n1", "Service", { name: "auth" })]);
    const result = validateProposal(graph, [
      { type: "Service", properties: { name: "auth" } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
