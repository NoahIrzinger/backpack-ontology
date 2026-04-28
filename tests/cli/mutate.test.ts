import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../../src/cli/router.js";
import { setColorEnabled } from "../../src/cli/colors.js";
let tmp: string;
let oldHome: string | undefined;
let oldXdg: string | undefined;
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
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bp-mutate-"));
    oldHome = process.env.HOME;
    oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = tmp;
    process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
    await fs.mkdir(path.join(tmp, ".config", "backpack"), { recursive: true });
    setColorEnabled(false);
});
afterEach(async () => {
    if (oldHome)
        process.env.HOME = oldHome;
    else
        delete process.env.HOME;
    if (oldXdg)
        process.env.XDG_CONFIG_HOME = oldXdg;
    else
        delete process.env.XDG_CONFIG_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
});
describe("bp graphs create / rm / mv argument validation", () => {
    it("create with no name exits 1", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "create"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("name required");
    });
    it("rename without both args exits 1", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "rename", "only-old"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("old + new names required");
    });
    it("rename with same name exits 1", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "rename", "same", "same"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("same");
    });
    it("apply without -f exits 1", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "apply"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("-f <file> required");
    });
    it("edit with no name exits 1", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "edit"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("name required");
    });
    it("delete without name exits 1", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "delete"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("name required");
    });
});
describe("bp rm/mv shortcuts", () => {
    it("rm shortcut maps to runDelete", async () => {
        const err = captureStderr();
        const code = await run(["rm"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("name required");
    });
    it("mv shortcut maps to runRename", async () => {
        const err = captureStderr();
        const code = await run(["mv", "only-old"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("old + new names required");
    });
});
describe("bp graphs apply name-mismatch guard", () => {
    it("rejects when CLI name argument disagrees with file metadata.name", async () => {
        const f = path.join(tmp, "mismatch.json");
        await fs.writeFile(f, JSON.stringify({
            metadata: { name: "qux", description: "" },
            nodes: [],
            edges: [],
        }), "utf8");
        const err = captureStderr();
        const code = await run(["graphs", "apply", "foo", "-f", f]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/name mismatch/);
    });
});
describe("bp graphs apply -f reads from a file", () => {
    it("rejects a missing file with a clear error", async () => {
        const err = captureStderr();
        const code = await run(["graphs", "apply", "-f", "/nonexistent/foo.json"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/could not read|ENOENT/);
    });
    it("rejects malformed JSON with a clear error", async () => {
        const f = path.join(tmp, "bad.json");
        await fs.writeFile(f, "{not json", "utf8");
        const err = captureStderr();
        const code = await run(["graphs", "apply", "-f", f]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/could not read|JSON/);
    });
});
