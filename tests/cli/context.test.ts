import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getContext, setContext, clearContext, describeContext, resolveContextName } from "../../src/ops/context.js";

let tmpDir: string;
let oldHome: string | undefined;
let oldXdg: string | undefined;
let oldToken: string | undefined;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-context-"));
    oldHome = process.env.HOME;
    oldXdg = process.env.XDG_CONFIG_HOME;
    oldToken = process.env.BACKPACK_TOKEN;
    process.env.HOME = tmpDir;
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, ".config");
    delete process.env.BACKPACK_TOKEN;
    await fs.mkdir(path.join(tmpDir, ".config", "backpack"), { recursive: true });
});

afterEach(async () => {
    if (oldHome !== undefined) process.env.HOME = oldHome;
    else delete process.env.HOME;
    if (oldXdg !== undefined) process.env.XDG_CONFIG_HOME = oldXdg;
    else delete process.env.XDG_CONFIG_HOME;
    if (oldToken !== undefined) process.env.BACKPACK_TOKEN = oldToken;
    else delete process.env.BACKPACK_TOKEN;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getContext / setContext", () => {
    it("setContext persists a local context and getContext reads back", async () => {
        await setContext({ source: "local", backpackPath: "/foo/bar" });
        const got = await getContext();
        expect(got.source).toBe("local");
        expect(got.backpackPath).toBe("/foo/bar");
    });
    it("setContext rejects cloud (cloud is auto-detected from BACKPACK_TOKEN)", async () => {
        await expect(setContext({ source: "cloud" })).rejects.toThrow();
    });
    it("getContext returns cloud when BACKPACK_TOKEN is set", async () => {
        process.env.BACKPACK_TOKEN = "test-token";
        const ctx = await getContext();
        expect(ctx.source).toBe("cloud");
    });
    it("getContext falls back to active local backpack from registry when no state and no token", async () => {
        const reg = { active: "/some/path", paths: ["/some/path"] };
        await fs.writeFile(path.join(tmpDir, ".config", "backpack", "backpacks.json"), JSON.stringify(reg), "utf8");
        const ctx = await getContext();
        expect(ctx.source).toBe("local");
        expect(ctx.backpackPath).toBe("/some/path");
    });
    it("getContext returns local with no path when nothing is configured and no token", async () => {
        const ctx = await getContext();
        expect(ctx.source).toBe("local");
        expect(ctx.backpackPath).toBeUndefined();
    });
    it("clearContext removes the state file", async () => {
        await setContext({ source: "local", backpackPath: "/foo" });
        await clearContext();
        const ctx = await getContext();
        expect(ctx.source).toBe("local");
        expect(ctx.backpackPath).toBeUndefined();
    });
});

describe("describeContext", () => {
    it("formats local with the folder basename", () => {
        expect(describeContext({ source: "local", backpackPath: "/foo/bar" })).toBe("local:bar");
    });
    it("formats cloud", () => {
        expect(describeContext({ source: "cloud" })).toBe("cloud");
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
