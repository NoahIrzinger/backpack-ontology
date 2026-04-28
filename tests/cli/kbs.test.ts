import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../../src/cli/router.js";
import { setColorEnabled } from "../../src/cli/colors.js";
let tmp: string;
let oldHome: string | undefined;
let oldXdg: string | undefined;
function captureErr() {
    const buf: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s: any) => {
        buf.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    return { get: () => buf.join(""), restore: () => spy.mockRestore() };
}
beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bp-kbs-"));
    oldHome = process.env.HOME;
    oldXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = tmp;
    process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
    await fs.mkdir(path.join(tmp, ".config", "backpack"), { recursive: true });
    setColorEnabled(false);
});
afterEach(async () => {
    if (oldHome !== undefined)
        process.env.HOME = oldHome;
    else
        delete process.env.HOME;
    if (oldXdg !== undefined)
        process.env.XDG_CONFIG_HOME = oldXdg;
    else
        delete process.env.XDG_CONFIG_HOME;
    await fs.rm(tmp, { recursive: true, force: true });
});
describe("bp kbs verb routing", () => {
    it("rejects unknown verbs with the full list of options", async () => {
        const err = captureErr();
        const code = await run(["kbs", "frobnicate"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("list, get, create, edit, delete, or move");
    });
});
describe("bp kbs create argument validation", () => {
    it("without -f or --title exits 1", async () => {
        const err = captureErr();
        const code = await run(["kbs", "create"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/pass either -f.*or --title/);
    });
    it("--title without --content exits 1 (when no -f)", async () => {
        const err = captureErr();
        const code = await run(["kbs", "create", "--title", "foo"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/--content is required/);
    });
    it("missing -f file produces a clear error", async () => {
        const err = captureErr();
        const code = await run(["kbs", "create", "-f", "/no/such/file.md"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/could not read|ENOENT/);
    });
});
describe("bp kbs create flag conflicts", () => {
    it("rejects both -f and --content together", async () => {
        const f = path.join(tmp, "doc.md");
        await fs.writeFile(f, "body", "utf8");
        const err = captureErr();
        const code = await run(["kbs", "create", "-f", f, "--content", "also"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("not both");
    });
});
describe("bp kbs delete argument validation", () => {
    it("without id exits 1", async () => {
        const err = captureErr();
        const code = await run(["kbs", "delete"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("doc id required");
    });
});
describe("bp kbs edit argument validation", () => {
    it("without id exits 1", async () => {
        const err = captureErr();
        const code = await run(["kbs", "edit"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("doc id required");
    });
});
