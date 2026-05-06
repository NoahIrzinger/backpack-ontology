import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { trackEvent } from "../../core/telemetry.js";
import { PACKAGE_NAME, PACKAGE_VERSION, MCP_SDK_VERSION } from "../../core/version.js";

export interface ServerInfo {
  mode: "local" | "app";
}

export function registerServerInfoTools(server: McpServer, info: ServerInfo): void {
  server.registerTool(
    "backpack_version",
    {
      title: "Backpack MCP Server Info",
      description:
        "Report the running MCP server's version and runtime context. Useful for diagnosing version skew between clients (claude.ai, claude-code, Cursor) and the deployed server.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      trackEvent("tool_call", { tool: "backpack_version" });
      const payload = {
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        mode: info.mode,
        mcpSdkVersion: MCP_SDK_VERSION,
        node: process.version,
        host: process.env.BACKPACK_SERVER_NAME || null,
        hostGitSha: process.env.BACKPACK_SERVER_GIT_SHA || null,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
