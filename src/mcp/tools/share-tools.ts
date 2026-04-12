import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import type { Backpack } from "../../core/backpack.js";
import {
  createEnvelope,
  generateKeyPair,
  encrypt,
  encodeKeyForFragment,
  uploadToRelay,
} from "../../sharing/index.js";

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
        passphrase: z
          .string()
          .optional()
          .describe("Optional passphrase for additional protection"),
      },
    },
    async ({ name, relayUrl, relayToken, encrypted, passphrase }) => {
      const data = await backpack.loadOntology(name);
      const plaintext = new TextEncoder().encode(JSON.stringify(data));

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
      const envelope = await createEnvelope(name, payload, format, graphCount);

      const result = await uploadToRelay(
        { url: relayUrl, token: relayToken },
        envelope,
        passphrase,
      );

      const shareLink = fragmentKey
        ? `${result.url}#k=${fragmentKey}`
        : result.url;

      let text = `Shared "${name}" successfully.\n\nShare link: ${shareLink}`;
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
        output: z.string().describe("Output file path (e.g., ./chester.bpak)"),
        encrypted: z
          .boolean()
          .default(true)
          .describe("Encrypt the export (default: true)"),
      },
    },
    async ({ name, output, encrypted }) => {
      const data = await backpack.loadOntology(name);
      const plaintext = new TextEncoder().encode(JSON.stringify(data));

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

      const envelope = await createEnvelope(name, payload, format, 1);
      await writeFile(output, envelope);

      let text = `Exported "${name}" to ${output}`;
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
