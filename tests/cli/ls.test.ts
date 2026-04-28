import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../../src/cli/router.js";
import { setColorEnabled } from "../../src/cli/colors.js";
let tmp: string;
let oldHome: string | undefined;
let oldXdgConfig: string | undefined;
let oldXdgData: string | undefined;
let oldRelay: string | undefined;
function captureStdout(): {
    get: () => string;
    restore: () => void;
} {
    const buf: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
        buf.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    return { get: () => buf.join(""), restore: () => spy.mockRestore() };
}
function captureStderr(): {
    get: () => string;
    restore: () => void;
} {
    const buf: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s: any) => {
        buf.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    return { get: () => buf.join(""), restore: () => spy.mockRestore() };
}
beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bp-ls-"));
    oldHome = process.env.HOME;
    oldXdgConfig = process.env.XDG_CONFIG_HOME;
    oldXdgData = process.env.XDG_DATA_HOME;
    oldRelay = process.env.BACKPACK_APP_URL;
    process.env.HOME = tmp;
    process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
    process.env.XDG_DATA_HOME = path.join(tmp, ".local", "share");
    process.env.BACKPACK_APP_URL = "https://example.test";
    await fs.mkdir(path.join(tmp, ".config", "backpack"), { recursive: true });
    setColorEnabled(false);
});
afterEach(async () => {
    if (oldHome)
        process.env.HOME = oldHome;
    else
        delete process.env.HOME;
    if (oldXdgConfig)
        process.env.XDG_CONFIG_HOME = oldXdgConfig;
    else
        delete process.env.XDG_CONFIG_HOME;
    if (oldXdgData)
        process.env.XDG_DATA_HOME = oldXdgData;
    else
        delete process.env.XDG_DATA_HOME;
    if (oldRelay)
        process.env.BACKPACK_APP_URL = oldRelay;
    else
        delete process.env.BACKPACK_APP_URL;
    await fs.rm(tmp, { recursive: true, force: true });
});
async function makeLocalBackpack(name: string): Promise<string> {
    const bpDir = path.join(tmp, name);
    await fs.mkdir(bpDir, { recursive: true });
    await fs.writeFile(path.join(tmp, ".config", "backpack", "backpacks.json"), JSON.stringify({ active: bpDir, paths: [bpDir] }), "utf8");
    await fs.writeFile(path.join(tmp, ".config", "backpack", "cli-context.json"), JSON.stringify({ source: "local", backpackPath: bpDir }), "utf8");
    return bpDir;
}
describe("bp ls", () => {
    it("rejects unknown resources with a helpful error and exits 1", async () => {
        const out = captureStdout();
        const err = captureStderr();
        const code = await run(["ls", "nope"]);
        out.restore();
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain('unknown resource "nope"');
    });
    it("on an empty local backpack, prints the empty message", async () => {
        await makeLocalBackpack("empty-bp");
        const out = captureStdout();
        const err = captureStderr();
        const code = await run(["ls"]);
        out.restore();
        err.restore();
        expect(code).toBe(0);
        expect(out.get()).toContain("no graphs in local:empty-bp");
    });
    it("--json on empty backpack returns { graphs: [] }", async () => {
        await makeLocalBackpack("empty-bp");
        const out = captureStdout();
        const code = await run(["ls", "--json"]);
        out.restore();
        expect(code).toBe(0);
        expect(JSON.parse(out.get())).toEqual({ graphs: [] });
    });
    it("--names on empty backpack produces no output", async () => {
        await makeLocalBackpack("empty-bp");
        const out = captureStdout();
        const code = await run(["ls", "--names"]);
        out.restore();
        expect(code).toBe(0);
        expect(out.get()).toBe("");
    });
    it("graphs list (canonical form) routes to the same handler", async () => {
        await makeLocalBackpack("empty-bp");
        const out = captureStdout();
        const code = await run(["graphs", "list", "--json"]);
        out.restore();
        expect(code).toBe(0);
        expect(JSON.parse(out.get())).toEqual({ graphs: [] });
    });
    it("singular `graph list` is also accepted", async () => {
        await makeLocalBackpack("empty-bp");
        const out = captureStdout();
        const code = await run(["graph", "list", "--json"]);
        out.restore();
        expect(code).toBe(0);
        expect(JSON.parse(out.get())).toEqual({ graphs: [] });
    });
});
describe("bp cat / show error paths", () => {
    it("bp cat with no name exits 1", async () => {
        const err = captureStderr();
        const code = await run(["cat"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("graph name required");
    });
    it("bp show with no name exits 1", async () => {
        const err = captureStderr();
        const code = await run(["show"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("graph name required");
    });
});
describe("bp search", () => {
    it("rejects an empty query", async () => {
        const err = captureStderr();
        const code = await run(["search"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("query required");
    });
});
describe("bp graphs sub-router", () => {
    it("rejects unknown verb", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "frobnicate"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain('unknown verb "frobnicate"');
    });
});
