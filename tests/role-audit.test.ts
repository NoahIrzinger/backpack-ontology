import { describe, it, expect } from "vitest";
import { auditRoles } from "../src/core/role-audit.js";
import type { Node } from "../src/core/types.js";

function makeNode(id: string, type: string, properties: Record<string, unknown>): Node {
  return {
    id,
    type,
    properties,
    createdAt: "2026-04-10T00:00:00Z",
    updatedAt: "2026-04-10T00:00:00Z",
  };
}

describe("auditRoles — clean nodes (should not flag)", () => {
  it("does not flag a typical entity node", () => {
    const result = auditRoles([
      makeNode("n1", "Service", {
        name: "Auth Service",
        owner: "platform-team",
        language: "Go",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(0);
    expect(result.briefingCandidates).toHaveLength(0);
    expect(result.summary.cleanCount).toBe(1);
  });

  it("does not flag a person node", () => {
    const result = auditRoles([
      makeNode("n1", "Person", {
        name: "Alice",
        role: "Tech Lead",
        team: "Platform",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(0);
    expect(result.briefingCandidates).toHaveLength(0);
  });

  it("does not flag a concept node with descriptive prose", () => {
    const result = auditRoles([
      makeNode("n1", "Concept", {
        label: "RLHF",
        description:
          "Reinforcement Learning from Human Feedback. A training method that uses human preferences to fine-tune language models.",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(0);
    expect(result.briefingCandidates).toHaveLength(0);
  });

  it("does not flag descriptive content with a single imperative verb", () => {
    // A single 'run' or 'configure' isn't enough — could be a fact about
    // something, not a procedure
    const result = auditRoles([
      makeNode("n1", "Tool", {
        name: "kubectl",
        description: "Used to run commands against a Kubernetes cluster.",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(0);
  });
});

describe("auditRoles — procedural detection", () => {
  it("flags a node with type 'Step'", () => {
    const result = auditRoles([
      makeNode("n1", "Step", { label: "Compile the code" }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
    expect(result.proceduralCandidates[0].reason).toMatch(/type "Step"/);
  });

  it("flags a node with type 'Procedure'", () => {
    const result = auditRoles([
      makeNode("n1", "Procedure", { name: "deploy to staging" }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
  });

  it("flags a node with type 'Workflow'", () => {
    const result = auditRoles([
      makeNode("n1", "Workflow", { name: "PR review" }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
  });

  it("flags a node with type 'runbook'", () => {
    const result = auditRoles([makeNode("n1", "runbook", { name: "incident response" })]);
    expect(result.proceduralCandidates).toHaveLength(1);
  });

  it("flags a node with multiple sequential property keys", () => {
    const result = auditRoles([
      makeNode("n1", "Process", {
        step1: "Open a terminal",
        step2: "Navigate to the repo",
        step3: "Run make test",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
    // Detection by type happens first; reason should mention type or sequence
    expect(result.proceduralCandidates[0].reason.length).toBeGreaterThan(0);
  });

  it("flags a node with 'first ... then ...' phrasing", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "First initialize the database, then start the worker pool.",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
  });

  it("flags a node with explicit step markers in property values", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "Step 1: Build the binary. Step 2: Push the image. Step 3: Roll out.",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
  });

  it("flags a node with multiple imperative-verb sentence starts", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "Configure the firewall. Install the agent. Start the service.",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(1);
    expect(result.proceduralCandidates[0].reason).toMatch(/imperative/);
  });

  it("includes a suggestion to move to a skill", () => {
    const result = auditRoles([
      makeNode("n1", "Step", { label: "Compile" }),
    ]);
    expect(result.proceduralCandidates[0].suggestion).toMatch(/skill/);
  });
});

describe("auditRoles — briefing detection", () => {
  it("flags a node with type 'Convention'", () => {
    const result = auditRoles([
      makeNode("n1", "Convention", { name: "use parameterized queries" }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
    expect(result.briefingCandidates[0].reason).toMatch(/type "Convention"/);
  });

  it("flags a node with type 'Configuration'", () => {
    const result = auditRoles([
      makeNode("n1", "Configuration", { key: "DATABASE_URL" }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
  });

  it("flags a 'this project uses' fact", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "This project uses Go on stdlib net/http with no frameworks.",
      }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
    expect(result.briefingCandidates[0].reason).toMatch(/this project/);
  });

  it("flags an 'always use' rule", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "Always use parameterized SQL queries to prevent injection.",
      }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
  });

  it("flags a 'never do' rule", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "Never commit secrets to git. Always use the secrets manager.",
      }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
  });

  it("flags 'we always X' team conventions", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "We always run the test suite before merging.",
      }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
    // Could be matched by either "absolute rule" or "we use" heuristic — both fine
  });

  it("flags 'we prefer X' team conventions specifically via the we-use heuristic", () => {
    const result = auditRoles([
      makeNode("n1", "Note", {
        body: "We prefer parameterized queries throughout the codebase.",
      }),
    ]);
    expect(result.briefingCandidates).toHaveLength(1);
    expect(result.briefingCandidates[0].reason).toMatch(/"we use/);
  });

  it("includes a suggestion to move to CLAUDE.md", () => {
    const result = auditRoles([
      makeNode("n1", "Convention", { name: "x" }),
    ]);
    expect(result.briefingCandidates[0].suggestion).toMatch(/CLAUDE\.md/);
  });
});

describe("auditRoles — summary counts", () => {
  it("returns correct totals for a mixed graph", () => {
    const result = auditRoles([
      makeNode("n1", "Service", { name: "Auth" }),
      makeNode("n2", "Service", { name: "Users" }),
      makeNode("n3", "Step", { label: "Step one" }),
      makeNode("n4", "Convention", { name: "use Go" }),
      makeNode("n5", "Person", { name: "Alice" }),
    ]);
    expect(result.summary.nodesScanned).toBe(5);
    expect(result.summary.proceduralCount).toBe(1);
    expect(result.summary.briefingCount).toBe(1);
    expect(result.summary.cleanCount).toBe(3);
  });

  it("returns zero counts for an empty graph", () => {
    const result = auditRoles([]);
    expect(result.summary.nodesScanned).toBe(0);
    expect(result.summary.cleanCount).toBe(0);
  });
});

describe("auditRoles — false positive guards", () => {
  it("does not flag a single imperative verb in descriptive prose", () => {
    const result = auditRoles([
      makeNode("n1", "Tool", {
        name: "git",
        description: "A version control system you can run locally.",
      }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(0);
  });

  it("does not flag normal type names that happen to contain procedural words", () => {
    // 'Action' alone is too aggressive — these could be domain entities
    const result = auditRoles([
      makeNode("n1", "Service", { name: "Action Cable" }),
    ]);
    expect(result.proceduralCandidates).toHaveLength(0);
    expect(result.briefingCandidates).toHaveLength(0);
  });

  it("does not flag concept nodes whose descriptions mention 'always' as a fact", () => {
    // 'Mitochondria always have a double membrane' is a biological fact, not a convention
    // Our heuristic looks for "always use/do/run/commit/prefer/avoid" — this should pass
    const result = auditRoles([
      makeNode("n1", "Concept", {
        label: "Mitochondria",
        description: "Mitochondria always have a double membrane structure.",
      }),
    ]);
    expect(result.briefingCandidates).toHaveLength(0);
  });
});
