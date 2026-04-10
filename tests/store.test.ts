import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { JsonFileBackend } from "../src/storage/json-file-backend.js";

describe("JsonFileBackend", () => {
  let tmpDir: string;
  let store: JsonFileBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "backpack-test-"));
    store = new JsonFileBackend(tmpDir);
    await store.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it("initializes the directory structure", async () => {
    const graphsDir = path.join(tmpDir, "graphs");
    const stat = await fs.stat(graphsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("creates an ontology", async () => {
    const data = await store.createOntology("test", "A test ontology");

    expect(data.metadata.name).toBe("test");
    expect(data.metadata.description).toBe("A test ontology");
    expect(data.nodes).toEqual([]);
    expect(data.edges).toEqual([]);
  });

  it("throws when creating duplicate ontology", async () => {
    await store.createOntology("test", "First");
    await expect(store.createOntology("test", "Second")).rejects.toThrow(
      "already exists"
    );
  });

  it("checks if ontology exists", async () => {
    expect(await store.ontologyExists("nope")).toBe(false);
    await store.createOntology("test", "Test");
    expect(await store.ontologyExists("test")).toBe(true);
  });

  it("loads an ontology", async () => {
    await store.createOntology("test", "A test");
    const loaded = await store.loadOntology("test");

    expect(loaded.metadata.name).toBe("test");
  });

  it("throws when loading nonexistent ontology", async () => {
    await expect(store.loadOntology("nope")).rejects.toThrow("not found");
  });

  it("saves and reloads ontology data", async () => {
    const data = await store.createOntology("test", "Test");
    data.nodes.push({
      id: "n_123",
      type: "Item",
      properties: { name: "hello" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.saveOntology("test", data);

    const reloaded = await store.loadOntology("test");
    expect(reloaded.nodes.length).toBe(1);
    expect(reloaded.nodes[0].properties.name).toBe("hello");
  });

  it("lists ontologies with summaries", async () => {
    await store.createOntology("cooking", "Recipes and ingredients");
    await store.createOntology("code", "Codebase architecture");

    const list = await store.listOntologies();
    expect(list.length).toBe(2);

    const names = list.map((o) => o.name);
    expect(names).toContain("cooking");
    expect(names).toContain("code");
  });

  it("deletes an ontology", async () => {
    await store.createOntology("temp", "Temporary");
    expect(await store.ontologyExists("temp")).toBe(true);

    await store.deleteOntology("temp");
    expect(await store.ontologyExists("temp")).toBe(false);
  });

  it("throws when deleting nonexistent ontology", async () => {
    await expect(store.deleteOntology("nope")).rejects.toThrow("not found");
  });

  it("creates and lists branches", async () => {
    await store.createOntology("test", "Test");
    await store.createBranch("test", "experiment");

    const branches = await store.listBranches("test");
    expect(branches.length).toBe(2);
    expect(branches.find((b: any) => b.name === "main")?.active).toBe(true);
    expect(branches.find((b: any) => b.name === "experiment")?.active).toBe(false);
  });

  it("switches branches", async () => {
    await store.createOntology("test", "Test");
    await store.createBranch("test", "v2");
    await store.switchBranch("test", "v2");

    const branches = await store.listBranches("test");
    expect(branches.find((b: any) => b.name === "v2")?.active).toBe(true);
    expect(branches.find((b: any) => b.name === "main")?.active).toBe(false);
  });

  it("deletes non-active branch", async () => {
    await store.createOntology("test", "Test");
    await store.createBranch("test", "temp");
    await store.deleteBranch("test", "temp");

    const branches = await store.listBranches("test");
    expect(branches.length).toBe(1);
  });

  it("refuses to delete active branch", async () => {
    await store.createOntology("test", "Test");
    await expect(store.deleteBranch("test", "main")).rejects.toThrow("active");
  });

  it("creates and lists snapshots", async () => {
    await store.createOntology("test", "Test");
    const v1 = await store.createSnapshot("test", "initial");
    expect(v1).toBe(1);

    const v2 = await store.createSnapshot("test");
    expect(v2).toBe(2);

    const list = await store.listSnapshots("test");
    expect(list.length).toBe(2);
    expect(list[0].version).toBe(2);
    expect(list[1].version).toBe(1);
    expect(list[1].label).toBe("initial");
  });

  it("rolls back to a snapshot", async () => {
    const data = await store.createOntology("test", "Test");
    await store.createSnapshot("test", "empty");

    data.nodes.push({
      id: "n_1", type: "Item", properties: { name: "hello" },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await store.saveOntology("test", data);

    const before = await store.loadOntology("test");
    expect(before.nodes.length).toBe(1);

    await store.rollback("test", 1);
    const after = await store.loadOntology("test");
    expect(after.nodes.length).toBe(0);
  });

  it("writes a snapshot.json file under branches/main/", async () => {
    await store.createOntology("test", "Test");
    const snapPath = path.join(
      tmpDir,
      "graphs",
      "test",
      "branches",
      "main",
      "snapshot.json",
    );
    const raw = await fs.readFile(snapPath, "utf-8");
    // Pretty-printed JSON has newlines
    expect(raw).toContain("\n");
    // And it's valid JSON
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("writes an empty events.jsonl file under branches/main/", async () => {
    await store.createOntology("test", "Test");
    const eventsPath = path.join(
      tmpDir,
      "graphs",
      "test",
      "branches",
      "main",
      "events.jsonl",
    );
    const stat = await fs.stat(eventsPath);
    expect(stat.isFile()).toBe(true);
  });
});
