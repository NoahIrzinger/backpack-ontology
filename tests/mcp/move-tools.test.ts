import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Backpack } from "../../src/core/backpack.js";
import { JsonFileBackend } from "../../src/storage/json-file-backend.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMoveTools } from "../../src/mcp/tools/move-tools.js";

let tmpDir: string;
let backpack: Backpack;
let server: McpServer;
let oldToken: string | undefined;
let oldUrl: string | undefined;

interface RegisteredTool {
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

function getTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`tool "${name}" not registered`);
  return tool;
}

async function call(server: McpServer, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean }> {
  const tool = getTool(server, name);
  const res = await tool.handler(args);
  return { text: res.content[0].text, isError: res.isError };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-move-tools-"));
  oldToken = process.env.BACKPACK_TOKEN;
  oldUrl = process.env.BACKPACK_APP_URL;
  delete process.env.BACKPACK_TOKEN;
  delete process.env.BACKPACK_APP_URL;
  const backend = new JsonFileBackend(undefined, { graphsDirOverride: tmpDir });
  await backend.initialize();
  backpack = new Backpack(backend);
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerMoveTools(server, backpack);
});

afterEach(async () => {
  if (oldToken !== undefined) process.env.BACKPACK_TOKEN = oldToken;
  else delete process.env.BACKPACK_TOKEN;
  if (oldUrl !== undefined) process.env.BACKPACK_APP_URL = oldUrl;
  else delete process.env.BACKPACK_APP_URL;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("backpack_move_to_cloud", () => {
  it("rejects when BACKPACK_TOKEN is not set", async () => {
    await backpack.createOntology("graph-a", "test");
    const res = await call(server, "backpack_move_to_cloud", { graphName: "graph-a" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/BACKPACK_TOKEN/);
  });

  it("rejects when local graph does not exist", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    const res = await call(server, "backpack_move_to_cloud", { graphName: "missing" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/i);
  });

  it("pushes graph to cloud and deletes local copy by default", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    process.env.BACKPACK_APP_URL = "https://test.example";
    await backpack.createOntology("graph-b", "test");
    let receivedUrl = "";
    let receivedAuth = "";
    let receivedBody: unknown = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      receivedUrl = String(url);
      receivedAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      receivedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 200 });
    });
    try {
      const res = await call(server, "backpack_move_to_cloud", { graphName: "graph-b" });
      expect(res.isError).toBeFalsy();
      expect(res.text).toMatch(/Moved "graph-b"/);
      expect(res.text).toMatch(/local copy deleted/);
      expect(receivedUrl).toBe("https://test.example/api/graphs/graph-b/events");
      expect(receivedAuth).toBe("Bearer test-token");
      expect((receivedBody as { name: string }).name).toBe("graph-b");
      expect(await backpack.ontologyExists("graph-b")).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps local copy when keepLocal is true", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    await backpack.createOntology("graph-c", "test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 200 }));
    try {
      const res = await call(server, "backpack_move_to_cloud", { graphName: "graph-c", keepLocal: true });
      expect(res.isError).toBeFalsy();
      expect(res.text).toMatch(/local copy kept/);
      expect(await backpack.ontologyExists("graph-c")).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("surfaces cloud HTTP errors and keeps the local copy intact", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    await backpack.createOntology("graph-d", "test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("forbidden", { status: 403 }));
    try {
      const res = await call(server, "backpack_move_to_cloud", { graphName: "graph-d" });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/Cloud push failed.*403/);
      expect(await backpack.ontologyExists("graph-d")).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects insecure relay URLs without override", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    process.env.BACKPACK_APP_URL = "http://evil.example";
    await backpack.createOntology("graph-e", "test");
    await expect(call(server, "backpack_move_to_cloud", { graphName: "graph-e" })).rejects.toThrow(/non-HTTPS/);
  });
});

describe("backpack_export_from_cloud", () => {
  it("rejects when BACKPACK_TOKEN is not set", async () => {
    const res = await call(server, "backpack_export_from_cloud", { graphName: "any" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/BACKPACK_TOKEN/);
  });

  it("rejects when a local graph with the same name already exists", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    await backpack.createOntology("graph-f", "test");
    const res = await call(server, "backpack_export_from_cloud", { graphName: "graph-f" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/already exists/);
  });

  it("uses asLocalName to resolve a name conflict", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    await backpack.createOntology("graph-g", "test");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        metadata: { name: "graph-g", description: "from cloud", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
        nodes: [{ id: "n1", type: "Thing", properties: { label: "x" }, createdAt: "x", updatedAt: "x" }],
        edges: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    try {
      const res = await call(server, "backpack_export_from_cloud", { graphName: "graph-g", asLocalName: "graph-g-fork" });
      expect(res.isError).toBeFalsy();
      expect(res.text).toMatch(/Exported "graph-g".*"graph-g-fork"/);
      expect(await backpack.ontologyExists("graph-g-fork")).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("surfaces 404 cleanly when the cloud graph is missing", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    try {
      const res = await call(server, "backpack_export_from_cloud", { graphName: "ghost" });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/not found/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("creates a local fork from a cloud snapshot", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    const cloudPayload = {
      metadata: { name: "graph-h", description: "live", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
      nodes: [
        { id: "a", type: "Thing", properties: { label: "alpha" }, createdAt: "x", updatedAt: "x" },
        { id: "b", type: "Thing", properties: { label: "beta" }, createdAt: "x", updatedAt: "x" },
      ],
      edges: [{ id: "e1", type: "RELATES_TO", sourceId: "a", targetId: "b", properties: {}, createdAt: "x", updatedAt: "x" }],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(cloudPayload), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    try {
      const res = await call(server, "backpack_export_from_cloud", { graphName: "graph-h" });
      expect(res.isError).toBeFalsy();
      expect(res.text).toMatch(/2 nodes, 1 edges/);
      const local = await backpack.loadOntology("graph-h");
      expect(local.nodes.length).toBe(2);
      expect(local.edges.length).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects malformed cloud payloads", async () => {
    process.env.BACKPACK_TOKEN = "test-token";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ encrypted: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    try {
      const res = await call(server, "backpack_export_from_cloud", { graphName: "encrypted-graph" });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/unexpected payload/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
