// ============================================================
// Local registry of remote learning graphs.
//
// Stores user subscriptions to graphs hosted at HTTPS URLs.
// Persists to ~/.local/share/backpack/remotes.json.
// Caches fetched graph contents to ~/.local/share/backpack/remote-cache/<name>.json.
//
// This module owns the registry file and the cache directory. It does
// NOT fetch URLs (that's remote-fetch.ts) and does NOT validate graph
// content (that's remote-schema.ts). It glues those together and
// persists state.
// ============================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { dataDir } from "./paths.js";
import { remoteFetch, RemoteFetchError } from "./remote-fetch.js";
import { validateRemoteGraph, RemoteSchemaError } from "./remote-schema.js";
import type { LearningGraphData } from "./types.js";

// --- Types ---

export interface RemoteEntry {
  /** Local alias used in the viewer / MCP. Unique within the registry. */
  name: string;
  /** Source URL (must be https://). */
  url: string;
  /** Optional human-readable source label (e.g. "github:user/repo"). */
  source?: string;
  /** ISO timestamp when first registered. */
  addedAt: string;
  /** ISO timestamp of the last successful fetch. */
  lastFetched: string;
  /** Last seen ETag, for conditional GETs. */
  etag: string | null;
  /** SHA256 of the last fetched body. */
  sha256: string;
  /** If true, refetch refuses to overwrite when sha256 changes. */
  pinned: boolean;
  /** Size in bytes of the cached body. */
  sizeBytes: number;
}

export interface RegistryFile {
  version: number;
  remotes: RemoteEntry[];
}

const REGISTRY_VERSION = 1;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// --- Errors ---

export class RemoteRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "RemoteRegistryError";
  }
}

// --- Helpers ---

function emptyRegistry(): RegistryFile {
  return { version: REGISTRY_VERSION, remotes: [] };
}

function validateName(name: string): void {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new RemoteRegistryError(
      `invalid remote name '${name}': must match /^[a-z0-9][a-z0-9_-]{0,63}$/`,
      "INVALID_NAME",
    );
  }
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// --- The registry class ---

export class RemoteRegistry {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? dataDir();
  }

  private registryFile(): string {
    return path.join(this.baseDir, "remotes.json");
  }

  private cacheDir(): string {
    return path.join(this.baseDir, "remote-cache");
  }

  private cacheFile(name: string): string {
    validateName(name);
    const resolved = path.resolve(this.cacheDir(), `${name}.json`);
    const cacheRoot = path.resolve(this.cacheDir());
    // Defense in depth: ensure the resolved path is inside the cache dir
    if (!resolved.startsWith(cacheRoot + path.sep) && resolved !== cacheRoot) {
      throw new RemoteRegistryError(
        `cache path escapes cache directory`,
        "PATH_TRAVERSAL",
      );
    }
    return resolved;
  }

  /**
   * Ensures the base directory and cache directory exist.
   * Safe to call multiple times.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(this.cacheDir(), { recursive: true });
  }

  /**
   * Reads the registry file. Returns an empty registry if the file
   * doesn't exist yet.
   */
  async load(): Promise<RegistryFile> {
    try {
      const text = await fs.readFile(this.registryFile(), "utf8");
      const parsed = JSON.parse(text);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        parsed.version !== REGISTRY_VERSION ||
        !Array.isArray(parsed.remotes)
      ) {
        throw new RemoteRegistryError(
          "registry file is malformed",
          "CORRUPT_REGISTRY",
        );
      }
      return parsed as RegistryFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyRegistry();
      }
      throw err;
    }
  }

  /**
   * Atomically writes the registry file.
   */
  private async save(reg: RegistryFile): Promise<void> {
    const tmp = `${this.registryFile()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(reg, null, 2), "utf8");
    await fs.rename(tmp, this.registryFile());
  }

  /**
   * List all registered remotes.
   */
  async list(): Promise<RemoteEntry[]> {
    const reg = await this.load();
    return reg.remotes;
  }

  /**
   * Look up a single remote by name.
   */
  async get(name: string): Promise<RemoteEntry | null> {
    validateName(name);
    const reg = await this.load();
    return reg.remotes.find((r) => r.name === name) ?? null;
  }

  /**
   * Register a new remote: validate the name, fetch the URL, validate
   * the graph schema, write to cache, and append to the registry.
   *
   * Throws if the name already exists, if the URL fails to fetch, or
   * if the schema validation fails.
   *
   * The caller is responsible for ensuring the name does not collide
   * with a local graph (this module doesn't know about local graphs).
   */
  async register(opts: {
    name: string;
    url: string;
    source?: string;
    pin?: boolean;
  }): Promise<RemoteEntry> {
    validateName(opts.name);
    await this.initialize();

    const reg = await this.load();
    if (reg.remotes.some((r) => r.name === opts.name)) {
      throw new RemoteRegistryError(
        `remote '${opts.name}' is already registered`,
        "DUPLICATE_NAME",
      );
    }

    // Fetch
    let result;
    try {
      result = await remoteFetch(opts.url);
    } catch (err) {
      if (err instanceof RemoteFetchError) {
        throw new RemoteRegistryError(
          `fetch failed: ${err.message}`,
          err.code,
        );
      }
      throw err;
    }

    // Parse + validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch (err) {
      throw new RemoteRegistryError(
        `response is not valid JSON: ${(err as Error).message}`,
        "INVALID_JSON",
      );
    }

    let validated;
    try {
      validated = validateRemoteGraph(parsed);
    } catch (err) {
      if (err instanceof RemoteSchemaError) {
        throw new RemoteRegistryError(
          `schema validation failed: ${err.message}`,
          "SCHEMA_ERROR",
        );
      }
      throw err;
    }

    // Write cache atomically
    const cachePath = this.cacheFile(opts.name);
    const cacheBody = JSON.stringify(validated.data);
    const tmp = `${cachePath}.tmp`;
    await fs.writeFile(tmp, cacheBody, "utf8");
    await fs.rename(tmp, cachePath);

    const now = new Date().toISOString();
    const entry: RemoteEntry = {
      name: opts.name,
      url: opts.url,
      source: opts.source,
      addedAt: now,
      lastFetched: now,
      etag: result.etag,
      sha256: sha256Hex(cacheBody),
      pinned: !!opts.pin,
      sizeBytes: cacheBody.length,
    };
    reg.remotes.push(entry);
    await this.save(reg);
    return entry;
  }

  /**
   * Refetch a registered remote. Uses ETag for conditional GET.
   *
   * If pinned and the SHA256 changes, throws RemoteRegistryError with
   * code "PIN_VIOLATION" without overwriting the cache.
   */
  async refresh(name: string): Promise<{
    entry: RemoteEntry;
    changed: boolean;
    notModified: boolean;
  }> {
    validateName(name);
    const reg = await this.load();
    const existing = reg.remotes.find((r) => r.name === name);
    if (!existing) {
      throw new RemoteRegistryError(
        `remote '${name}' is not registered`,
        "NOT_FOUND",
      );
    }

    let result;
    try {
      result = await remoteFetch(existing.url, {
        ifNoneMatch: existing.etag ?? undefined,
      });
    } catch (err) {
      if (err instanceof RemoteFetchError) {
        throw new RemoteRegistryError(
          `fetch failed: ${err.message}`,
          err.code,
        );
      }
      throw err;
    }

    if (result.notModified) {
      existing.lastFetched = new Date().toISOString();
      await this.save(reg);
      return { entry: existing, changed: false, notModified: true };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch (err) {
      throw new RemoteRegistryError(
        `response is not valid JSON: ${(err as Error).message}`,
        "INVALID_JSON",
      );
    }

    let validated;
    try {
      validated = validateRemoteGraph(parsed);
    } catch (err) {
      if (err instanceof RemoteSchemaError) {
        throw new RemoteRegistryError(
          `schema validation failed: ${err.message}`,
          "SCHEMA_ERROR",
        );
      }
      throw err;
    }

    const cacheBody = JSON.stringify(validated.data);
    const newSha = sha256Hex(cacheBody);
    const changed = newSha !== existing.sha256;

    if (existing.pinned && changed) {
      throw new RemoteRegistryError(
        `remote '${name}' is pinned and content has changed (was ${existing.sha256}, now ${newSha})`,
        "PIN_VIOLATION",
      );
    }

    const cachePath = this.cacheFile(name);
    const tmp = `${cachePath}.tmp`;
    await fs.writeFile(tmp, cacheBody, "utf8");
    await fs.rename(tmp, cachePath);

    existing.lastFetched = new Date().toISOString();
    existing.etag = result.etag;
    existing.sha256 = newSha;
    existing.sizeBytes = cacheBody.length;
    await this.save(reg);

    return { entry: existing, changed, notModified: false };
  }

  /**
   * Remove a remote from the registry and delete its cache file.
   */
  async unregister(name: string): Promise<void> {
    validateName(name);
    const reg = await this.load();
    const idx = reg.remotes.findIndex((r) => r.name === name);
    if (idx === -1) {
      throw new RemoteRegistryError(
        `remote '${name}' is not registered`,
        "NOT_FOUND",
      );
    }
    reg.remotes.splice(idx, 1);
    await this.save(reg);

    // Best-effort cache deletion
    try {
      await fs.unlink(this.cacheFile(name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Load the cached graph contents for a registered remote.
   * Throws if the remote is not registered or the cache file is missing.
   */
  async loadCached(name: string): Promise<LearningGraphData> {
    validateName(name);
    const reg = await this.load();
    const entry = reg.remotes.find((r) => r.name === name);
    if (!entry) {
      throw new RemoteRegistryError(
        `remote '${name}' is not registered`,
        "NOT_FOUND",
      );
    }
    let text: string;
    try {
      text = await fs.readFile(this.cacheFile(name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new RemoteRegistryError(
          `cache file for '${name}' is missing — try refreshing`,
          "CACHE_MISSING",
        );
      }
      throw err;
    }
    return JSON.parse(text) as LearningGraphData;
  }
}
