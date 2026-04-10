import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  EventSourcedBackend,
  ConcurrencyError,
  LOCK_FRESH_MS,
} from "../src/storage/event-sourced-backend.js";
import { Backpack } from "../src/core/backpack.js";

let testDir: string;
let backendA: EventSourcedBackend;
let backendB: EventSourcedBackend;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-concurrency-"));
  backendA = new EventSourcedBackend(testDir, { author: "alice" });
  backendB = new EventSourcedBackend(testDir, { author: "bob" });
  await backendA.initialize();
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("optimistic concurrency at the storage layer", () => {
  it("rejects a stale write with ConcurrencyError", async () => {
    await backendA.createOntology("g", "test");
    // Both clients see version 0
    const v0 = await backendA.getCurrentVersion("g");
    expect(v0).toBe(0);

    // Alice writes a node, version → 1
    const alice = await backendA.loadOntology("g");
    alice.nodes.push({
      id: "n1",
      type: "T",
      properties: {},
      createdAt: "",
      updatedAt: "",
    });
    await backendA.saveOntology("g", alice, 0);

    // Bob still thinks the version is 0 — his write should be rejected
    const bob = await backendB.loadOntology("g");
    bob.nodes.push({
      id: "n2",
      type: "T",
      properties: {},
      createdAt: "",
      updatedAt: "",
    });
    await expect(backendB.saveOntology("g", bob, 0)).rejects.toThrow(
      ConcurrencyError,
    );
  });

  it("succeeds when expectedVersion matches current", async () => {
    await backendA.createOntology("g", "test");
    const data = await backendA.loadOntology("g");
    data.nodes.push({
      id: "n1",
      type: "T",
      properties: {},
      createdAt: "",
      updatedAt: "",
    });
    await expect(backendA.saveOntology("g", data, 0)).resolves.toBeUndefined();
  });

  it("ignores expectedVersion when not provided", async () => {
    await backendA.createOntology("g", "test");
    const a = await backendA.loadOntology("g");
    a.nodes.push({ id: "n1", type: "T", properties: {}, createdAt: "", updatedAt: "" });
    await backendA.saveOntology("g", a);
    // Second write without version still works
    const b = await backendB.loadOntology("g");
    b.nodes.push({ id: "n2", type: "T", properties: {}, createdAt: "", updatedAt: "" });
    await expect(backendB.saveOntology("g", b)).resolves.toBeUndefined();
  });
});

describe("Backpack concurrency wiring", () => {
  it("propagates ConcurrencyError and invalidates the cache", async () => {
    const a = new Backpack(backendA);
    const b = new Backpack(backendB);
    await a.initialize();
    await b.initialize();

    await a.createOntology("g", "test");
    // Cache the graph in both
    await a.describeOntology("g");
    await b.describeOntology("g");

    // Alice writes
    await a.addNode("g", "Service", { name: "auth" });

    // Bob's cached version is now stale; his next write should fail
    await expect(b.addNode("g", "Service", { name: "users" })).rejects.toThrow(
      ConcurrencyError,
    );

    // After the failure, bob's cache should have been dropped — next read
    // pulls fresh state which already includes alice's write
    const desc = await b.describeOntology("g");
    expect(desc.nodeCount).toBe(1);

    // And bob can now write successfully (his version is fresh)
    await expect(b.addNode("g", "Service", { name: "users" })).resolves.toBeDefined();
  });

  it("does not throw on a single-writer happy path", async () => {
    const a = new Backpack(backendA);
    await a.initialize();
    await a.createOntology("g", "test");
    for (let i = 0; i < 5; i++) {
      await a.addNode("g", "T", { name: `n${i}` });
    }
    const desc = await a.describeOntology("g");
    expect(desc.nodeCount).toBe(5);
  });
});

describe("lock heartbeat", () => {
  it("touchLock writes a fresh heartbeat", async () => {
    await backendA.createOntology("g", "test");
    await backendA.touchLock("g");
    const lock = await backendA.readLock("g");
    expect(lock).not.toBeNull();
    expect(lock!.author).toBe("alice");
  });

  it("readLock returns null when no lock file exists", async () => {
    await backendA.createOntology("g", "test");
    const lock = await backendA.readLock("g");
    expect(lock).toBeNull();
  });

  it("treats stale locks as null", async () => {
    await backendA.createOntology("g", "test");
    // Write a stale lock file directly
    const stalePath = path.join(testDir, "graphs", "g", ".lock");
    await fs.writeFile(
      stalePath,
      JSON.stringify({
        author: "ghost",
        lastActivity: new Date(Date.now() - LOCK_FRESH_MS - 1000).toISOString(),
      }),
    );
    const lock = await backendA.readLock("g");
    expect(lock).toBeNull();
  });

  it("every successful saveOntology touches the lock", async () => {
    await backendA.createOntology("g", "test");
    const data = await backendA.loadOntology("g");
    data.nodes.push({
      id: "n1",
      type: "T",
      properties: {},
      createdAt: "",
      updatedAt: "",
    });
    await backendA.saveOntology("g", data);
    const lock = await backendA.readLock("g");
    expect(lock).not.toBeNull();
    expect(lock!.author).toBe("alice");
  });

  it("Backpack.getLockInfo proxies to the backend", async () => {
    const a = new Backpack(backendA);
    await a.initialize();
    await a.createOntology("g", "test");
    await a.addNode("g", "T", { name: "x" });
    const lock = await a.getLockInfo("g");
    expect(lock).not.toBeNull();
  });
});
