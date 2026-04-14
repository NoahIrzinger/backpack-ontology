import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { DocumentStore, parseWikilinks, type KBMount } from "../src/core/document-store.js";

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-kb-test-"));
  return dir;
}

beforeEach(async () => {
  tmpDir = await makeTmpDir();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function mount(name: string, subdir: string, writable = true): KBMount {
  return { name, path: path.join(tmpDir, subdir), writable };
}

describe("DocumentStore — single mount", () => {
  it("saves and reads a document", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    const saved = await store.save({
      title: "SUV Comparison",
      content: "The best crossover for mom is...",
      tags: ["cars", "research"],
      sourceGraphs: ["crossover-suvs"],
      sourceNodeIds: ["n1", "n2"],
    });

    expect(saved.id).toBe("suv-comparison");
    expect(saved.title).toBe("SUV Comparison");
    expect(saved.tags).toEqual(["cars", "research"]);
    expect(saved.sourceGraphs).toEqual(["crossover-suvs"]);
    expect(saved.collection).toBe("private");
    expect(saved.content).toBe("The best crossover for mom is...");

    const read = await store.read("suv-comparison");
    expect(read.id).toBe("suv-comparison");
    expect(read.title).toBe("SUV Comparison");
    expect(read.content).toBe("The best crossover for mom is...");
    expect(read.tags).toEqual(["cars", "research"]);
  });

  it("generates unique ids on collision", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    const first = await store.save({ title: "Test Doc", content: "first" });
    const second = await store.save({ title: "Test Doc", content: "second" });

    expect(first.id).toBe("test-doc");
    expect(second.id).toBe("test-doc-2");
  });

  it("updates a document by id", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    const saved = await store.save({ title: "Original", content: "v1" });

    // Ensure timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const updated = await store.save({
      id: saved.id,
      title: "Updated Title",
      content: "v2",
    });

    expect(updated.id).toBe(saved.id);
    expect(updated.title).toBe("Updated Title");
    expect(updated.content).toBe("v2");
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.updatedAt).not.toBe(saved.updatedAt);
  });

  it("rejects path traversal in document ids", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await expect(store.read("../../etc/passwd")).rejects.toThrow("Invalid document id");
    await expect(store.delete("../escape")).rejects.toThrow("Invalid document id");
    await expect(
      store.save({ id: "../../etc/evil", title: "Evil", content: "bad" }),
    ).rejects.toThrow("Invalid document id");
  });

  it("round-trips titles with YAML-special characters", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    const saved = await store.save({
      title: 'What: "the best" SUV?',
      content: "Content here.",
      tags: ["tag: with colon"],
    });

    const read = await store.read(saved.id);
    expect(read.title).toBe('What: "the best" SUV?');
    expect(read.tags).toEqual(["tag: with colon"]);
  });

  it("handles slugification of special characters", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    const saved = await store.save({
      title: "What's the Best  SUV for $30k???",
      content: "...",
    });
    expect(saved.id).toBe("what-s-the-best-suv-for-30k");
  });

  it("lists documents", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "Doc A", content: "aaa" });
    await store.save({ title: "Doc B", content: "bbb" });

    const result = await store.list();
    expect(result.documents).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);
    expect(result.documents.map((d) => d.title)).toContain("Doc A");
    expect(result.documents.map((d) => d.title)).toContain("Doc B");
  });

  it("paginates list results", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "A", content: "1" });
    await store.save({ title: "B", content: "2" });
    await store.save({ title: "C", content: "3" });

    const page1 = await store.list({ limit: 2 });
    expect(page1.documents).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await store.list({ limit: 2, offset: 2 });
    expect(page2.documents).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it("deletes a document", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "Doomed", content: "bye" });

    await store.delete("doomed");
    const result = await store.list();
    expect(result.documents).toHaveLength(0);
  });

  it("searches by content", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "Apples", content: "Red delicious are great" });
    await store.save({ title: "Oranges", content: "Valencia is the best" });

    const results = await store.search("delicious");
    expect(results.documents).toHaveLength(1);
    expect(results.documents[0].title).toBe("Apples");
  });

  it("searches by title", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "Architecture Overview", content: "..." });
    await store.save({ title: "Meeting Notes", content: "..." });

    const results = await store.search("architecture");
    expect(results.documents).toHaveLength(1);
    expect(results.documents[0].title).toBe("Architecture Overview");
  });

  it("paginates search results", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "Match A", content: "keyword here" });
    await store.save({ title: "Match B", content: "keyword there" });
    await store.save({ title: "No match", content: "nothing" });

    const result = await store.search("keyword", { limit: 1 });
    expect(result.documents).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it("returns empty list for missing directory", async () => {
    const store = new DocumentStore([
      { name: "ghost", path: path.join(tmpDir, "nonexistent"), writable: true },
    ]);
    const result = await store.list();
    expect(result.documents).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("reads files without frontmatter gracefully", async () => {
    const docsDir = path.join(tmpDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "plain-note.md"),
      "Just some plain markdown content.\n",
    );

    const store = new DocumentStore([{ name: "private", path: docsDir, writable: true }]);
    const result = await store.list();
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].id).toBe("plain-note");
    expect(result.documents[0].title).toBe("plain-note");
    expect(result.documents[0].tags).toEqual([]);

    const doc = await store.read("plain-note");
    expect(doc.content).toBe("Just some plain markdown content.\n");
  });

  it("lists mounts with doc counts", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({ title: "One", content: "1" });
    await store.save({ title: "Two", content: "2" });

    const mounts = await store.listMounts();
    expect(mounts).toHaveLength(1);
    expect(mounts[0].name).toBe("private");
    expect(mounts[0].docCount).toBe(2);
  });
});

describe("DocumentStore — recursive directory scanning", () => {
  it("finds documents in subdirectories", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const subDir = path.join(docsDir, "subfolder", "deep");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, "top-level.md"), "---\nid: top-level\ntitle: Top Level\n---\nContent\n");
    await fs.writeFile(path.join(subDir, "nested.md"), "---\nid: nested\ntitle: Nested Doc\n---\nDeep content\n");

    const store = new DocumentStore([{ name: "private", path: docsDir, writable: true }]);

    const result = await store.list();
    expect(result.total).toBe(2);
    expect(result.documents.map((d) => d.id)).toContain("top-level");
    expect(result.documents.map((d) => d.id)).toContain("nested");
  });

  it("finds nested documents by id", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const subDir = path.join(docsDir, "sub");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, "deep-doc.md"), "---\nid: deep-doc\ntitle: Deep\n---\nContent\n");

    const store = new DocumentStore([{ name: "private", path: docsDir, writable: true }]);
    const doc = await store.read("deep-doc");
    expect(doc.title).toBe("Deep");
    expect(doc.content).toBe("Content\n");
  });

  it("skips hidden directories", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const hiddenDir = path.join(docsDir, ".hidden");
    await fs.mkdir(hiddenDir, { recursive: true });
    await fs.writeFile(path.join(hiddenDir, "secret.md"), "---\nid: secret\ntitle: Secret\n---\n");
    await fs.writeFile(path.join(docsDir, "visible.md"), "---\nid: visible\ntitle: Visible\n---\n");

    const store = new DocumentStore([{ name: "private", path: docsDir, writable: true }]);
    const result = await store.list();
    expect(result.total).toBe(1);
    expect(result.documents[0].id).toBe("visible");
  });

  it("searches across subdirectories", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const subDir = path.join(docsDir, "research");
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, "top.md"), "---\ntitle: Top\n---\nNo match here\n");
    await fs.writeFile(path.join(subDir, "deep.md"), "---\ntitle: Deep\n---\nThis has the keyword\n");

    const store = new DocumentStore([{ name: "private", path: docsDir, writable: true }]);
    const result = await store.search("keyword");
    expect(result.total).toBe(1);
    expect(result.documents[0].title).toBe("Deep");
  });
});

describe("DocumentStore — multi-mount", () => {
  it("aggregates list across mounts", async () => {
    const store = new DocumentStore([
      mount("private", "private-docs"),
      mount("team", "team-docs"),
    ]);

    await store.save({ title: "My Doc", content: "private", collection: "private" });
    await store.save({ title: "Team Doc", content: "shared", collection: "team" });

    const all = await store.list();
    expect(all.documents).toHaveLength(2);

    const privateOnly = await store.list({ collection: "private" });
    expect(privateOnly.documents).toHaveLength(1);
    expect(privateOnly.documents[0].title).toBe("My Doc");

    const teamOnly = await store.list({ collection: "team" });
    expect(teamOnly.documents).toHaveLength(1);
    expect(teamOnly.documents[0].title).toBe("Team Doc");
  });

  it("saves to specified collection", async () => {
    const store = new DocumentStore([
      mount("private", "private-docs"),
      mount("team", "team-docs"),
    ]);

    const doc = await store.save({
      title: "Team Report",
      content: "...",
      collection: "team",
    });
    expect(doc.collection).toBe("team");

    // File should be in team dir
    const filePath = path.join(tmpDir, "team-docs", "team-report.md");
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it("reads a doc from any mount", async () => {
    const store = new DocumentStore([
      mount("private", "private-docs"),
      mount("team", "team-docs"),
    ]);

    await store.save({ title: "In Team", content: "team content", collection: "team" });
    const doc = await store.read("in-team");
    expect(doc.content).toBe("team content");
    expect(doc.collection).toBe("team");
  });

  it("searches across mounts", async () => {
    const store = new DocumentStore([
      mount("private", "private-docs"),
      mount("team", "team-docs"),
    ]);

    await store.save({ title: "Private Analysis", content: "deep dive vendor", collection: "private" });
    await store.save({ title: "Team Analysis", content: "deep dive vendor", collection: "team" });

    const results = await store.search("vendor");
    expect(results.documents).toHaveLength(2);

    const teamResults = await store.search("vendor", { collection: "team" });
    expect(teamResults.documents).toHaveLength(1);
    expect(teamResults.documents[0].collection).toBe("team");
  });
});

describe("DocumentStore — read-only mount", () => {
  it("throws on save to read-only mount", async () => {
    const store = new DocumentStore([
      mount("readonly", "ro-docs", false),
    ]);

    await expect(
      store.save({ title: "Nope", content: "...", collection: "readonly" }),
    ).rejects.toThrow("read-only");
  });

  it("throws on delete from read-only mount", async () => {
    const roDir = path.join(tmpDir, "ro-docs");
    await fs.mkdir(roDir, { recursive: true });
    await fs.writeFile(path.join(roDir, "existing.md"), "---\nid: existing\ntitle: Existing\n---\nContent\n");

    const store = new DocumentStore([
      { name: "readonly", path: roDir, writable: false },
    ]);

    await expect(store.delete("existing")).rejects.toThrow("read-only");
  });

  it("reads from read-only mount", async () => {
    const roDir = path.join(tmpDir, "ro-docs");
    await fs.mkdir(roDir, { recursive: true });
    await fs.writeFile(
      path.join(roDir, "shared-doc.md"),
      "---\nid: shared-doc\ntitle: Shared Document\ntags:\n  - shared\n---\nShared content here.\n",
    );

    const store = new DocumentStore([
      { name: "readonly", path: roDir, writable: false },
    ]);

    const doc = await store.read("shared-doc");
    expect(doc.title).toBe("Shared Document");
    expect(doc.content).toBe("Shared content here.\n");
    expect(doc.tags).toEqual(["shared"]);
  });
});

describe("DocumentStore — ingest", () => {
  it("ingests by id", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({
      title: "Report",
      content: "Analysis of the thing.",
      sourceGraphs: ["my-graph"],
    });

    const result = await store.ingest({ id: "report" });
    expect(result.title).toBe("Report");
    expect(result.content).toBe("Analysis of the thing.");
    expect(result.sourceGraphs).toEqual(["my-graph"]);
    expect(result.wikilinks).toEqual([]);
  });

  it("ingests by arbitrary file path", async () => {
    const filePath = path.join(tmpDir, "external.md");
    await fs.writeFile(filePath, "---\ntitle: External Note\n---\nExternal content.\n");

    const store = new DocumentStore([mount("private", "docs")]);
    const result = await store.ingest({ path: filePath });
    expect(result.title).toBe("External Note");
    expect(result.content).toBe("External content.\n");
  });

  it("ingests plain markdown file by path", async () => {
    const filePath = path.join(tmpDir, "plain.md");
    await fs.writeFile(filePath, "No frontmatter here.\n");

    const store = new DocumentStore([mount("private", "docs")]);
    const result = await store.ingest({ path: filePath });
    expect(result.title).toBe("plain");
    expect(result.content).toBe("No frontmatter here.\n");
  });

  it("extracts wikilinks from ingested content", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await store.save({
      title: "Linked Doc",
      content: "See [[Architecture Overview]] and [[Meeting Notes|notes]] for context. Also [[Architecture Overview]] again.",
    });

    const result = await store.ingest({ id: "linked-doc" });
    expect(result.wikilinks).toHaveLength(2);
    expect(result.wikilinks[0]).toEqual({ target: "Architecture Overview", display: null });
    expect(result.wikilinks[1]).toEqual({ target: "Meeting Notes", display: "notes" });
  });

  it("throws if neither id nor path provided", async () => {
    const store = new DocumentStore([mount("private", "docs")]);
    await expect(store.ingest({})).rejects.toThrow("Either id or path");
  });
});

describe("parseWikilinks", () => {
  it("parses simple wikilinks", () => {
    const refs = parseWikilinks("See [[Foo]] and [[Bar]]");
    expect(refs).toEqual([
      { target: "Foo", display: null },
      { target: "Bar", display: null },
    ]);
  });

  it("parses display-text wikilinks", () => {
    const refs = parseWikilinks("See [[Foo|custom label]]");
    expect(refs).toEqual([{ target: "Foo", display: "custom label" }]);
  });

  it("deduplicates by target", () => {
    const refs = parseWikilinks("[[A]] and [[A]] again");
    expect(refs).toHaveLength(1);
  });

  it("returns empty for no wikilinks", () => {
    const refs = parseWikilinks("No links here.");
    expect(refs).toEqual([]);
  });
});
