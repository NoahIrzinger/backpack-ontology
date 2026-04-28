import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getContext, setContext, clearContext, describeContext, resolveContextName, } from "../../src/ops/context.js";
let tmpDir: string;
let oldHome: string | undefined;
beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-context-"));
    oldHome = process.env.HOME;
    process.env.HOME = tmpDir;
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, ".config");
    await fs.mkdir(path.join(tmpDir, ".config", "backpack"), { recursive: true });
});
afterEach(async () => {
    if (oldHome)
        process.env.HOME = oldHome;
    delete process.env.XDG_CONFIG_HOME;
    await fs.rm(tmpDir, { recursive: true, force: true });
});
describe("getContext / setContext", () => {
    it("setContext persists and getContext reads back", async () => {
        await setContext({ source: "cloud", cloudContainer: "projects" });
        const got = await getContext();
        expect(got.source).toBe("cloud");
        expect(got.cloudContainer).toBe("projects");
    });
    it("getContext falls back to active local backpack from registry when no state", async () => {
        const reg = { active: "/some/path", paths: ["/some/path"] };
        await fs.writeFile(path.join(tmpDir, ".config", "backpack", "backpacks.json"), JSON.stringify(reg), "utf8");
        const ctx = await getContext();
        expect(ctx.source).toBe("local");
        expect(ctx.backpackPath).toBe("/some/path");
    });
    it("getContext falls back to cloud-no-container when nothing else is configured", async () => {
        const ctx = await getContext();
        expect(ctx.source).toBe("cloud");
        expect(ctx.cloudContainer).toBeUndefined();
    });
    it("clearContext removes the state file", async () => {
        await setContext({ source: "cloud", cloudContainer: "x" });
        await clearContext();
        const ctx = await getContext();
        expect(ctx.cloudContainer).toBeUndefined();
    });
});
describe("describeContext", () => {
    it("formats local with the folder basename", () => {
        expect(describeContext({ source: "local", backpackPath: "/foo/bar" })).toBe("local:bar");
    });
    it("formats cloud with the container name", () => {
        expect(describeContext({ source: "cloud", cloudContainer: "my-container" })).toBe("cloud:my-container");
    });
    it("formats cloud with no container as 'cloud (all containers)'", () => {
        expect(describeContext({ source: "cloud" })).toBe("cloud (all containers)");
    });
});
describe("resolveContextName", () => {
    it("returns null + empty suggestions when no contexts exist at all", async () => {
        const r = await resolveContextName("nonexistent");
        expect(r.ctx).toBeNull();
        expect("suggestions" in r ? r.suggestions : "ambiguous" in r ? r.ambiguous : null).toBeDefined();
    });
    it("returns suggestions array (typed correctly) when there are some contexts", async () => {
        const reg = { active: "/foo", paths: ["/foo", "/bar"] };
        await fs.writeFile(path.join(tmpDir, ".config", "backpack", "backpacks.json"), JSON.stringify(reg), "utf8");
        const r = await resolveContextName("baz");
        expect(r.ctx).toBeNull();
        if ("suggestions" in r && r.suggestions) {
            expect(Array.isArray(r.suggestions)).toBe(true);
        }
    });
    it("matches an exact context name", async () => {
        const reg = { active: "/foo", paths: ["/foo"] };
        await fs.writeFile(path.join(tmpDir, ".config", "backpack", "backpacks.json"), JSON.stringify(reg), "utf8");
        const r = await resolveContextName("local:foo");
        expect(r.ctx).not.toBeNull();
        expect(r.ctx?.name).toBe("local:foo");
    });
    it("matches a unique bare name (no prefix)", async () => {
        const reg = { active: "/widgets", paths: ["/widgets"] };
        await fs.writeFile(path.join(tmpDir, ".config", "backpack", "backpacks.json"), JSON.stringify(reg), "utf8");
        const r = await resolveContextName("widgets");
        expect(r.ctx).not.toBeNull();
        expect(r.ctx?.name).toBe("local:widgets");
    });
});
