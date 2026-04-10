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
  colorForPath,
  deriveName,
  BackpackRegistryError,
} from "../src/core/backpacks-registry.js";
import { Backpack } from "../src/core/backpack.js";

// Tests sandbox the registry files via BACKPACK_DIR so they never touch
// the user's real ~/.config/backpack/. Each test runs in its own tmpdir
// and cleans up afterward.

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

describe("colorForPath", () => {
  it("is deterministic — same path always yields the same color", () => {
    const p = "/Users/noah/OneDrive/work";
    expect(colorForPath(p)).toBe(colorForPath(p));
  });

  it("produces different colors for different paths", () => {
    const paths = [
      "/Users/noah/OneDrive/work",
      "/Users/noah/Dropbox/family",
      "/Users/noah/.local/share/backpack/graphs",
      "/Users/noah/projects/research",
      "/Volumes/share/team",
    ];
    const colors = paths.map(colorForPath);
    const unique = new Set(colors);
    // Should be close to unique — if they all collide, hash is broken
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it("returns a 7-char hex string starting with #", () => {
    expect(colorForPath("/anything")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("deriveName", () => {
  it("returns 'personal' for the default personal path", async () => {
    // Seed the registry so the default path becomes known
    const cfg = await loadRegistry();
    const personal = cfg.paths[0];
    const name = deriveName(personal, cfg.paths);
    expect(name).toBe("personal");
  });

  it("uses the last segment of an ordinary path", () => {
    const paths = ["/Users/noah/OneDrive/work"];
    expect(deriveName("/Users/noah/OneDrive/work", paths)).toBe("work");
  });

  it("strips a trailing separator before taking the base", () => {
    const paths = ["/Users/noah/OneDrive/work/"];
    expect(deriveName("/Users/noah/OneDrive/work/", paths)).toBe("work");
  });

  it("appends -2, -3 on collision in registration order", () => {
    const paths = [
      "/Users/noah/OneDrive/shared",
      "/Users/noah/Dropbox/shared",
      "/Users/noah/iCloud/shared",
    ];
    expect(deriveName(paths[0], paths)).toBe("shared");
    expect(deriveName(paths[1], paths)).toBe("shared-2");
    expect(deriveName(paths[2], paths)).toBe("shared-3");
  });

  it("does not treat the personal path as colliding with a 'personal' name", async () => {
    // If a user registers /some/path/personal alongside the default personal
    // graphs dir, both should still be distinguishable
    await loadRegistry();
    const cfg = await loadRegistry();
    const personalDefault = cfg.paths[0];
    const otherPersonal = path.join(sandbox, "something", "personal");
    const allPaths = [personalDefault, otherPersonal];
    expect(deriveName(personalDefault, allPaths)).toBe("personal");
    expect(deriveName(otherPersonal, allPaths)).toBe("personal-2");
  });
});

describe("registry seeding", () => {
  it("first load seeds with the personal default path", async () => {
    const registry = await loadRegistry();
    expect(registry.paths).toHaveLength(1);
    expect(registry.active).toBe(registry.paths[0]);
  });

  it("second load reads the existing file unchanged", async () => {
    const first = await loadRegistry();
    await registerBackpack(path.join(sandbox, "work"));
    const second = await loadRegistry();
    expect(second.paths).toHaveLength(2);
    expect(second.paths[0]).toBe(first.paths[0]);
  });

  it("derived list includes exactly the registered paths", async () => {
    await loadRegistry();
    await registerBackpack(path.join(sandbox, "work"));
    await registerBackpack(path.join(sandbox, "family"));
    const entries = await listBackpacks();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name).sort()).toEqual([
      "family",
      "personal",
      "work",
    ]);
  });
});

describe("registerBackpack", () => {
  it("adds a new absolute path", async () => {
    await loadRegistry();
    const target = path.join(sandbox, "work");
    const entry = await registerBackpack(target);
    expect(entry.path).toBe(path.resolve(target));
    expect(entry.name).toBe("work");
    expect(entry.color).toBe(colorForPath(entry.path));
  });

  it("creates the target directory if it doesn't exist", async () => {
    await loadRegistry();
    const target = path.join(sandbox, "brand-new-dir");
    await registerBackpack(target);
    const stat = await fs.stat(target);
    expect(stat.isDirectory()).toBe(true);
  });

  it("is idempotent — registering an existing path is a no-op", async () => {
    await loadRegistry();
    const target = path.join(sandbox, "work");
    const first = await registerBackpack(target);
    const second = await registerBackpack(target);
    expect(second.path).toBe(first.path);
    const entries = await listBackpacks();
    // Should still have exactly personal + work
    expect(entries).toHaveLength(2);
  });

  it("expands leading ~/ to the home directory", async () => {
    await loadRegistry();
    const target = path.join(os.homedir(), "_bp_test_tilde_expand_should_not_exist");
    try {
      const entry = await registerBackpack("~/_bp_test_tilde_expand_should_not_exist");
      expect(entry.path).toBe(target);
    } finally {
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("unregisterBackpack", () => {
  it("removes a registered path by path", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    await unregisterBackpack(work);
    const entries = await listBackpacks();
    expect(entries.map((e) => e.name)).not.toContain("work");
  });

  it("removes a registered path by derived name", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    await unregisterBackpack("work");
    const entries = await listBackpacks();
    expect(entries.map((e) => e.name)).not.toContain("work");
  });

  it("refuses to remove the last remaining backpack", async () => {
    await loadRegistry();
    await expect(unregisterBackpack("personal")).rejects.toThrow(
      BackpackRegistryError,
    );
  });

  it("auto-switches active to the first remaining when removing the active one", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    await setActiveBackpack("work");
    expect((await getActiveBackpack()).name).toBe("work");
    await unregisterBackpack("work");
    expect((await getActiveBackpack()).name).toBe("personal");
  });

  it("rejects removal of non-existent names or paths", async () => {
    await loadRegistry();
    await expect(unregisterBackpack("ghost")).rejects.toThrow(
      BackpackRegistryError,
    );
  });
});

describe("active backpack resolution", () => {
  it("defaults to the personal path on first run", async () => {
    const active = await getActiveBackpack();
    expect(active.name).toBe("personal");
  });

  it("setActiveBackpack by name persists", async () => {
    await loadRegistry();
    await registerBackpack(path.join(sandbox, "work"));
    await setActiveBackpack("work");
    const active = await getActiveBackpack();
    expect(active.name).toBe("work");
  });

  it("setActiveBackpack by path also persists", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    await setActiveBackpack(path.resolve(work));
    const active = await getActiveBackpack();
    expect(active.name).toBe("work");
  });

  it("setActiveBackpack rejects unknown names", async () => {
    await loadRegistry();
    await expect(setActiveBackpack("ghost")).rejects.toThrow(
      BackpackRegistryError,
    );
  });

  it("BACKPACK_ACTIVE env var overrides persisted active by name", async () => {
    await loadRegistry();
    await registerBackpack(path.join(sandbox, "work"));
    await setActiveBackpack("personal");
    process.env.BACKPACK_ACTIVE = "work";
    const active = await getActiveBackpack();
    expect(active.name).toBe("work");
    // Persisted active is untouched
    delete process.env.BACKPACK_ACTIVE;
    expect((await getActiveBackpack()).name).toBe("personal");
  });

  it("BACKPACK_ACTIVE env var also accepts an absolute path", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    process.env.BACKPACK_ACTIVE = path.resolve(work);
    const active = await getActiveBackpack();
    expect(active.name).toBe("work");
  });

  it("BACKPACK_ACTIVE pointing at unknown name is ignored, not crashed", async () => {
    await loadRegistry();
    process.env.BACKPACK_ACTIVE = "ghost";
    expect((await getActiveBackpack()).name).toBe("personal");
  });
});

describe("getBackpack lookup", () => {
  it("returns null for unknown name", async () => {
    await loadRegistry();
    expect(await getBackpack("ghost")).toBeNull();
  });

  it("finds by derived name", async () => {
    await loadRegistry();
    await registerBackpack(path.join(sandbox, "work"));
    const entry = await getBackpack("work");
    expect(entry?.name).toBe("work");
  });

  it("finds by absolute path", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    const entry = await getBackpack(path.resolve(work));
    expect(entry?.name).toBe("work");
  });

  it("path lookup normalizes tilde-expanded input", async () => {
    await loadRegistry();
    const tildeTarget = path.join(os.homedir(), "_bp_test_lookup_tilde");
    try {
      await registerBackpack(tildeTarget);
      const found = await getBackpack("~/_bp_test_lookup_tilde");
      expect(found?.path).toBe(tildeTarget);
    } finally {
      await fs.rm(tildeTarget, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("migration from legacy v1 format", () => {
  it("converts { backpacks: [{name,path,color}] } to { paths, active }", async () => {
    // Manually write a v1 file in the sandbox config dir
    const configPath = path.join(sandbox, "config", "backpacks.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        backpacks: [
          { name: "personal", path: "/legacy/personal", color: "#aabbcc" },
          { name: "work", path: "/legacy/work", color: "#ddeeff" },
        ],
      }),
    );
    // And the legacy active file
    const activePath = path.join(sandbox, "config", "active.json");
    await fs.writeFile(
      activePath,
      JSON.stringify({ version: 1, name: "work" }),
    );

    const cfg = await loadRegistry();
    expect(cfg.version).toBe(2);
    expect(cfg.paths).toEqual(["/legacy/personal", "/legacy/work"]);
    expect(cfg.active).toBe("/legacy/work");

    // Legacy active.json should be gone
    await expect(fs.access(activePath)).rejects.toThrow();

    // New file should have the v2 shape
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed).not.toHaveProperty("backpacks");
    expect(parsed.paths).toBeDefined();
  });

  it("v1 with no legacy active.json falls back to the first path", async () => {
    const configPath = path.join(sandbox, "config", "backpacks.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        backpacks: [
          { name: "personal", path: "/legacy/personal" },
          { name: "work", path: "/legacy/work" },
        ],
      }),
    );
    const cfg = await loadRegistry();
    expect(cfg.active).toBe("/legacy/personal");
  });

  it("garbage file is replaced with a fresh seeded registry", async () => {
    const configPath = path.join(sandbox, "config", "backpacks.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, '{"unrelated": true}');
    const cfg = await loadRegistry();
    expect(cfg.paths).toHaveLength(1);
    expect(cfg.active).toBe(cfg.paths[0]);
  });
});

describe("Backpack class switching", () => {
  it("fromActiveBackpack instantiates against the seeded personal entry", async () => {
    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();
    const active = bp.getActiveBackpackEntry();
    expect(active?.name).toBe("personal");
  });

  it("switchBackpack by name swaps storage and clears caches", async () => {
    await loadRegistry();
    await registerBackpack(path.join(sandbox, "work"));

    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();

    await bp.createOntology("p1", "personal graph");
    await bp.addNode("p1", "T", { name: "in-personal" });
    expect((await bp.listOntologies()).map((g) => g.name)).toContain("p1");

    await bp.switchBackpack("work");
    expect(bp.getActiveBackpackEntry()?.name).toBe("work");

    // Work is empty — personal graph is invisible
    expect(await bp.listOntologies()).toHaveLength(0);

    await bp.createOntology("w1", "work graph");
    expect((await bp.listOntologies()).map((g) => g.name)).toEqual(["w1"]);

    // Switch back — personal graph still there
    await bp.switchBackpack("personal");
    expect((await bp.listOntologies()).map((g) => g.name)).toEqual(["p1"]);
  });

  it("switchBackpack by path also works", async () => {
    await loadRegistry();
    const work = path.join(sandbox, "work");
    await registerBackpack(work);
    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();
    await bp.switchBackpack(path.resolve(work));
    expect(bp.getActiveBackpackEntry()?.name).toBe("work");
  });

  it("switchBackpack rejects unknown names", async () => {
    const bp = await Backpack.fromActiveBackpack();
    await bp.initialize();
    await expect(bp.switchBackpack("ghost")).rejects.toThrow(
      BackpackRegistryError,
    );
  });
});
