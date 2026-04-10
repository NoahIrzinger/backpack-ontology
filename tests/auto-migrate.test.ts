import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventSourcedBackend } from "../src/storage/event-sourced-backend.js";

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-automigrate-"));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

async function seedLegacyGraph(
  baseDir: string,
  name: string,
  data: { nodes: any[]; edges: any[]; metadata?: any },
  activeBranch = "main",
): Promise<void> {
  const graphDir = path.join(baseDir, "graphs", name);
  const branchesDir = path.join(graphDir, "branches");
  await fs.mkdir(branchesDir, { recursive: true });
  await fs.writeFile(
    path.join(graphDir, "meta.json"),
    JSON.stringify({ activeBranch, snapshotLimit: 20 }),
  );
  const branchData = {
    metadata: data.metadata ?? {
      name,
      description: "legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    nodes: data.nodes,
    edges: data.edges,
  };
  await fs.writeFile(
    path.join(branchesDir, `${activeBranch}.json`),
    JSON.stringify(branchData),
  );
}

describe("auto-migration on initialize()", () => {
  it("converts a single legacy graph seamlessly", async () => {
    await seedLegacyGraph(testDir, "g1", {
      nodes: [
        { id: "n1", type: "Service", properties: { name: "auth" }, createdAt: "", updatedAt: "" },
        { id: "n2", type: "Service", properties: { name: "users" }, createdAt: "", updatedAt: "" },
      ],
      edges: [
        {
          id: "e1",
          type: "DEPENDS_ON",
          sourceId: "n1",
          targetId: "n2",
          properties: {},
          createdAt: "",
          updatedAt: "",
        },
      ],
    });

    const backend = new EventSourcedBackend(testDir);
    await backend.initialize();

    const list = await backend.listOntologies();
    expect(list).toHaveLength(1);
    expect(list[0].nodeCount).toBe(2);
    expect(list[0].edgeCount).toBe(1);

    const data = await backend.loadOntology("g1");
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].sourceId).toBe("n1");

    // The legacy files should be gone, the new layout should be in place
    const oldMeta = path.join(testDir, "graphs", "g1", "meta.json");
    const oldBranch = path.join(testDir, "graphs", "g1", "branches", "main.json");
    const newMeta = path.join(testDir, "graphs", "g1", "metadata.json");
    const eventsLog = path.join(testDir, "graphs", "g1", "branches", "main", "events.jsonl");
    await expect(fs.access(oldMeta)).rejects.toThrow();
    await expect(fs.access(oldBranch)).rejects.toThrow();
    await expect(fs.access(newMeta)).resolves.toBeUndefined();
    await expect(fs.access(eventsLog)).resolves.toBeUndefined();
  });

  it("converts multiple branches", async () => {
    const graphDir = path.join(testDir, "graphs", "g2");
    const branchesDir = path.join(graphDir, "branches");
    await fs.mkdir(branchesDir, { recursive: true });
    await fs.writeFile(
      path.join(graphDir, "meta.json"),
      JSON.stringify({ activeBranch: "main" }),
    );
    const branchPayload = {
      metadata: { name: "g2", description: "" },
      nodes: [
        { id: "n1", type: "T", properties: {}, createdAt: "", updatedAt: "" },
      ],
      edges: [],
    };
    await fs.writeFile(
      path.join(branchesDir, "main.json"),
      JSON.stringify(branchPayload),
    );
    await fs.writeFile(
      path.join(branchesDir, "experiment.json"),
      JSON.stringify(branchPayload),
    );

    const backend = new EventSourcedBackend(testDir);
    await backend.initialize();

    const branches = await backend.listBranches("g2");
    expect(branches.map((b) => b.name).sort()).toEqual(["experiment", "main"]);
  });

  it("is idempotent on re-init", async () => {
    await seedLegacyGraph(testDir, "g3", {
      nodes: [{ id: "n1", type: "T", properties: {}, createdAt: "", updatedAt: "" }],
      edges: [],
    });
    const backend1 = new EventSourcedBackend(testDir);
    await backend1.initialize();
    const before = await backend1.loadOntology("g3");

    // Second initialize should not double-convert or break anything
    const backend2 = new EventSourcedBackend(testDir);
    await backend2.initialize();
    const after = await backend2.loadOntology("g3");

    expect(after.nodes.length).toBe(before.nodes.length);
    expect(after.nodes[0].id).toBe("n1");
  });

  it("leaves already-new-format graphs untouched", async () => {
    const backend = new EventSourcedBackend(testDir);
    await backend.initialize();
    await backend.createOntology("native", "no migration needed");

    const backend2 = new EventSourcedBackend(testDir);
    await backend2.initialize();
    const list = await backend2.listOntologies();
    expect(list.find((g) => g.name === "native")).toBeDefined();
  });

  it("does not crash when graphs dir is empty", async () => {
    const backend = new EventSourcedBackend(testDir);
    await expect(backend.initialize()).resolves.toBeUndefined();
    const list = await backend.listOntologies();
    expect(list).toHaveLength(0);
  });

  it("two concurrent backends do not corrupt the same legacy graph", async () => {
    await seedLegacyGraph(testDir, "shared", {
      nodes: [
        { id: "n1", type: "T", properties: { name: "a" }, createdAt: "", updatedAt: "" },
        { id: "n2", type: "T", properties: { name: "b" }, createdAt: "", updatedAt: "" },
      ],
      edges: [
        { id: "e1", type: "R", sourceId: "n1", targetId: "n2", properties: {}, createdAt: "", updatedAt: "" },
      ],
    });
    const a = new EventSourcedBackend(testDir);
    const b = new EventSourcedBackend(testDir);
    // Run both initialize() in parallel
    await Promise.all([a.initialize(), b.initialize()]);
    // The graph should be loadable from either, with both nodes + edge intact
    const data = await a.loadOntology("shared");
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].sourceId).toBe("n1");
  });

  it("ignores hidden directories and dotfiles in the graphs dir", async () => {
    await fs.mkdir(path.join(testDir, "graphs", ".DS_Store"), { recursive: true });
    await seedLegacyGraph(testDir, "real", {
      nodes: [{ id: "n1", type: "T", properties: {}, createdAt: "", updatedAt: "" }],
      edges: [],
    });
    const backend = new EventSourcedBackend(testDir);
    await backend.initialize();
    const list = await backend.listOntologies();
    expect(list.find((g) => g.name === "real")).toBeDefined();
    expect(list.find((g) => g.name === ".DS_Store")).toBeUndefined();
  });
});
