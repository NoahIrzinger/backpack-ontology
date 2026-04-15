// ============================================================
// Knowledge Base document store.
//
// Manages markdown documents with YAML frontmatter across one or
// more named filesystem mounts. Each mount is a directory tree of
// .md files. Mounts can be writable or read-only.
//
// Documents are backpack-level, not graph-level. A document can
// reference multiple graphs via sourceGraphs metadata.
// ============================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";

// --- Types ---

export interface KBMount {
  name: string;
  path: string;
  writable: boolean;
}

export interface KBDocumentMeta {
  id: string;
  title: string;
  tags: string[];
  sourceGraphs: string[];
  sourceNodeIds: string[];
  collection: string;
  createdAt: string;
  updatedAt: string;
}

export interface KBDocument extends KBDocumentMeta {
  content: string;
}

export interface KBDocumentSummary {
  id: string;
  title: string;
  tags: string[];
  sourceGraphs: string[];
  collection: string;
  createdAt: string;
  updatedAt: string;
}

export interface KBListResult {
  documents: KBDocumentSummary[];
  total: number;
  hasMore: boolean;
}

export interface KBMountInfo {
  name: string;
  path: string;
  writable: boolean;
  docCount: number;
  type?: "local" | "cloud" | "extension";
}

/** Reference extracted from an Obsidian [[wikilink]]. */
export interface WikilinkRef {
  target: string;
  display: string | null;
}

// --- Frontmatter helpers ---

/** Quote a YAML scalar if it contains characters that would break parsing. */
function yamlQuote(val: string): string {
  if (/[\n\r:#"'{}[\],&*?|>!%@`]/.test(val) || val.trim() !== val) {
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return val;
}

function serializeFrontmatter(meta: Omit<KBDocumentMeta, "collection">): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${yamlQuote(meta.id)}`);
  lines.push(`title: ${yamlQuote(meta.title)}`);
  if (meta.tags.length > 0) {
    lines.push("tags:");
    for (const t of meta.tags) lines.push(`  - ${yamlQuote(t)}`);
  }
  if (meta.sourceGraphs.length > 0) {
    lines.push("sourceGraphs:");
    for (const g of meta.sourceGraphs) lines.push(`  - ${yamlQuote(g)}`);
  }
  if (meta.sourceNodeIds.length > 0) {
    lines.push("sourceNodeIds:");
    for (const n of meta.sourceNodeIds) lines.push(`  - ${yamlQuote(n)}`);
  }
  lines.push(`createdAt: ${meta.createdAt}`);
  lines.push(`updatedAt: ${meta.updatedAt}`);
  lines.push("---");
  return lines.join("\n");
}

/** Strip surrounding quotes from a YAML scalar value. */
function yamlUnquote(val: string): string {
  const t = val.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return t;
}

function parseFrontmatter(raw: string): { meta: Partial<KBDocumentMeta>; content: string } {
  const trimmed = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"); // strip BOM + normalize line endings
  if (!trimmed.startsWith("---")) {
    return { meta: {}, content: trimmed };
  }
  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { meta: {}, content: trimmed };
  }
  const frontBlock = trimmed.slice(4, endIdx); // skip opening "---\n"
  const content = trimmed.slice(endIdx + 4).replace(/^\n/, ""); // skip closing "---\n"

  const meta: Partial<KBDocumentMeta> = {};
  let currentArray: string[] | null = null;
  let currentKey: string | null = null;

  for (const line of frontBlock.split("\n")) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentArray) {
      currentArray.push(yamlUnquote(listMatch[1]));
      continue;
    }
    // Flush previous array
    if (currentKey && currentArray) {
      (meta as any)[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (!kvMatch) continue;
    const [, key, value] = kvMatch;
    if (value === "" || value === undefined) {
      // Start of a list
      currentKey = key;
      currentArray = [];
    } else {
      (meta as any)[key] = yamlUnquote(value);
    }
  }
  // Flush trailing array
  if (currentKey && currentArray) {
    (meta as any)[currentKey] = currentArray;
  }

  // Normalize array fields
  for (const field of ["tags", "sourceGraphs", "sourceNodeIds"] as const) {
    const val = (meta as any)[field];
    if (typeof val === "string") {
      // Inline array: [a, b, c]
      if (val.startsWith("[") && val.endsWith("]")) {
        (meta as any)[field] = val
          .slice(1, -1)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
      } else {
        (meta as any)[field] = [val];
      }
    } else if (!Array.isArray(val)) {
      (meta as any)[field] = [];
    }
  }

  return { meta, content };
}

// --- ID helpers ---

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50) || "document"
  );
}

// --- Wikilink parser ---

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Extract Obsidian-style [[wikilinks]] from markdown content. */
export function parseWikilinks(content: string): WikilinkRef[] {
  const refs: WikilinkRef[] = [];
  const seen = new Set<string>();
  let match;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    const target = match[1].trim();
    if (seen.has(target)) continue;
    seen.add(target);
    refs.push({
      target,
      display: match[2]?.trim() ?? null,
    });
  }
  return refs;
}

// --- Recursive directory scanner ---

async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip hidden
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectMdFiles(full);
      results.push(...sub);
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

// --- DocumentStore ---

export class DocumentStore {
  constructor(private mounts: KBMount[]) {
    if (mounts.length === 0) {
      throw new Error("DocumentStore requires at least one mount");
    }
  }

  getMounts(): KBMount[] {
    return this.mounts.slice();
  }

  private getMount(collection?: string): KBMount {
    if (collection) {
      const mount = this.mounts.find((m) => m.name === collection);
      if (!mount) throw new Error(`KB mount "${collection}" not found`);
      return mount;
    }
    // Default: first writable mount
    const writable = this.mounts.find((m) => m.writable);
    if (!writable) throw new Error("No writable KB mount configured");
    return writable;
  }

  private docFile(mountPath: string, id: string): string {
    const resolved = path.resolve(mountPath, `${id}.md`);
    const resolvedMount = path.resolve(mountPath);
    if (!resolved.startsWith(resolvedMount + path.sep) && resolved !== resolvedMount) {
      throw new Error(`Invalid document id: "${id}"`);
    }
    return resolved;
  }

  private async writeAtomic(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath);
  }

  private async findDoc(id: string): Promise<{ mount: KBMount; filePath: string } | null> {
    for (const mount of this.mounts) {
      // First check top-level (fast path)
      const topLevel = this.docFile(mount.path, id);
      try {
        await fs.access(topLevel);
        return { mount, filePath: topLevel };
      } catch {
        // not at top level
      }
      // Scan recursively for id match
      const allFiles = await collectMdFiles(mount.path);
      for (const filePath of allFiles) {
        const basename = path.basename(filePath, ".md");
        if (basename === id) return { mount, filePath };
      }
    }
    return null;
  }

  private async readDocFromFile(
    filePath: string,
    collection: string,
  ): Promise<KBDocument> {
    const raw = await fs.readFile(filePath, "utf8");
    const { meta, content } = parseFrontmatter(raw);
    const basename = path.basename(filePath, ".md");
    return {
      id: (meta.id as string) ?? basename,
      title: (meta.title as string) ?? basename,
      tags: (meta.tags as string[]) ?? [],
      sourceGraphs: (meta.sourceGraphs as string[]) ?? [],
      sourceNodeIds: (meta.sourceNodeIds as string[]) ?? [],
      collection,
      createdAt: (meta.createdAt as string) ?? "",
      updatedAt: (meta.updatedAt as string) ?? "",
      content,
    };
  }

  private summaryFromFile(
    raw: string,
    filePath: string,
    collection: string,
  ): KBDocumentSummary {
    const { meta } = parseFrontmatter(raw);
    const basename = path.basename(filePath, ".md");
    return {
      id: (meta.id as string) ?? basename,
      title: (meta.title as string) ?? basename,
      tags: (meta.tags as string[]) ?? [],
      sourceGraphs: (meta.sourceGraphs as string[]) ?? [],
      collection,
      createdAt: (meta.createdAt as string) ?? "",
      updatedAt: (meta.updatedAt as string) ?? "",
    };
  }

  private async resolveId(baseId: string, mountPath: string): Promise<string> {
    let id = baseId;
    let suffix = 2;
    while (true) {
      try {
        await fs.access(this.docFile(mountPath, id));
        id = `${baseId}-${suffix}`;
        suffix++;
      } catch {
        return id;
      }
    }
  }

  // --- Public API ---

  async save(doc: {
    title: string;
    content: string;
    tags?: string[];
    sourceGraphs?: string[];
    sourceNodeIds?: string[];
    id?: string;
    collection?: string;
  }): Promise<KBDocument> {
    const mount = this.getMount(doc.collection);
    if (!mount.writable) {
      throw new Error(`KB mount "${mount.name}" is read-only`);
    }

    await fs.mkdir(mount.path, { recursive: true });

    const now = new Date().toISOString();
    let id: string;
    let createdAt: string;

    if (doc.id) {
      // Update: reuse id, preserve createdAt if possible
      id = doc.id;
      const existing = await this.findDoc(id);
      if (existing) {
        const old = await this.readDocFromFile(existing.filePath, mount.name);
        createdAt = old.createdAt || now;
      } else {
        createdAt = now;
      }
    } else {
      // New: generate id, check for collisions
      id = await this.resolveId(slugify(doc.title), mount.path);
      createdAt = now;
    }

    const meta: Omit<KBDocumentMeta, "collection"> = {
      id,
      title: doc.title,
      tags: doc.tags ?? [],
      sourceGraphs: doc.sourceGraphs ?? [],
      sourceNodeIds: doc.sourceNodeIds ?? [],
      createdAt,
      updatedAt: now,
    };

    const fileContent = serializeFrontmatter(meta) + "\n" + doc.content;
    await this.writeAtomic(this.docFile(mount.path, id), fileContent);

    return { ...meta, collection: mount.name, content: doc.content };
  }

  async list(opts?: {
    collection?: string;
    limit?: number;
    offset?: number;
  }): Promise<KBListResult> {
    const mountsToScan = opts?.collection
      ? [this.getMount(opts.collection)]
      : this.mounts;

    const results: KBDocumentSummary[] = [];

    for (const mount of mountsToScan) {
      const files = await collectMdFiles(mount.path);
      for (const filePath of files) {
        try {
          const raw = await fs.readFile(filePath, "utf8");
          results.push(this.summaryFromFile(raw, filePath, mount.name));
        } catch {
          // skip unreadable files
        }
      }
    }

    // Sort by updatedAt descending
    results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

    const total = results.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? total;
    const page = results.slice(offset, offset + limit);
    return {
      documents: page,
      total,
      hasMore: offset + limit < total,
    };
  }

  async read(id: string): Promise<KBDocument> {
    const found = await this.findDoc(id);
    if (!found) throw new Error(`Document "${id}" not found`);
    return this.readDocFromFile(found.filePath, found.mount.name);
  }

  async delete(id: string): Promise<void> {
    const found = await this.findDoc(id);
    if (!found) throw new Error(`Document "${id}" not found`);
    if (!found.mount.writable) {
      throw new Error(`Cannot delete from read-only mount "${found.mount.name}"`);
    }
    await fs.rm(found.filePath);
  }

  async search(query: string, opts?: {
    collection?: string;
    limit?: number;
    offset?: number;
  }): Promise<KBListResult> {
    const mountsToScan = opts?.collection
      ? [this.getMount(opts.collection)]
      : this.mounts;

    const q = query.toLowerCase();
    const results: KBDocumentSummary[] = [];

    for (const mount of mountsToScan) {
      const files = await collectMdFiles(mount.path);
      for (const filePath of files) {
        try {
          const raw = await fs.readFile(filePath, "utf8");
          if (!raw.toLowerCase().includes(q)) continue;
          results.push(this.summaryFromFile(raw, filePath, mount.name));
        } catch {
          // skip
        }
      }
    }

    results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

    const total = results.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? total;
    const page = results.slice(offset, offset + limit);
    return {
      documents: page,
      total,
      hasMore: offset + limit < total,
    };
  }

  async listMounts(): Promise<KBMountInfo[]> {
    const infos: KBMountInfo[] = [];
    for (const mount of this.mounts) {
      const files = await collectMdFiles(mount.path);
      infos.push({
        name: mount.name,
        path: mount.path,
        writable: mount.writable,
        docCount: files.length,
        type: "local",
      });
    }
    return infos;
  }

  /**
   * Read a document by id or an arbitrary file path. Returns the
   * content formatted as source material for mining into a graph.
   * Parses [[wikilinks]] from the content and returns them as refs.
   */
  async ingest(opts: { id?: string; path?: string }): Promise<{
    title: string;
    content: string;
    sourceGraphs: string[];
    wikilinks: WikilinkRef[];
  }> {
    if (opts.path) {
      if (!opts.path.endsWith(".md")) {
        throw new Error("Only .md files can be ingested");
      }
      const raw = await fs.readFile(opts.path, "utf8");
      const { meta, content } = parseFrontmatter(raw);
      return {
        title: (meta.title as string) ?? path.basename(opts.path, ".md"),
        content,
        sourceGraphs: (meta.sourceGraphs as string[]) ?? [],
        wikilinks: parseWikilinks(content),
      };
    }
    if (opts.id) {
      const doc = await this.read(opts.id);
      return {
        title: doc.title,
        content: doc.content,
        sourceGraphs: doc.sourceGraphs,
        wikilinks: parseWikilinks(doc.content),
      };
    }
    throw new Error("Either id or path must be provided");
  }
}
