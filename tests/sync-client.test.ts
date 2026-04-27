import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { SyncClient } from "../src/sync/sync-client.js";
import { SyncRelayClient } from "../src/sync/sync-relay.js";
import { readSyncState, writeSyncState } from "../src/sync/sync-state.js";
import {
  ARTIFACT_KIND_GRAPH,
  SyncVersionConflictError,
  type SyncManifest,
  type SyncArtifact,
  type SyncBackpack,
  type SyncArtifactSummary,
} from "../src/sync/types.js";
import { hashContent, parseArtifactId } from "../src/sync/sync-client.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-sync-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function fakeRelay(): {
  client: SyncRelayClient;
  fetchMock: ReturnType<typeof vi.fn>;
  state: {
    backpack: SyncBackpack;
    artifacts: Map<string, SyncArtifact>;
    tombstones: Set<string>;
  };
} {
  const state = {
    backpack: {
      id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "owner",
      name: "delgate",
      color: "#7c3aed",
      tags: [],
      metadata_version: 1,
      metadata_content_hash: "sha256:meta",
      created_at: "2026-04-27T00:00:00Z",
      updated_at: "2026-04-27T00:00:00Z",
    },
    artifacts: new Map<string, SyncArtifact>(),
    tombstones: new Set<string>(),
  };

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "POST" && u.pathname === "/api/sync/register") {
      return new Response(JSON.stringify(state.backpack), { status: 200 });
    }
    const matchManifest = u.pathname.match(/^\/api\/sync\/backpacks\/([^/]+)\/manifest$/);
    if (matchManifest && method === "GET") {
      const manifest: SyncManifest = {
        backpack_id: state.backpack.id,
        name: state.backpack.name,
        color: state.backpack.color,
        tags: state.backpack.tags,
        metadata_version: state.backpack.metadata_version,
        metadata_content_hash: state.backpack.metadata_content_hash,
        artifacts: [
          ...Array.from(state.artifacts.values()).map(
            (a): SyncArtifactSummary => ({
              artifact_id: a.artifact_id,
              version: a.version,
              content_hash: a.content_hash,
              modified_at: a.modified_at,
            }),
          ),
          ...Array.from(state.tombstones).map(
            (id): SyncArtifactSummary => ({
              artifact_id: id,
              version: 0,
              content_hash: "",
              modified_at: "2026-04-27T00:00:00Z",
              deleted: true,
            }),
          ),
        ],
      };
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    const matchArtifact = u.pathname.match(/^\/api\/sync\/backpacks\/([^/]+)\/artifacts\/(.+)$/);
    if (matchArtifact) {
      const aid = decodeURIComponent(matchArtifact[2]);
      if (method === "GET") {
        const art = state.artifacts.get(aid);
        if (!art) {
          return new Response(JSON.stringify({ error: "artifact not found" }), { status: 404 });
        }
        return new Response(JSON.stringify(art), { status: 200 });
      }
      if (method === "PUT") {
        const body = JSON.parse((init?.body as string) ?? "{}") as {
          expected_version: number;
          content: unknown;
        };
        const existing = state.artifacts.get(aid);
        const currentVersion = existing?.version ?? 0;
        if (body.expected_version !== currentVersion) {
          return new Response(
            JSON.stringify({ error: "version conflict", current: existing }),
            { status: 409 },
          );
        }
        state.tombstones.delete(aid);
        const newArt: SyncArtifact = {
          artifact_id: aid,
          version: currentVersion + 1,
          content_hash: hashContent(body.content),
          modified_at: new Date().toISOString(),
          content: body.content,
        };
        state.artifacts.set(aid, newArt);
        return new Response(JSON.stringify(newArt), { status: 200 });
      }
      if (method === "DELETE") {
        state.artifacts.delete(aid);
        state.tombstones.add(aid);
        return new Response(null, { status: 204 });
      }
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });

  const client = new SyncRelayClient({
    baseUrl: "http://localhost:8080",
    token: "test",
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
  return { client, fetchMock, state };
}

describe("SyncClient — register", () => {
  it("creates state file with relay backpack id", async () => {
    const relay = fakeRelay();
    const c = new SyncClient({ backpackPath: tmpDir, relay: relay.client });
    const state = await c.register({ name: "delgate" });
    expect(state.backpack_id).toBe(relay.state.backpack.id);
    const persisted = await readSyncState(tmpDir);
    expect(persisted?.backpack_id).toBe(relay.state.backpack.id);
  });

  it("is idempotent across calls", async () => {
    const relay = fakeRelay();
    const c = new SyncClient({ backpackPath: tmpDir, relay: relay.client });
    await c.register({ name: "delgate" });
    await c.register({ name: "delgate" });
    expect(relay.fetchMock).toHaveBeenCalled();
  });
});

describe("SyncClient — push & pull", () => {
  it("pushes a local graph the relay does not have", async () => {
    const relay = fakeRelay();
    const backend = await makeBackendWithGraph(tmpDir, "g1");
    const c = new SyncClient({ backpackPath: tmpDir, relay: relay.client });
    await c.register({ name: "delgate" });

    const result = await c.push();
    expect(result.pushed).toContain(`${ARTIFACT_KIND_GRAPH}:g1`);
    expect(relay.state.artifacts.has(`${ARTIFACT_KIND_GRAPH}:g1`)).toBe(true);
    void backend;
  });

  it("skips already-synced artifacts (no hash change)", async () => {
    const relay = fakeRelay();
    await makeBackendWithGraph(tmpDir, "g1");
    const c = new SyncClient({ backpackPath: tmpDir, relay: relay.client });
    await c.register({ name: "delgate" });
    await c.push();
    const result = await c.push();
    expect(result.pushed).toEqual([]);
  });

  it("pulls a remote graph the local does not have", async () => {
    const relay = fakeRelay();
    // Pre-seed the relay with an artifact
    const remoteData = {
      metadata: { name: "remote-graph", description: "", tags: [], createdAt: "", updatedAt: "" },
      nodes: [],
      edges: [],
    };
    relay.state.artifacts.set("graph:remote-graph", {
      artifact_id: "graph:remote-graph",
      version: 1,
      content_hash: hashContent({
        kind: ARTIFACT_KIND_GRAPH,
        name: "remote-graph",
        data: remoteData,
      }),
      modified_at: "2026-04-27T00:00:00Z",
      content: {
        kind: ARTIFACT_KIND_GRAPH,
        name: "remote-graph",
        data: remoteData,
      },
    });

    const c = new SyncClient({ backpackPath: tmpDir, relay: relay.client });
    await c.register({ name: "delgate" });
    const result = await c.pull();
    expect(result.pulled).toContain("graph:remote-graph");
    // Local backend should now know the graph
    const ontologyDir = path.join(tmpDir, "graphs", "remote-graph");
    const stat = await fs.stat(ontologyDir).catch(() => null);
    expect(stat).not.toBeNull();
  });
});

describe("SyncClient — conflicts", () => {
  it("creates a conflict file when both sides changed", async () => {
    const relay = fakeRelay();
    await makeBackendWithGraph(tmpDir, "g1");
    const c = new SyncClient({ backpackPath: tmpDir, relay: relay.client });
    await c.register({ name: "delgate" });
    await c.push();

    // Simulate remote advancing
    const cur = relay.state.artifacts.get("graph:g1")!;
    const nextContent = {
      ...((cur.content as object) ?? {}),
      data: {
        metadata: { name: "g1", description: "remote-modified", tags: [], createdAt: "", updatedAt: "" },
        nodes: [],
        edges: [],
      },
    };
    relay.state.artifacts.set("graph:g1", {
      ...cur,
      version: cur.version + 1,
      content_hash: hashContent(nextContent),
      content: nextContent,
    });

    // Locally bump the graph's description so local hash differs from tracked.
    const { EventSourcedBackend } = await import("../src/storage/event-sourced-backend.js");
    const backend = new EventSourcedBackend(tmpDir);
    await backend.initialize();
    const data = await backend.loadOntology("g1");
    data.metadata.description = "local-modified";
    await backend.saveOntology("g1", data);

    const result = await c.sync();
    expect(result.conflicts.length).toBeGreaterThan(0);
    const conflict = result.conflicts[0];
    const exists = await fs.stat(conflict.conflict_path).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});

describe("parseArtifactId", () => {
  it("rejects invalid ids", () => {
    expect(() => parseArtifactId("nokind")).toThrow();
    expect(() => parseArtifactId(":nokey")).toThrow();
    expect(() => parseArtifactId("noempty:")).toThrow();
  });
  it("splits on first colon only", () => {
    expect(parseArtifactId("graph:has:colon")).toEqual({ kind: "graph", key: "has:colon" });
  });
});

async function makeBackendWithGraph(dir: string, name: string): Promise<unknown> {
  const { EventSourcedBackend } = await import("../src/storage/event-sourced-backend.js");
  const backend = new EventSourcedBackend(dir);
  await backend.initialize();
  await backend.createOntology(name, "test");
  return backend;
}
