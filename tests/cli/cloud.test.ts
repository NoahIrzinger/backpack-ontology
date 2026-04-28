import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listGraphs, getGraph, searchGraphs } from "../../src/ops/graphs.js";
import { listContainers } from "../../src/ops/containers.js";
import { listKB, getKB } from "../../src/ops/kb.js";
let tmp: string;
let origFetch: typeof fetch;
let origHome: string | undefined;
let origXdg: string | undefined;
let origRelay: string | undefined;
interface MockResponse {
    status: number;
    body: unknown;
}
let mockResponses: Record<string, MockResponse> = {};
function installMockFetch() {
    origFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? input : input.toString();
        const m = mockResponses[url];
        if (!m) {
            return new Response("not mocked: " + url, { status: 599 });
        }
        return new Response(JSON.stringify(m.body), {
            status: m.status,
            headers: { "content-type": "application/json" },
        });
    }) as unknown as typeof fetch;
}
function restoreFetch() {
    global.fetch = origFetch;
    mockResponses = {};
}
beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bp-cloud-"));
    origHome = process.env.HOME;
    origXdg = process.env.XDG_CONFIG_HOME;
    origRelay = process.env.BACKPACK_APP_URL;
    process.env.HOME = tmp;
    process.env.XDG_CONFIG_HOME = path.join(tmp, ".config");
    process.env.BACKPACK_APP_URL = "https://relay.test";
    await fs.mkdir(path.join(tmp, ".config", "backpack", "extensions", "share"), { recursive: true });
    const payload = Buffer.from(JSON.stringify({ email: "u@x", exp: Date.now() / 1000 + 3600 })).toString("base64url");
    const fakeToken = `header.${payload}.sig`;
    await fs.writeFile(path.join(tmp, ".config", "backpack", "extensions", "share", "settings.json"), JSON.stringify({ relay_token: fakeToken }), "utf8");
    await fs.writeFile(path.join(tmp, ".config", "backpack", "cli-context.json"), JSON.stringify({ source: "cloud" }), "utf8");
    installMockFetch();
});
afterEach(async () => {
    restoreFetch();
    if (origHome)
        process.env.HOME = origHome;
    else
        delete process.env.HOME;
    if (origXdg)
        process.env.XDG_CONFIG_HOME = origXdg;
    else
        delete process.env.XDG_CONFIG_HOME;
    if (origRelay)
        process.env.BACKPACK_APP_URL = origRelay;
    else
        delete process.env.BACKPACK_APP_URL;
    await fs.rm(tmp, { recursive: true, force: true });
});
describe("cloud listGraphs", () => {
    it("happy path: maps relay rows into GraphSummary", async () => {
        mockResponses["https://relay.test/api/graphs"] = {
            status: 200,
            body: [
                { id: "1", name: "alpha", nodeCount: 5, edgeCount: 7, sourceBackpack: "projects" },
                { id: "2", name: "beta", nodeCount: 0, edgeCount: 0, encrypted: true, sourceBackpack: "personal" },
            ],
        };
        const got = await listGraphs();
        expect(got).toHaveLength(2);
        expect(got[0]).toMatchObject({ name: "alpha", origin: "cloud", encrypted: undefined });
        expect(got[1]).toMatchObject({ name: "beta", encrypted: true });
    });
    it("filters by active container when set", async () => {
        await fs.writeFile(path.join(tmp, ".config", "backpack", "cli-context.json"), JSON.stringify({ source: "cloud", cloudContainer: "projects" }), "utf8");
        mockResponses["https://relay.test/api/graphs"] = {
            status: 200,
            body: [
                { name: "alpha", sourceBackpack: "projects" },
                { name: "beta", sourceBackpack: "personal" },
            ],
        };
        const got = await listGraphs();
        expect(got.map((g) => g.name)).toEqual(["alpha"]);
    });
    it("does NOT match graphs with missing sourceBackpack when filter is set", async () => {
        await fs.writeFile(path.join(tmp, ".config", "backpack", "cli-context.json"), JSON.stringify({ source: "cloud", cloudContainer: "projects" }), "utf8");
        mockResponses["https://relay.test/api/graphs"] = {
            status: 200,
            body: [{ name: "stray" }, { name: "alpha", sourceBackpack: "projects" }],
        };
        const got = await listGraphs();
        expect(got.map((g) => g.name)).toEqual(["alpha"]);
    });
    it("401 surfaces a friendly error", async () => {
        mockResponses["https://relay.test/api/graphs"] = { status: 401, body: { error: "expired" } };
        await expect(listGraphs()).rejects.toThrow(/cloud session expired/);
    });
    it("non-array body becomes empty list (defensive against schema drift)", async () => {
        mockResponses["https://relay.test/api/graphs"] = { status: 200, body: { graphs: [] } };
        const got = await listGraphs();
        expect(got).toEqual([]);
    });
});
describe("cloud getGraph (tagged result)", () => {
    it("returns { kind: 'ok' } on a real graph", async () => {
        mockResponses["https://relay.test/api/graphs/alpha"] = {
            status: 200,
            body: { metadata: { name: "alpha" }, nodes: [], edges: [] },
        };
        const r = await getGraph("alpha");
        expect(r.kind).toBe("ok");
    });
    it("returns { kind: 'missing' } on 404", async () => {
        mockResponses["https://relay.test/api/graphs/gone"] = { status: 404, body: { error: "nope" } };
        const r = await getGraph("gone");
        expect(r.kind).toBe("missing");
    });
    it("returns { kind: 'encrypted' } when the body is null", async () => {
        mockResponses["https://relay.test/api/graphs/enc"] = { status: 200, body: null };
        const r = await getGraph("enc");
        expect(r.kind).toBe("encrypted");
    });
    it("surfaces 401 as cloud-session-expired", async () => {
        mockResponses["https://relay.test/api/graphs/x"] = { status: 401, body: { error: "x" } };
        await expect(getGraph("x")).rejects.toThrow(/cloud session expired/);
    });
});
describe("cloud searchGraphs", () => {
    it("ignores whitespace-only queries (the P0 bug)", async () => {
        mockResponses["https://relay.test/api/graphs"] = { status: 200, body: [{ name: "a", nodeCount: 1 }] };
        const r = await searchGraphs("   ");
        expect(r.hits).toEqual([]);
        expect(r.graphsScanned).toBe(0);
    });
    it("caps total graphs scanned and reports truncated=true", async () => {
        const many = Array.from({ length: 60 }, (_, i) => ({ name: `g${i}`, nodeCount: 0, edgeCount: 0 }));
        mockResponses["https://relay.test/api/graphs"] = { status: 200, body: many };
        for (const g of many) {
            mockResponses[`https://relay.test/api/graphs/${g.name}`] = { status: 200, body: { nodes: [], edges: [] } };
        }
        const r = await searchGraphs("foo", { maxGraphs: 10 });
    expect(r.graphsInScope).toBe(60);
    expect(r.graphsScanned).toBe(10);
    expect(r.truncated).toBe(true);
  });
});

describe("cloud listContainers", () => {
  it("happy path", async () => {
    mockResponses["https://relay.test/api/sync/backpacks"] = {
      status: 200,
      body: { backpacks: [{ id: "u1", name: "projects", origin_kind: "cloud" }] },
    };
    const got = await listContainers();
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("projects");
  });

  it("401 surfaces friendly error", async () => {
    mockResponses["https://relay.test/api/sync/backpacks"] = { status: 401, body: {} };
    await expect(listContainers()).rejects.toThrow(/cloud session expired/);
  });

  it("missing 'backpacks' field defaults to empty list", async () => {
    mockResponses["https://relay.test/api/sync/backpacks"] = { status: 200, body: {} };
    const got = await listContainers();
    expect(got).toEqual([]);
  });
});

describe("cloud listKB / getKB", () => {
  it("listKB happy path", async () => {
    mockResponses["https://relay.test/api/kb/documents?limit=1000"] = {
      status: 200,
      body: { documents: [{ id: "doc1", title: "Doc 1", sourceGraphs: [] }] },
    };
    const got = await listKB();
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe("Doc 1");
  });

  it("listKB returns [] on 404 (KB endpoint not exposed)", async () => {
    mockResponses["https://relay.test/api/kb/documents?limit=1000"] = { status: 404, body: {} };
    const got = await listKB();
    expect(got).toEqual([]);
  });

  it("getKB returns null on 404", async () => {
    mockResponses["https://relay.test/api/kb/documents/missing"] = { status: 404, body: {} };
    const got = await getKB("missing");
    expect(got).toBeNull();
  });
});
