import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadRegistry,
  listBackpacks,
  registerBackpack,
  unregisterBackpack,
  getActiveBackpack,
  setActiveBackpack,
  getBackpack,
  colorForName,
  BackpackRegistryError,
} from "../src/core/backpacks-registry.js";
import { Backpack } from "../src/core/backpack.js";

// These tests use BACKPACK_DIR to sandbox the registry files, so they
// never touch the user's real ~/.config/backpack/. Every test runs in
// its own tmpdir and cleans up afterward.

let sandbox: string;
const envBackup: Record<string, string | undefined> = {};

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "bp-registry-"));
  envBackup.BACKPACK_DIR = process.env.BACKPACK_DIR;
  envBackup.BACKPACK_ACTIVE = process.env.BACKPACK_ACTIVE;
  process.env.BACKPACK_DIR = sandbox;
  delete process.env.BACKPACK_ACTIVE;
});

afterEach(async () => {
  if (envBackup.BACKPACK_DIR === undefined) delete process.env.BACKPACK_DIR;
  else process.env.BACKPACK_DIR = envBackup.BACKPACK_DIR;
  if (envBackup.BACKPACK_ACTIVE === undefined) delete process.env.BACKPACK_ACTIVE;
  else process.env.BACKPACK_ACTIVE = envBackup.BACKPACK_ACTIVE;
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe("colorForName", () => {
  it("is deterministic — same name always yields the same color", () => {
    expect(colorForName("personal")).toBe(colorForName("personal"));
    expect(colorForName("work")).toBe(colorForName("work"));
  });

  it("produces different colors for different names", () => {
    const names = ["personal", "work", "family", "project-alpha", "research"];
    const colors = names.map(colorForName);
    const unique = new Set(colors);
    // Not guaranteed to be 100% unique, but should be close — if all 5
    // collide the hash is broken
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it("returns a 7-char hex string starting with #", () => {
    const c = colorForName("anything");
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("registry seeding", () => {
  it("first load seeds a 'personal' entry automatically", async () => {
    const registry = await loadRegistry();
    expect(registry.backpacks).toHaveLength(1);
    expect(registry.backpacks[0].name).toBe("personal");
    expect(registry.backpacks[0].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("seeds active.json to 'personal' on first load", async () => {
    await loadRegistry();
    const active = await getActiveBackpack();
    expect(active.name).toBe("personal");
  });

  it("second load reads the existing file without re-seeding", async () => {
    const first = await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work-graphs"));
    const second = await loadRegistry();
    expect(second.backpacks).toHaveLength(2);
    expect(second.backpacks.map((b) => b.name).sort()).toEqual(["personal", "work"]);
    expect(first.backpacks[0].name).toBe("personal");
  });
});

describe("registerBackpack", () => {
  it("adds a new backpack with a normalized absolute path", async () => {
    await loadRegistry();
    const entry = await registerBackpack("work", path.join(sandbox, "work-dir"));
    expect(entry.name).toBe("work");
    expect(path.isAbsolute(entry.path)).toBe(true);
    expect(entry.color).toBe(colorForName("work"));
  });

  it("creates the target directory if it doesn't exist", async () => {
    await loadRegistry();
    const target = path.join(sandbox, "brand-new-dir");
    await registerBackpack("brand-new", target);
    const stat = await fs.stat(target);
    expect(stat.isDirectory()).toBe(true);
  });

  it("rejects invalid names", async () => {
    await loadRegistry();
    await expect(
      registerBackpack("Work With Spaces", path.join(sandbox, "x")),
    ).rejects.toThrow(BackpackRegistryError);
    await expect(
      registerBackpack("UPPER", path.join(sandbox, "x")),
    ).rejects.toThrow(BackpackRegistryError);
    await expect(
      registerBackpack("-leading-hyphen", path.join(sandbox, "x")),
    ).rejects.toThrow(BackpackRegistryError);
  });

  it("rejects duplicate names", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work1"));
    await expect(
      registerBackpack("work", path.join(sandbox, "work2")),
    ).rejects.toThrow(BackpackRegistryError);
  });

  it("persists across reloads", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));
    const after = await listBackpacks();
    expect(after.map((b) => b.name)).toContain("work");
  });
});

describe("unregisterBackpack", () => {
  it("removes a registered backpack", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));
    await unregisterBackpack("work");
    const remaining = await listBackpacks();
    expect(remaining.map((b) => b.name)).not.toContain("work");
  });

  it("refuses to remove the last remaining backpack", async () => {
    await loadRegistry();
    await expect(unregisterBackpack("personal")).rejects.toThrow(
      BackpackRegistryError,
    );
  });

  it("switches active to the first remaining when removing the active one", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));
    await setActiveBackpack("work");
    expect((await getActiveBackpack()).name).toBe("work");
    await unregisterBackpack("work");
    expect((await getActiveBackpack()).name).toBe("personal");
  });

  it("rejects removal of non-existent names", async () => {
    await loadRegistry();
    await expect(unregisterBackpack("ghost")).rejects.toThrow(
      BackpackRegistryError,
    );
  });
});

describe("active backpack resolution", () => {
  it("defaults to 'personal' on first run", async () => {
    const active = await getActiveBackpack();
    expect(active.name).toBe("personal");
  });

  it("setActiveBackpack persists across calls", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));
    await setActiveBackpack("work");
    const active = await getActiveBackpack();
    expect(active.name).toBe("work");
  });

  it("setActiveBackpack rejects unknown names", async () => {
    await loadRegistry();
    await expect(setActiveBackpack("ghost")).rejects.toThrow(
      BackpackRegistryError,
    );
  });

  it("BACKPACK_ACTIVE env var overrides the persisted active", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));
    await setActiveBackpack("personal");
    // Env var override
    process.env.BACKPACK_ACTIVE = "work";
    const active = await getActiveBackpack();
    expect(active.name).toBe("work");
    // Persisted active is still "personal" (env var didn't touch the file)
    delete process.env.BACKPACK_ACTIVE;
    const persisted = await getActiveBackpack();
    expect(persisted.name).toBe("personal");
  });

  it("BACKPACK_ACTIVE pointing at unknown name is ignored, not crashed", async () => {
    await loadRegistry();
    process.env.BACKPACK_ACTIVE = "ghost";
    const active = await getActiveBackpack();
    // Falls through to persisted (personal)
    expect(active.name).toBe("personal");
  });
});

describe("getBackpack", () => {
  it("returns null for unknown name", async () => {
    await loadRegistry();
    expect(await getBackpack("ghost")).toBeNull();
  });

  it("returns the entry for a registered name", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));
    const entry = await getBackpack("work");
    expect(entry).not.toBeNull();
    expect(entry?.name).toBe("work");
  });
});

describe("Backpack class switching", () => {
  it("fromActiveBackpack instantiates against the seeded personal entry", async () => {
    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();
    const active = bp.getActiveBackpackEntry();
    expect(active?.name).toBe("personal");
  });

  it("switchBackpack swaps the storage backend and clears caches", async () => {
    await loadRegistry();
    await registerBackpack("work", path.join(sandbox, "work"));

    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();

    // Create a graph in personal
    await bp.createOntology("p1", "personal graph");
    await bp.addNode("p1", "T", { name: "in-personal" });
    const personalList = await bp.listOntologies();
    expect(personalList.map((g) => g.name)).toContain("p1");

    // Switch to work
    await bp.switchBackpack("work");
    expect(bp.getActiveBackpackEntry()?.name).toBe("work");

    // Work should be empty — personal graph is invisible
    const workList = await bp.listOntologies();
    expect(workList.map((g) => g.name)).not.toContain("p1");
    expect(workList).toHaveLength(0);

    // Create a graph in work
    await bp.createOntology("w1", "work graph");
    const workAfter = await bp.listOntologies();
    expect(workAfter.map((g) => g.name)).toEqual(["w1"]);

    // Switch back — personal should still have its graph
    await bp.switchBackpack("personal");
    const personalAfter = await bp.listOntologies();
    expect(personalAfter.map((g) => g.name)).toEqual(["p1"]);
  });

  it("switchBackpack rejects unknown names", async () => {
    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();
    await expect(bp.switchBackpack("ghost")).rejects.toThrow(
      BackpackRegistryError,
    );
  });
});
