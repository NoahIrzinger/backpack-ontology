import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../../src/cli/router.js";
import { setColorEnabled } from "../../src/cli/colors.js";
let tmp: string;
let oldHome: string | undefined;
let oldXdg: string | undefined;
let oldRelay: string | undefined;
let origFetch: typeof fetch;
interface MockKey {
    method: string;
    url: string;
}
interface MockResponse {
    status: number;
    body: unknown;
}
let responses: Map<string, MockResponse>;
function mockFetch() {
    origFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        const key = `${method} ${url}`;
        const r = responses.get(key);
        if (!r) {
            return new Response(`not mocked: ${key}`, { status: 599 });
        }
        if (r.status === 204 || r.status === 304) {
            return new Response(null, { status: r.status });
        }
        return new Response(JSON.stringify(r.body), {
            status: r.status,
            headers: { "content-type": "application/json" },
        });
    }) as unknown as typeof fetch;
}
function captureOut() {
    const buf: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
        buf.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    return { get: () => buf.join(""), restore: () => spy.mockRestore() };
}
function captureErr() {
    const buf: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s: any) => {
        buf.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    return { get: () => buf.join(""), restore: () => spy.mockRestore() };
}
beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bp-admin-"));
    oldHome = process.env.HOME;
    oldXdg = process.env.XDG_CONFIG_HOME;
    oldRelay = process.env.BACKPACK_APP_URL;
    process.env.HOME = tmp;
    process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
    process.env.BACKPACK_APP_URL = "https://relay.test";
    await fs.mkdir(path.join(tmp, ".config", "backpack", "extensions", "share"), { recursive: true });
    const payload = Buffer.from(JSON.stringify({ email: "u@x", exp: Date.now() / 1000 + 3600 })).toString("base64url");
    await fs.writeFile(path.join(tmp, ".config", "backpack", "extensions", "share", "settings.json"), JSON.stringify({ relay_token: `header.${payload}.sig` }), "utf8");
    responses = new Map();
    setColorEnabled(false);
    mockFetch();
});
afterEach(async () => {
    global.fetch = origFetch;
    if (oldHome)
        process.env.HOME = oldHome;
    else
        delete process.env.HOME;
    if (oldXdg)
        process.env.XDG_CONFIG_HOME = oldXdg;
    else
        delete process.env.XDG_CONFIG_HOME;
    if (oldRelay)
        process.env.BACKPACK_APP_URL = oldRelay;
    else
        delete process.env.BACKPACK_APP_URL;
    await fs.rm(tmp, { recursive: true, force: true });
});
describe("bp containers create", () => {
    it("requires a name", async () => {
        const err = captureErr();
        const code = await run(["containers", "create"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("name required");
    });
    it("happy path POSTs to /api/sync/register and prints success", async () => {
        responses.set("POST https://relay.test/api/sync/register", {
            status: 201,
            body: { id: "u1", name: "client-foo", origin_kind: "cloud", color: "#aabbcc" },
        });
        const out = captureOut();
        const code = await run(["containers", "create", "client-foo", "--color", "#aabbcc"]);
        out.restore();
        expect(code).toBe(0);
        expect(out.get()).toContain("created client-foo");
    });
});
describe("bp containers rename", () => {
    it("requires a name", async () => {
        const err = captureErr();
        const code = await run(["containers", "rename"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain("name required");
    });
    it("happy path", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [{ id: "u1", name: "old", origin_kind: "cloud" }] },
        });
        responses.set("PATCH https://relay.test/api/sync/backpacks/u1", {
            status: 200,
            body: { id: "u1", name: "new", origin_kind: "cloud" },
        });
        const out = captureOut();
        const code = await run(["containers", "rename", "old", "new"]);
        out.restore();
        expect(code).toBe(0);
        expect(out.get()).toContain("old → new");
    });
    it("errors out when the container doesn't exist", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [] },
        });
        const err = captureErr();
        const code = await run(["containers", "rename", "ghost", "nope"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toContain('container "ghost" not found');
    });
});
describe("bp containers delete --yes", () => {
    it("204 → success", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [{ id: "u2", name: "trash", origin_kind: "cloud" }] },
        });
        responses.set("DELETE https://relay.test/api/sync/backpacks/u2", { status: 204, body: null });
        const out = captureOut();
        const code = await run(["containers", "delete", "trash", "--yes"]);
        out.restore();
        expect(code).toBe(0);
        expect(out.get()).toContain("deleted container trash");
    });
    it("422 (still has artifacts) is surfaced as a friendly error", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [{ id: "u3", name: "busy", origin_kind: "cloud" }] },
        });
        responses.set("DELETE https://relay.test/api/sync/backpacks/u3", { status: 422, body: { error: "non-empty" } });
        const err = captureErr();
        const code = await run(["containers", "delete", "busy", "--yes"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/move them out first/);
    });
});
describe("bp graphs move --to", () => {
    it("requires --to", async () => {
        const err = captureErr();
        const code = await run(["graphs", "move", "foo"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/--to <container> required/);
    });
    it("happy path", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [{ id: "u4", name: "client-acme", origin_kind: "cloud" }] },
        });
        responses.set("POST https://relay.test/api/sync/backpacks/u4/move-graph", { status: 200, body: { ok: true } });
        const out = captureOut();
        const code = await run(["graphs", "move", "client-acme-graph", "--to", "client-acme"]);
        out.restore();
        expect(code).toBe(0);
        expect(out.get()).toMatch(/moved client-acme-graph.*client-acme/);
    });
    it("destination container missing → friendly error", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [] },
        });
        const err = captureErr();
        const code = await run(["graphs", "move", "x", "--to", "nope"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/destination container "nope" not found/);
    });
});
describe("bp kbs move --to", () => {
    it("requires --to", async () => {
        const err = captureErr();
        const code = await run(["kbs", "move", "doc-1"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/--to <container> required/);
    });
    it("happy path", async () => {
        responses.set("GET https://relay.test/api/sync/backpacks", {
            status: 200,
            body: { backpacks: [{ id: "u9", name: "client-foo", origin_kind: "cloud" }] },
        });
        responses.set("POST https://relay.test/api/sync/backpacks/u9/move-kb", { status: 200, body: { ok: true } });
        const out = captureOut();
        const code = await run(["kbs", "move", "doc-1", "--to", "client-foo"]);
        out.restore();
        expect(code).toBe(0);
        expect(out.get()).toMatch(/moved doc-1.*client-foo/);
    });
});
describe("color validation", () => {
    it("rejects --color values that aren't #RRGGBB", async () => {
        const err = captureErr();
        const code = await run(["containers", "create", "x", "--color", "rgb(0,0,0)"]);
        err.restore();
        expect(code).toBe(1);
        expect(err.get()).toMatch(/must be #RRGGBB/);
    });
    it("accepts a valid #RRGGBB color (POST is mocked)", async () => {
        responses.set("POST https://relay.test/api/sync/register", {
            status: 201,
            body: { id: "u-color", name: "x", origin_kind: "cloud", color: "#aabbcc" },
        });
        const code = await run(["containers", "create", "x", "--color", "#aabbcc"]);
        expect(code).toBe(0);
    });
});
describe("container create idempotency", () => {
    it("status 200 → reports already exists, status 201 → reports created", async () => {
        responses.set("POST https://relay.test/api/sync/register", {
            status: 200,
            body: { id: "u-pre", name: "pre", origin_kind: "cloud" },
        });
        const out1 = captureOut();
        const code1 = await run(["containers", "create", "pre"]);
        out1.restore();
        expect(code1).toBe(0);
        expect(out1.get()).toMatch(/already exists, no change to/);
    });
});
