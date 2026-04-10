import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  RemoteRegistry,
  RemoteRegistryError,
} from "../src/core/remote-registry.js";

describe("RemoteRegistry — name validation and storage", () => {
  let tmpDir: string;
  let registry: RemoteRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "backpack-remote-test-"));
    registry = new RemoteRegistry(tmpDir);
    await registry.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates the cache directory on initialize", async () => {
    const stat = await fs.stat(path.join(tmpDir, "remote-cache"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns empty list when no remotes registered", async () => {
    const list = await registry.list();
    expect(list).toEqual([]);
  });

  it("returns null for unknown remote", async () => {
    const result = await registry.get("nonexistent");
    expect(result).toBeNull();
  });

  it("rejects invalid remote names", async () => {
    // Get is the easiest way to exercise name validation
    await expect(registry.get("../etc/passwd")).rejects.toThrow(
      RemoteRegistryError,
    );
    await expect(registry.get("UPPER")).rejects.toThrow(/invalid remote name/);
    await expect(registry.get("")).rejects.toThrow(/invalid remote name/);
    await expect(registry.get("has spaces")).rejects.toThrow(/invalid remote name/);
    await expect(registry.get("has/slash")).rejects.toThrow(/invalid remote name/);
    await expect(registry.get("-leading-hyphen")).rejects.toThrow(
      /invalid remote name/,
    );
    await expect(registry.get(".dotfile")).rejects.toThrow(/invalid remote name/);
    // 65 chars (limit is 64)
    await expect(registry.get("a".repeat(65))).rejects.toThrow(/invalid remote name/);
  });

  it("accepts valid remote names", async () => {
    // Should not throw — get returns null for unregistered names
    expect(await registry.get("valid")).toBeNull();
    expect(await registry.get("valid-name")).toBeNull();
    expect(await registry.get("valid_name")).toBeNull();
    expect(await registry.get("valid123")).toBeNull();
    expect(await registry.get("a")).toBeNull();
    expect(await registry.get("a".repeat(64))).toBeNull();
  });

  it("loads an empty registry when remotes.json is missing", async () => {
    const reg = await registry.load();
    expect(reg.version).toBe(1);
    expect(reg.remotes).toEqual([]);
  });

  it("rejects a corrupt registry file", async () => {
    await fs.writeFile(path.join(tmpDir, "remotes.json"), "not json", "utf8");
    await expect(registry.load()).rejects.toThrow();
  });

  it("rejects a registry file with wrong version", async () => {
    await fs.writeFile(
      path.join(tmpDir, "remotes.json"),
      JSON.stringify({ version: 999, remotes: [] }),
      "utf8",
    );
    await expect(registry.load()).rejects.toThrow(/malformed/);
  });

  it("unregister throws on unknown name", async () => {
    await expect(registry.unregister("nonexistent")).rejects.toThrow(
      /not registered/,
    );
  });

  it("loadCached throws on unknown name", async () => {
    await expect(registry.loadCached("nonexistent")).rejects.toThrow(
      /not registered/,
    );
  });

  it("refresh throws on unknown name", async () => {
    await expect(registry.refresh("nonexistent")).rejects.toThrow(
      /not registered/,
    );
  });

  it("does not allow path traversal via cache filename", async () => {
    // The name validator should catch this before the path resolver,
    // but defense in depth: even if validateName were bypassed, the
    // path resolver would catch it.
    await expect(registry.get("../escape")).rejects.toThrow();
  });
});

describe("RemoteRegistry — manual registry manipulation", () => {
  let tmpDir: string;
  let registry: RemoteRegistry;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "backpack-remote-test-"));
    registry = new RemoteRegistry(tmpDir);
    await registry.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Bypass the network by writing the registry file + cache file directly,
  // then verifying the read paths work end-to-end.
  it("loads cached graph data after manual registration", async () => {
    const cacheBody = JSON.stringify({
      metadata: { name: "test", description: "" },
      nodes: [],
      edges: [],
    });
    await fs.writeFile(
      path.join(tmpDir, "remote-cache", "test.json"),
      cacheBody,
      "utf8",
    );
    const reg = {
      version: 1,
      remotes: [
        {
          name: "test",
          url: "https://example.com/g.json",
          addedAt: "2026-04-10T00:00:00Z",
          lastFetched: "2026-04-10T00:00:00Z",
          etag: null,
          sha256: "deadbeef",
          pinned: false,
          sizeBytes: cacheBody.length,
        },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, "remotes.json"),
      JSON.stringify(reg),
      "utf8",
    );

    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("test");

    const data = await registry.loadCached("test");
    expect(data.metadata.name).toBe("test");
  });

  it("unregister removes entry and cache file", async () => {
    const cachePath = path.join(tmpDir, "remote-cache", "test.json");
    await fs.writeFile(cachePath, "{}", "utf8");
    await fs.writeFile(
      path.join(tmpDir, "remotes.json"),
      JSON.stringify({
        version: 1,
        remotes: [
          {
            name: "test",
            url: "https://example.com/g.json",
            addedAt: "2026-04-10T00:00:00Z",
            lastFetched: "2026-04-10T00:00:00Z",
            etag: null,
            sha256: "x",
            pinned: false,
            sizeBytes: 2,
          },
        ],
      }),
      "utf8",
    );

    await registry.unregister("test");

    const list = await registry.list();
    expect(list).toEqual([]);

    // Cache file should be gone
    await expect(fs.access(cachePath)).rejects.toThrow();
  });

  it("unregister tolerates a missing cache file", async () => {
    await fs.writeFile(
      path.join(tmpDir, "remotes.json"),
      JSON.stringify({
        version: 1,
        remotes: [
          {
            name: "test",
            url: "https://example.com/g.json",
            addedAt: "2026-04-10T00:00:00Z",
            lastFetched: "2026-04-10T00:00:00Z",
            etag: null,
            sha256: "x",
            pinned: false,
            sizeBytes: 0,
          },
        ],
      }),
      "utf8",
    );
    // No cache file written
    await expect(registry.unregister("test")).resolves.toBeUndefined();
  });

  it("loadCached throws CACHE_MISSING when cache file is gone", async () => {
    await fs.writeFile(
      path.join(tmpDir, "remotes.json"),
      JSON.stringify({
        version: 1,
        remotes: [
          {
            name: "test",
            url: "https://example.com/g.json",
            addedAt: "2026-04-10T00:00:00Z",
            lastFetched: "2026-04-10T00:00:00Z",
            etag: null,
            sha256: "x",
            pinned: false,
            sizeBytes: 0,
          },
        ],
      }),
      "utf8",
    );
    try {
      await registry.loadCached("test");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteRegistryError);
      expect((err as RemoteRegistryError).code).toBe("CACHE_MISSING");
    }
  });
});
