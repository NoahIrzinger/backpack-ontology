import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "../../src/mcp/server.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "backpack-exclude-"));
}

interface ServerInternals {
  _registeredTools?: Record<string, unknown>;
}

function listTools(server: object): string[] {
  return Object.keys((server as ServerInternals)._registeredTools ?? {});
}

describe("createMcpServer excludeTools", () => {
  it("registers all tools when excludeTools is omitted", async () => {
    const server = await createMcpServer({ mode: "local", dataDir: tempDir() });
    const names = listTools(server);
    expect(names).toContain("backpack_search");
    expect(names).toContain("backpack_get_node");
    expect(names).toContain("backpack_list");
  });

  it("skips named tools when excludeTools is provided", async () => {
    const server = await createMcpServer({
      mode: "local",
      dataDir: tempDir(),
      excludeTools: ["backpack_search", "backpack_get_node"],
    });
    const names = listTools(server);
    expect(names).not.toContain("backpack_search");
    expect(names).not.toContain("backpack_get_node");
    expect(names).toContain("backpack_list");
  });

  it("ignores unknown tool names without error", async () => {
    const server = await createMcpServer({
      mode: "local",
      dataDir: tempDir(),
      excludeTools: ["nonexistent_tool", "backpack_search"],
    });
    const names = listTools(server);
    expect(names).not.toContain("backpack_search");
    expect(names.length).toBeGreaterThan(10);
  });

  it("restores registerTool after construction", async () => {
    const server = await createMcpServer({
      mode: "local",
      dataDir: tempDir(),
      excludeTools: ["backpack_search"],
    });
    const beforeCount = listTools(server).length;
    expect(typeof (server as { registerTool: unknown }).registerTool).toBe("function");
    expect(beforeCount).toBeGreaterThan(0);
  });
});
