import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { addKBMount, removeKBMount } from "../../core/backpacks-registry.js";

export function registerKBTools(
  server: McpServer,
  backpack: Backpack,
): void {

  server.registerTool(
    "backpack_kb_save",
    {
      title: "Save KB Document",
      description:
        "Save a document to the knowledge base. Documents are markdown with metadata (tags, source graphs, source nodes). Use this to persist synthesis outputs, reports, analyses, or any derived artifact. Provide an id to update an existing document.",
      inputSchema: {
        title: z.string().describe("Document title"),
        content: z.string().describe("Markdown content (body only, no frontmatter)"),
        tags: z.array(z.string()).optional().describe("Tags for organizing and searching"),
        sourceGraphs: z.array(z.string()).optional().describe("Learning graphs that informed this document"),
        sourceNodeIds: z.array(z.string()).optional().describe("Specific node IDs that informed this document"),
        id: z.string().optional().describe("Document ID (omit for new, provide to update existing)"),
        collection: z.string().optional().describe("Which KB mount to save to (defaults to primary writable mount)"),
      },
    },
    async ({ title, content, tags, sourceGraphs, sourceNodeIds, id, collection }) => {
      try {
        const docs = await backpack.documents();
        const doc = await docs.save({
          title,
          content,
          tags: tags as string[] | undefined,
          sourceGraphs: sourceGraphs as string[] | undefined,
          sourceNodeIds: sourceNodeIds as string[] | undefined,
          id: id as string | undefined,
          collection: collection as string | undefined,
        });
        trackEvent("tool_call", { tool: "backpack_kb_save" });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: doc.id,
              title: doc.title,
              collection: doc.collection,
              tags: doc.tags,
              sourceGraphs: doc.sourceGraphs,
              createdAt: doc.createdAt,
              updatedAt: doc.updatedAt,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_list",
    {
      title: "List KB Documents",
      description: "List documents in the knowledge base. Aggregates across all KB mounts, or filter by collection.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        collection: z.string().optional().describe("Filter to a specific KB mount (omit for all)"),
        limit: z.number().int().optional().describe("Maximum documents to return (pagination)"),
        offset: z.number().int().optional().describe("Number of documents to skip (pagination)"),
      },
    },
    async ({ collection, limit, offset }) => {
      try {
        const docs = await backpack.documents();
        const list = await docs.list({
          collection: collection as string | undefined,
          limit: limit as number | undefined,
          offset: offset as number | undefined,
        });
        trackEvent("tool_call", { tool: "backpack_kb_list" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_read",
    {
      title: "Read KB Document",
      description: "Read the full content of a knowledge base document by ID.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().describe("Document ID"),
      },
    },
    async ({ id }) => {
      try {
        const docs = await backpack.documents();
        const doc = await docs.read(id);
        trackEvent("tool_call", { tool: "backpack_kb_read" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(doc, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_delete",
    {
      title: "Delete KB Document",
      description: "Delete a document from the knowledge base. Cannot delete from read-only mounts.",
      inputSchema: {
        id: z.string().describe("Document ID to delete"),
      },
    },
    async ({ id }) => {
      try {
        const docs = await backpack.documents();
        await docs.delete(id);
        trackEvent("tool_call", { tool: "backpack_kb_delete" });
        return {
          content: [{ type: "text" as const, text: `Document "${id}" deleted.` }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_search",
    {
      title: "Search KB Documents",
      description: "Search documents by text query across title, tags, and content. Optionally filter by collection.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().describe("Search query (case-insensitive substring match)"),
        collection: z.string().optional().describe("Filter to a specific KB mount"),
        limit: z.number().int().optional().describe("Maximum results to return (pagination)"),
        offset: z.number().int().optional().describe("Number of results to skip (pagination)"),
      },
    },
    async ({ query, collection, limit, offset }) => {
      try {
        const docs = await backpack.documents();
        const results = await docs.search(query, {
          collection: collection as string | undefined,
          limit: limit as number | undefined,
          offset: offset as number | undefined,
        });
        trackEvent("tool_call", { tool: "backpack_kb_search" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_ingest",
    {
      title: "Ingest KB Document",
      description:
        "Read a document from the KB (by ID) or from an arbitrary file path, and return its content formatted for mining into a learning graph. Use this to feed existing documents back into the mine → graph → synthesize cycle.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        id: z.string().optional().describe("Document ID to ingest from the KB"),
        path: z.string().optional().describe("Arbitrary file path to ingest (e.g., a colleague's shared file)"),
      },
    },
    async ({ id, path: filePath }) => {
      try {
        const docs = await backpack.documents();
        const result = await docs.ingest({
          id: id as string | undefined,
          path: filePath as string | undefined,
        });
        trackEvent("tool_call", { tool: "backpack_kb_ingest" });
        const wikilinkSection = result.wikilinks.length > 0
          ? `\nReferenced documents (via [[wikilinks]]): ${result.wikilinks.map((w) => w.target).join(", ")}\n`
          : "";
        return {
          content: [{
            type: "text" as const,
            text: `Source document: "${result.title}"\n${result.sourceGraphs.length > 0 ? `Derived from graphs: ${result.sourceGraphs.join(", ")}\n` : ""}${wikilinkSection}\n---\n\n${result.content}`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_mounts",
    {
      title: "List KB Mounts",
      description: "List all configured KB mounts for the active backpack, with document counts.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      try {
        const docs = await backpack.documents();
        const mounts = await docs.listMounts();
        trackEvent("tool_call", { tool: "backpack_kb_mounts" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(mounts, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "backpack_kb_mount",
    {
      title: "Add/Remove KB Mount",
      description:
        "Add or remove a KB mount for the active backpack. Mounts are named filesystem paths. Use this to connect an Obsidian vault, shared drive, or any folder as a KB source.",
      inputSchema: {
        action: z.enum(["add", "remove"]).describe("Whether to add or remove a mount"),
        name: z.string().describe("Mount name (e.g., 'team', 'obsidian', 'client-x')"),
        path: z.string().optional().describe("Filesystem path (required for add)"),
        writable: z.boolean().optional().describe("Whether this mount is writable (default true). Set false for read-only access to others' shared folders."),
      },
    },
    async ({ action, name, path: mountPath, writable }) => {
      try {
        const entry = backpack.getActiveBackpackEntry();
        if (!entry) throw new Error("No active backpack");

        if (action === "add") {
          if (!mountPath) throw new Error("path is required for add");
          await addKBMount(entry.path, {
            name,
            path: mountPath,
            ...(writable === false ? { writable: false } : {}),
          });
          trackEvent("tool_call", { tool: "backpack_kb_mount", action: "add" });
          return {
            content: [{ type: "text" as const, text: `KB mount "${name}" added at ${mountPath}.` }],
          };
        } else {
          await removeKBMount(entry.path, name);
          trackEvent("tool_call", { tool: "backpack_kb_mount", action: "remove" });
          return {
            content: [{ type: "text" as const, text: `KB mount "${name}" removed.` }],
          };
        }
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}
