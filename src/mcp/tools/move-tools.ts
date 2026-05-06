import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { resolveCloudToken, getRelayUrl, assertSafeRelay } from "../../ops/auth.js";

export function registerMoveTools(server: McpServer, backpack: Backpack): void {
  server.registerTool(
    "backpack_move_to_cloud",
    {
      title: "Move Graph to Backpack App Cloud",
      description:
        "Push a local graph to Backpack App as a one-shot snapshot, then delete the local copy " +
        "(default) or keep it as a frozen archive. Cloud becomes the canonical home for the graph; " +
        "no ongoing sync. Requires BACKPACK_TOKEN env var (and optional BACKPACK_APP_URL). " +
        "Use backpack_export_from_cloud for the reverse one-shot fork.",
      inputSchema: {
        graphName: z.string().describe("Name of the local graph to move."),
        keepLocal: z
          .boolean()
          .default(false)
          .describe(
            "If true, keep the local copy as a frozen archive after the push (default false: delete local, cloud is canonical).",
          ),
      },
    },
    async ({ graphName, keepLocal }) => {
      trackEvent("tool_call", { tool: "backpack_move_to_cloud" });
      const token = await resolveCloudToken();
      if (!token) {
        return {
          content: [
            {
              type: "text" as const,
              text: "BACKPACK_TOKEN env var required to move a graph to cloud. Set it to a Backpack App bearer token.",
            },
          ],
          isError: true,
        };
      }
      let data;
      try {
        data = await backpack.loadOntology(graphName);
      } catch {
        return {
          content: [
            { type: "text" as const, text: `Local graph "${graphName}" not found.` },
          ],
          isError: true,
        };
      }
      const relayUrl = getRelayUrl();
      assertSafeRelay(relayUrl);
      const pushUrl = `${relayUrl}/api/graphs/${encodeURIComponent(graphName)}/events`;
      const res = await fetch(pushUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: graphName,
          description: data.metadata?.description ?? "",
          snapshot: data,
          events: [],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          content: [
            {
              type: "text" as const,
              text: `Cloud push failed (HTTP ${res.status}): ${body}`,
            },
          ],
          isError: true,
        };
      }
      let localStatus: string;
      if (keepLocal) {
        localStatus = `local copy kept as a frozen archive`;
      } else {
        try {
          await backpack.deleteOntology(graphName);
          localStatus = `local copy deleted`;
        } catch (err) {
          localStatus = `local copy retained (delete failed: ${(err as Error).message})`;
        }
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Moved "${graphName}" to ${relayUrl}. ` +
              `${data.nodes.length} nodes, ${data.edges.length} edges. ` +
              `${localStatus}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "backpack_export_from_cloud",
    {
      title: "Export Graph from Backpack App Cloud",
      description:
        "Pull a graph from Backpack App as a one-shot snapshot and save it locally as a new graph. " +
        "Creates a fork: edits to the local copy do not sync back to cloud. " +
        "Requires BACKPACK_TOKEN env var (and optional BACKPACK_APP_URL).",
      inputSchema: {
        graphName: z.string().describe("Name of the cloud graph to export."),
        asLocalName: z
          .string()
          .optional()
          .describe("Local name for the exported graph (defaults to the cloud graph name)."),
      },
    },
    async ({ graphName, asLocalName }) => {
      trackEvent("tool_call", { tool: "backpack_export_from_cloud" });
      const token = await resolveCloudToken();
      if (!token) {
        return {
          content: [
            {
              type: "text" as const,
              text: "BACKPACK_TOKEN env var required to export a graph from cloud. Set it to a Backpack App bearer token.",
            },
          ],
          isError: true,
        };
      }
      const localName = asLocalName || graphName;
      const exists = await backpack.ontologyExists(localName);
      if (exists) {
        return {
          content: [
            {
              type: "text" as const,
              text: `A local graph named "${localName}" already exists. Pass asLocalName to use a different local name, or delete the local one first.`,
            },
          ],
          isError: true,
        };
      }
      const relayUrl = getRelayUrl();
      assertSafeRelay(relayUrl);
      const fetchUrl = `${relayUrl}/api/graphs/${encodeURIComponent(graphName)}`;
      const res = await fetch(fetchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 404) {
          return {
            content: [
              { type: "text" as const, text: `Cloud graph "${graphName}" not found.` },
            ],
            isError: true,
          };
        }
        const body = await res.text().catch(() => "");
        return {
          content: [
            {
              type: "text" as const,
              text: `Cloud fetch failed (HTTP ${res.status}): ${body}`,
            },
          ],
          isError: true,
        };
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.nodes)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Cloud graph "${graphName}" returned an unexpected payload (may be encrypted or malformed).`,
            },
          ],
          isError: true,
        };
      }
      await backpack.createOntologyFromData(localName, data);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Exported "${graphName}" from ${relayUrl} to local graph "${localName}". ` +
              `${data.nodes.length} nodes, ${data.edges?.length ?? 0} edges. ` +
              `This is a frozen fork; edits stay local.`,
          },
        ],
      };
    },
  );
}
