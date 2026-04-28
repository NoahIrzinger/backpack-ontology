import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import type { Backpack } from "../../core/backpack.js";
import type { KBDocument } from "../../core/document-store.js";
import {
  createEnvelope,
  generateKeyPair,
  encrypt,
  encodeKeyForFragment,
  syncToRelay,
  createShareLink,
} from "../../sharing/index.js";

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
  // backpack_share — encrypt and upload to a relay
  server.registerTool(
    "backpack_share",
    {
      title: "Share Backpack",
      description:
        "Encrypt a backpack and upload it to a share relay. Returns a shareable link. " +
        "The decryption key is embedded in the URL fragment — it never reaches the server. " +
        "Recipients open the link in a browser and decrypt client-side.",
      inputSchema: {
        name: z.string().describe("Name of the backpack to share"),
        relayUrl: z
          .string()
          .default("https://app.backpackontology.com")
          .describe("Share relay URL"),
        relayToken: z
          .string()
          .describe("Bearer token for the relay (requires a backpack-app account)"),
        encrypted: z
          .boolean()
          .default(true)
          .describe("Encrypt the backpack before sharing (default: true)"),
      },
    },
    async ({ name, relayUrl, relayToken, encrypted }) => {
      const data = await backpack.loadOntology(name);

      // Load KB documents associated with this graph
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
        // No KB configured or inaccessible — share graph only
      }

      const shareData: SharePayloadV2 = { version: 2, graph: data, documents: kbDocs };
      const plaintext = new TextEncoder().encode(JSON.stringify(shareData));

      const stats = {
        node_count: data.nodes.length,
        edge_count: data.edges.length,
        node_types: [...new Set(data.nodes.map((n) => n.type))],
        document_count: kbDocs.length,
      };

      let payload: Uint8Array;
      let format: "plaintext" | "age-v1";
      let fragmentKey = "";

      if (encrypted) {
        const keyPair = await generateKeyPair();
        payload = await encrypt(plaintext, keyPair.publicKey);
        format = "age-v1";
        fragmentKey = encodeKeyForFragment(keyPair.secretKey);
      } else {
        payload = plaintext;
        format = "plaintext";
      }

      const graphCount = 1;
      const envelope = await createEnvelope(name, payload, format, graphCount, stats);

      const relayConfig = { url: relayUrl, token: relayToken };
      await syncToRelay(relayConfig, name, envelope);
      const result = await createShareLink(relayConfig, name);

      const shareLink = fragmentKey
        ? `${result.url}#k=${fragmentKey}`
        : result.url;

      let text = `Shared "${name}" successfully.\n\nShare link: ${shareLink}`;
      text += `\nGraph stats: ${stats.node_count} nodes, ${stats.edge_count} edges, ${stats.node_types.length} types`;
      if (stats.document_count > 0) {
        text += `\nKB documents: ${stats.document_count} included`;
      }
      if (result.expiresAt) {
        text += `\nExpires: ${result.expiresAt}`;
      }
      if (encrypted) {
        text +=
          "\n\nThe decryption key is in the link fragment (#k=...). " +
          "The server cannot read your data. " +
          "Anyone with the full link can view the backpack.";
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

  // backpack_share_local — export as a .bpak file
  server.registerTool(
    "backpack_share_local",
    {
      title: "Export Backpack",
      description:
        "Export a backpack as a .bpak file for offline sharing. " +
        "Optionally encrypt with age. Send the file by any channel " +
        "(email, USB, Signal). Recipient decrypts with the secret key.",
      inputSchema: {
        name: z.string().describe("Name of the backpack to export"),
        output: z.string().describe("Output file path (e.g., ./my-graph.bpak)"),
        encrypted: z
          .boolean()
          .default(true)
          .describe("Encrypt the export (default: true)"),
      },
    },
    async ({ name, output, encrypted }) => {
      const data = await backpack.loadOntology(name);

      // Load KB documents associated with this graph
      let kbDocs: Array<Omit<KBDocument, "collection">> = [];
      try {
        const docs = await backpack.documents();
        const result = await docs.list();
        const fullDocs = await Promise.all(
          result.documents
            .filter((d) => d.sourceGraphs.includes(name))
            .map(async (d) => {
              const full = await docs.read(d.id);
              const { collection: _, ...rest } = full;
              return rest;
            }),
        );
        kbDocs = fullDocs;
      } catch {
        // No KB configured
      }

      const shareData: SharePayloadV2 = { version: 2, graph: data, documents: kbDocs };
      const plaintext = new TextEncoder().encode(JSON.stringify(shareData));

      let payload: Uint8Array;
      let format: "plaintext" | "age-v1";
      let secretKey = "";

      if (encrypted) {
        const keyPair = await generateKeyPair();
        payload = await encrypt(plaintext, keyPair.publicKey);
        format = "age-v1";
        secretKey = keyPair.secretKey;
      } else {
        payload = plaintext;
        format = "plaintext";
      }

      const stats = { document_count: kbDocs.length };
      const envelope = await createEnvelope(name, payload, format, 1, stats);
      await writeFile(output, envelope);

      let text = `Exported "${name}" to ${output}`;
      if (kbDocs.length > 0) {
        text += ` (includes ${kbDocs.length} KB document${kbDocs.length > 1 ? "s" : ""})`;
      }
      if (encrypted) {
        text += `\n\nSecret key (needed to decrypt):\n${secretKey}`;
        text +=
          "\n\nRecipient opens with:\n" +
          `  backpack import ${output} --key <secret-key>`;
      }

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
