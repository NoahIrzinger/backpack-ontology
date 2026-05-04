import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import type { Backpack } from "../../core/backpack.js";
import type { KBDocument } from "../../core/document-store.js";
import {
  generateKeyPair,
  encrypt,
  encodeKeyForFragment,
  createShareLink,
} from "../../sharing/index.js";
import { assertSafeRelay } from "../../ops/auth.js";

/**
 * V2 share payload — includes both graph data and KB documents.
 * V1 payloads are raw LearningGraphData (no version field).
 * Readers detect v2 by checking for the `version` field.
 */
interface SharePayloadV2 {
  version: 2;
  graph: import("../../core/types.js").LearningGraphData;
  documents: Array<Omit<KBDocument, "collection">>;
}

export function registerShareTools(
  server: McpServer,
  backpack: Backpack,
): void {
  // backpack_share — push graph to cloud and return a public share link
  server.registerTool(
    "backpack_share",
    {
      title: "Share Graph",
      description:
        "Upload a local graph to the cloud and return a public share link. " +
        "The graph is stored plaintext on the server; anyone with the link can view it. " +
        "Requires a Backpack App account and bearer token.",
      inputSchema: {
        name: z.string().describe("Name of the local graph to share"),
        relayUrl: z
          .string()
          .default("https://app.backpackontology.com")
          .describe("Backpack App URL"),
        relayToken: z
          .string()
          .describe("Bearer token (requires a backpack-app account)"),
      },
    },
    async ({ name, relayUrl, relayToken }) => {
      assertSafeRelay(relayUrl);
      const data = await backpack.loadOntology(name);

      const pushRes = await fetch(
        `${relayUrl}/api/graphs/${encodeURIComponent(name)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${relayToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            description: data.metadata?.description ?? "",
            snapshot: data,
            events: [],
          }),
        },
      );

      if (!pushRes.ok && pushRes.status !== 409) {
        const body = await pushRes.text().catch(() => "");
        return {
          content: [{ type: "text" as const, text: `Failed to push graph to cloud (${pushRes.status}): ${body}` }],
          isError: true,
        };
      }

      const relayConfig = { url: relayUrl, token: relayToken };
      const result = await createShareLink(relayConfig, name);

      const stats = {
        node_count: data.nodes.length,
        edge_count: data.edges.length,
      };

      let text = `Shared "${name}" successfully.\n\nShare link: ${result.url}`;
      text += `\nGraph: ${stats.node_count} nodes, ${stats.edge_count} edges`;
      if (result.expiresAt) {
        text += `\nExpires: ${result.expiresAt}`;
      }

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // backpack_import_remote — download a cloud graph to local backpack
  server.registerTool(
    "backpack_import_remote",
    {
      title: "Import Cloud Graph to Local",
      description:
        "Download a graph from a Backpack cloud relay and save it locally. " +
        "The graph must be plaintext (not encrypted). Requires a Bearer token " +
        "for authentication with the relay. If a local graph with the same " +
        "name exists, it will be overwritten.",
      inputSchema: {
        name: z.string().describe("Name of the cloud graph to download"),
        relayUrl: z
          .string()
          .default("https://app.backpackontology.com")
          .describe("Cloud relay URL"),
        relayToken: z
          .string()
          .describe("Bearer token for the relay (requires a backpack-app account)"),
      },
    },
    async ({ name, relayUrl, relayToken }) => {
      assertSafeRelay(relayUrl);
      try {
        const resp = await fetch(
          `${relayUrl}/api/graphs/${encodeURIComponent(name)}`,
          {
            headers: { Authorization: `Bearer ${relayToken}` },
          },
        );
        if (!resp.ok) {
          const body = await resp.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching cloud graph "${name}": ${resp.status} ${resp.statusText}\n${body}`,
              },
            ],
            isError: true,
          };
        }

        const data = await resp.json();

        if (!data.nodes || !data.edges) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: the cloud graph "${name}" does not contain plaintext graph data (it may be encrypted).`,
              },
            ],
            isError: true,
          };
        }

        const exists = await backpack.ontologyExists(name);
        if (exists) {
          await backpack.deleteOntology(name);
        }

        await backpack.createOntologyFromData(name, data);

        return {
          content: [
            {
              type: "text" as const,
              text: `Imported cloud graph "${name}" to local backpack (${data.nodes.length} nodes, ${data.edges.length} edges).`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // backpack_share_local — export as a JSON file for offline sharing
  server.registerTool(
    "backpack_share_local",
    {
      title: "Export Graph to File",
      description:
        "Export a graph and its linked KB documents to a local JSON file for offline sharing. " +
        "Optionally age-encrypt the export. Send the file by any channel " +
        "(email, USB, Signal). Encrypted exports include the decryption key in the output.",
      inputSchema: {
        name: z.string().describe("Name of the graph to export"),
        output: z.string().describe("Output file path (e.g., ./my-graph.json)"),
        encrypted: z
          .boolean()
          .default(false)
          .describe("Age-encrypt the export (default: false)"),
      },
    },
    async ({ name, output, encrypted }) => {
      const data = await backpack.loadOntology(name);

      let kbDocs: Array<Omit<KBDocument, "collection">> = [];
      try {
        const docs = await backpack.documents();
        const result = await docs.list();
        kbDocs = await Promise.all(
          result.documents
            .filter((d) => d.sourceGraphs.includes(name))
            .map(async (d) => {
              const full = await docs.read(d.id);
              const { collection: _, ...rest } = full;
              return rest;
            }),
        );
      } catch {
        // No KB configured
      }

      const shareData: SharePayloadV2 = { version: 2, graph: data, documents: kbDocs };
      const plaintext = new TextEncoder().encode(JSON.stringify(shareData));

      let text = `Exported "${name}" to ${output}`;
      if (kbDocs.length > 0) {
        text += ` (includes ${kbDocs.length} KB document${kbDocs.length > 1 ? "s" : ""})`;
      }

      if (encrypted) {
        const keyPair = await generateKeyPair();
        const ciphertext = await encrypt(plaintext, keyPair.publicKey);
        await writeFile(output, ciphertext);
        text += `\n\nSecret key (needed to decrypt):\n${keyPair.secretKey}`;
        text += `\n\nEncoded as raw age ciphertext. Decrypt with:\n  age --decrypt -i <key-file> ${output}`;
      } else {
        await writeFile(output, plaintext);
      }

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
