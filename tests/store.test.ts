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
    const ontologiesDir = path.join(tmpDir, "ontologies");
    const stat = await fs.stat(ontologiesDir);
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

  it("writes JSON that is human-readable (pretty-printed)", async () => {
    await store.createOntology("test", "Test");
    const filePath = path.join(tmpDir, "ontologies", "test", "ontology.json");
    const raw = await fs.readFile(filePath, "utf-8");

    // Pretty-printed JSON has newlines
    expect(raw).toContain("\n");
    // And it's valid JSON
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
