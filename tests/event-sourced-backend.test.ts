import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { EventSourcedBackend } from "../src/storage/event-sourced-backend.js";
import { makeNodeAddEvent, makeEdgeAddEvent, parseEventLog } from "../src/core/events.js";
import type { Node, Edge } from "../src/core/types.js";

function makeNode(id: string, type = "Concept", props: Record<string, unknown> = {}): Node {
  const now = "2026-04-10T00:00:00Z";
  return { id, type, properties: props, createdAt: now, updatedAt: now };
}

function makeEdge(id: string, sourceId: string, targetId: string, type = "RELATES_TO"): Edge {
  const now = "2026-04-10T00:00:00Z";
  return { id, type, sourceId, targetId, properties: {}, createdAt: now, updatedAt: now };
}

describe("EventSourcedBackend — basic CRUD", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates the graphs directory on initialize", async () => {
    const stat = await fs.stat(path.join(tmpDir, "graphs"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns empty list when no graphs exist", async () => {
    expect(await backend.listOntologies()).toEqual([]);
  });

  it("creates an ontology with metadata, events, and snapshot files", async () => {
    await backend.createOntology("test", "A test graph");
    const metaPath = path.join(tmpDir, "graphs", "test", "metadata.json");
    const eventsPath = path.join(tmpDir, "graphs", "test", "branches", "main", "events.jsonl");
    const snapshotPath = path.join(tmpDir, "graphs", "test", "branches", "main", "snapshot.json");
    expect((await fs.stat(metaPath)).isFile()).toBe(true);
    expect((await fs.stat(eventsPath)).isFile()).toBe(true);
    expect((await fs.stat(snapshotPath)).isFile()).toBe(true);
  });

  it("returns the new ontology when listed", async () => {
    await backend.createOntology("test", "A test graph");
    const list = await backend.listOntologies();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("test");
    expect(list[0].nodeCount).toBe(0);
  });

  it("throws on duplicate create", async () => {
    await backend.createOntology("test", "first");
    await expect(backend.createOntology("test", "second")).rejects.toThrow(
      /already exists/,
    );
  });

  it("ontologyExists returns true after create", async () => {
    expect(await backend.ontologyExists("test")).toBe(false);
    await backend.createOntology("test", "");
    expect(await backend.ontologyExists("test")).toBe(true);
  });

  it("loadOntology returns empty initial state", async () => {
    await backend.createOntology("test", "desc");
    const data = await backend.loadOntology("test");
    expect(data.metadata.name).toBe("test");
    expect(data.metadata.description).toBe("desc");
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it("deleteOntology removes the directory", async () => {
    await backend.createOntology("test", "");
    await backend.deleteOntology("test");
    expect(await backend.ontologyExists("test")).toBe(false);
  });

  it("renameOntology moves the directory and updates metadata", async () => {
    await backend.createOntology("old-name", "");
    await backend.renameOntology("old-name", "new-name");
    expect(await backend.ontologyExists("old-name")).toBe(false);
    expect(await backend.ontologyExists("new-name")).toBe(true);
    const meta = await backend.loadMetadata("new-name");
    expect(meta.name).toBe("new-name");
  });

  it("renameOntology refuses an existing target", async () => {
    await backend.createOntology("a", "");
    await backend.createOntology("b", "");
    await expect(backend.renameOntology("a", "b")).rejects.toThrow(/already exists/);
  });
});

describe("EventSourcedBackend — saveOntology via diff", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    await backend.createOntology("test", "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits node.add events when saving with new nodes", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1", "Concept", { label: "A" }));
    await backend.saveOntology("test", data);

    // Check the event log
    const eventsRaw = await fs.readFile(
      path.join(tmpDir, "graphs", "test", "branches", "main", "events.jsonl"),
      "utf8",
    );
    const events = parseEventLog(eventsRaw);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe("node.add");
  });

  it("loadOntology returns the saved state", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1", "Concept", { label: "A" }));
    data.nodes.push(makeNode("n2", "Concept", { label: "B" }));
    data.edges.push(makeEdge("e1", "n1", "n2"));
    await backend.saveOntology("test", data);

    const reloaded = await backend.loadOntology("test");
    expect(reloaded.nodes).toHaveLength(2);
    expect(reloaded.edges).toHaveLength(1);
  });

  it("multiple saves accumulate events incrementally", async () => {
    let data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    await backend.saveOntology("test", data);

    data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n2"));
    await backend.saveOntology("test", data);

    const eventsRaw = await fs.readFile(
      path.join(tmpDir, "graphs", "test", "branches", "main", "events.jsonl"),
      "utf8",
    );
    const events = parseEventLog(eventsRaw);
    expect(events).toHaveLength(2);
  });

  it("snapshot.json stays in sync with the event log", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    data.nodes.push(makeNode("n2"));
    await backend.saveOntology("test", data);

    const snapRaw = await fs.readFile(
      path.join(tmpDir, "graphs", "test", "branches", "main", "snapshot.json"),
      "utf8",
    );
    const snap = JSON.parse(snapRaw);
    expect(snap.nodes).toHaveLength(2);
  });

  it("noop saveOntology emits no events", async () => {
    const data = await backend.loadOntology("test");
    await backend.saveOntology("test", data);
    const eventsRaw = await fs.readFile(
      path.join(tmpDir, "graphs", "test", "branches", "main", "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw.trim()).toBe("");
  });
});

describe("EventSourcedBackend — appendEvents (event-native API)", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    await backend.createOntology("test", "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("appends a single event and returns the new version", async () => {
    const event = makeNodeAddEvent(makeNode("n1"));
    const newVersion = await backend.appendEvents("test", "main", [event]);
    expect(newVersion).toBe(1);
  });

  it("optimistic concurrency: succeeds when expectedVersion matches", async () => {
    const event = makeNodeAddEvent(makeNode("n1"));
    await backend.appendEvents("test", "main", [event], 0);
    const event2 = makeNodeAddEvent(makeNode("n2"));
    await expect(
      backend.appendEvents("test", "main", [event2], 1),
    ).resolves.toBeDefined();
  });

  it("optimistic concurrency: fails when expectedVersion mismatches", async () => {
    const event = makeNodeAddEvent(makeNode("n1"));
    await backend.appendEvents("test", "main", [event]);
    const event2 = makeNodeAddEvent(makeNode("n2"));
    await expect(
      backend.appendEvents("test", "main", [event2], 0),
    ).rejects.toThrow(/version conflict/);
  });

  it("appended events appear in loadOntology", async () => {
    const event = makeNodeAddEvent(makeNode("n1", "Concept", { label: "Hello" }));
    await backend.appendEvents("test", "main", [event]);
    const data = await backend.loadOntology("test");
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0].id).toBe("n1");
  });
});

describe("EventSourcedBackend — branches", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    await backend.createOntology("test", "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("listBranches returns just main initially", async () => {
    const branches = await backend.listBranches("test");
    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe("main");
    expect(branches[0].active).toBe(true);
  });

  it("createBranch forks from the active branch", async () => {
    // Add a node to main first
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    await backend.saveOntology("test", data);

    await backend.createBranch("test", "experiment");
    const branches = await backend.listBranches("test");
    expect(branches).toHaveLength(2);

    // The forked branch should have the same node
    const expState = await backend.loadBranch("test", "experiment");
    expect(expState.nodes).toHaveLength(1);
  });

  it("switchBranch changes the active branch", async () => {
    await backend.createBranch("test", "experiment");
    await backend.switchBranch("test", "experiment");
    const branches = await backend.listBranches("test");
    expect(branches.find((b) => b.name === "experiment")?.active).toBe(true);
    expect(branches.find((b) => b.name === "main")?.active).toBe(false);
  });

  it("switchBranch refuses unknown branch", async () => {
    await expect(backend.switchBranch("test", "missing")).rejects.toThrow(/does not exist/);
  });

  it("deleteBranch removes a non-active branch", async () => {
    await backend.createBranch("test", "experiment");
    await backend.deleteBranch("test", "experiment");
    const branches = await backend.listBranches("test");
    expect(branches).toHaveLength(1);
  });

  it("deleteBranch refuses the active branch", async () => {
    await backend.createBranch("test", "experiment");
    await backend.switchBranch("test", "experiment");
    await expect(backend.deleteBranch("test", "experiment")).rejects.toThrow(
      /Cannot delete the active/,
    );
  });

  it("deleteBranch refuses main", async () => {
    await expect(backend.deleteBranch("test", "main")).rejects.toThrow(/Cannot delete/);
  });
});

describe("EventSourcedBackend — snapshots as labeled events", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    await backend.createOntology("test", "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("createSnapshot returns a version number", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    await backend.saveOntology("test", data);
    const version = await backend.createSnapshot("test", "v1");
    expect(version).toBe(2); // 1 node.add + 1 snapshot.label
  });

  it("listSnapshots returns labeled snapshots", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    await backend.saveOntology("test", data);
    await backend.createSnapshot("test", "first");

    data.nodes.push(makeNode("n2"));
    await backend.saveOntology("test", data);
    await backend.createSnapshot("test", "second");

    const snapshots = await backend.listSnapshots("test");
    expect(snapshots).toHaveLength(2);
    // Most recent first
    expect(snapshots[0].label).toBe("second");
    expect(snapshots[0].nodeCount).toBe(2);
    expect(snapshots[1].label).toBe("first");
    expect(snapshots[1].nodeCount).toBe(1);
  });

  it("rollback truncates the event log", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    await backend.saveOntology("test", data);
    const version = await backend.createSnapshot("test", "checkpoint");

    data.nodes.push(makeNode("n2"));
    await backend.saveOntology("test", data);

    expect((await backend.loadOntology("test")).nodes).toHaveLength(2);

    await backend.rollback("test", version);

    const after = await backend.loadOntology("test");
    expect(after.nodes).toHaveLength(1);
    expect(after.nodes[0].id).toBe("n1");
  });
});

describe("EventSourcedBackend — snapshot recovery", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    await backend.createOntology("test", "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rebuilds snapshot.json from events when missing", async () => {
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    data.nodes.push(makeNode("n2"));
    await backend.saveOntology("test", data);

    // Delete the snapshot file to simulate corruption
    const snapPath = path.join(tmpDir, "graphs", "test", "branches", "main", "snapshot.json");
    await fs.unlink(snapPath);

    const reloaded = await backend.loadOntology("test");
    expect(reloaded.nodes).toHaveLength(2);

    // Snapshot file should have been rebuilt
    const stat = await fs.stat(snapPath);
    expect(stat.isFile()).toBe(true);
  });
});

describe("EventSourcedBackend — snippets (orthogonal)", () => {
  let tmpDir: string;
  let backend: EventSourcedBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "esb-test-"));
    backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    await backend.createOntology("test", "");
    const data = await backend.loadOntology("test");
    data.nodes.push(makeNode("n1"));
    data.nodes.push(makeNode("n2"));
    data.edges.push(makeEdge("e1", "n1", "n2"));
    await backend.saveOntology("test", data);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves a snippet and lists it", async () => {
    await backend.saveSnippet("test", {
      label: "first snippet",
      nodeIds: ["n1", "n2"],
      edgeIds: ["e1"],
    });
    const snippets = await backend.listSnippets("test");
    expect(snippets).toHaveLength(1);
    expect(snippets[0].nodeCount).toBe(2);
  });

  it("loads a snippet by id", async () => {
    const id = await backend.saveSnippet("test", {
      label: "test snip",
      nodeIds: ["n1"],
      edgeIds: [],
    });
    const loaded = await backend.loadSnippet("test", id);
    expect(loaded.nodes).toHaveLength(1);
  });

  it("deletes a snippet", async () => {
    const id = await backend.saveSnippet("test", {
      label: "to delete",
      nodeIds: ["n1"],
      edgeIds: [],
    });
    await backend.deleteSnippet("test", id);
    const snippets = await backend.listSnippets("test");
    expect(snippets).toHaveLength(0);
  });
});
