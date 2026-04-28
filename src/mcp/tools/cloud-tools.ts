import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Backpack } from "../../core/backpack.js";
import { OAuthClient } from "../../auth/oauth.js";
import { configDir } from "../../core/paths.js";
import { trackEvent } from "../../core/telemetry.js";
import { resolveCloudToken, emailFromToken, getRelayUrl, getClientId, getIssuerUrl } from "../../ops/auth.js";
export { resolveCloudToken };
interface CloudContainer {
    id: string;
    name: string;
    color?: string;
    tags?: string[];
    origin_kind: string;
    origin_device_name?: string;
}
async function fetchContainers(token: string): Promise<CloudContainer[]> {
    const res = await fetch(`${getRelayUrl()}/api/sync/backpacks`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
        throw new Error(`list containers: ${res.status}`);
    const data = await res.json() as {
        backpacks?: CloudContainer[];
    };
    return data.backpacks ?? [];
}
type ResolveResult = {
    ok: true;
    container: CloudContainer;
} | {
    ok: false;
    reason: "not_found" | "fetch_failed";
    error?: string;
};
async function resolveContainerByName(token: string, name: string): Promise<ResolveResult> {
    let all: CloudContainer[];
    try {
        all = await fetchContainers(token);
    }
    catch (err) {
        return { ok: false, reason: "fetch_failed", error: (err as Error).message };
    }
    const found = all.find((c) => c.name === name);
    return found ? { ok: true, container: found } : { ok: false, reason: "not_found" };
}
export function registerCloudTools(server: McpServer, backpack: Backpack): void {
    server.registerTool("backpack_cloud_login", {
        title: "Sign In to Cloud",
        description: "Authenticate with Backpack App to access cloud-synced graphs. " +
            "Opens the system browser for sign-in. If already signed in, returns the current account.",
    }, async () => {
        trackEvent("tool_call", { tool: "backpack_cloud_login" });
        const existing = await resolveCloudToken();
        if (existing) {
            const email = emailFromToken(existing);
            return {
                content: [{ type: "text" as const, text: `Already signed in${email ? ` as ${email}` : ""}. Use backpack_cloud_list to see cloud graphs.` }],
            };
        }
        const cacheKey = crypto.createHash("sha256").update(getRelayUrl()).digest("hex").slice(0, 12);
        const oauth = new OAuthClient(getClientId(), getIssuerUrl(), cacheKey);
        const token = await oauth.getAccessToken();
        const email = emailFromToken(token);
        return {
            content: [{ type: "text" as const, text: `Signed in${email ? ` as ${email}` : ""}. Use backpack_cloud_list to see your cloud graphs.` }],
        };
    });
    server.registerTool("backpack_cloud_list", {
        title: "List Cloud Graphs",
        description: "List all learning graphs in the user's cloud backpack (Backpack App). " +
            "Shows names, descriptions, node/edge counts, and whether each graph is encrypted. " +
            "Requires authentication — use backpack_cloud_login first if not signed in.",
        annotations: { readOnlyHint: true },
    }, async () => {
        trackEvent("tool_call", { tool: "backpack_cloud_list" });
        const token = await resolveCloudToken();
        if (!token) {
            return {
                content: [{ type: "text" as const, text: "Not signed in to Backpack App. Use backpack_cloud_login to authenticate, then try again." }],
            };
        }
        const res = await fetch(`${getRelayUrl()}/api/graphs`, {
            headers: { "Authorization": `Bearer ${token}` },
        });
        if (!res.ok) {
            if (res.status === 401) {
                return {
                    content: [{ type: "text" as const, text: "Cloud session expired. Use backpack_cloud_login to re-authenticate." }],
                };
            }
            return {
                content: [{ type: "text" as const, text: `Failed to list cloud graphs: ${res.status}` }],
            };
        }
        const graphs = await res.json() as {
            name: string;
            description?: string;
            nodeCount?: number;
            edgeCount?: number;
            encrypted?: boolean;
            source?: string;
        }[];
        if (graphs.length === 0) {
            return {
                content: [{ type: "text" as const, text: "No graphs in your cloud backpack. Use the viewer's Share extension to sync local graphs to the cloud." }],
            };
        }
        const email = emailFromToken(token);
        const lines = [`Cloud backpack${email ? ` (${email})` : ""}: ${graphs.length} graph(s)\n`];
        for (const g of graphs) {
            const badges: string[] = [];
            if (g.encrypted)
                badges.push("encrypted");
            if (g.source === "local")
                badges.push("synced");
            const badgeStr = badges.length > 0 ? ` [${badges.join(", ")}]` : "";
            lines.push(`- ${g.name}${badgeStr}: ${g.nodeCount ?? "?"} nodes, ${g.edgeCount ?? "?"} edges`);
            if (g.description)
                lines.push(`  ${g.description}`);
        }
        return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
        };
    });
    server.registerTool("backpack_cloud_import", {
        title: "Import Cloud Graph",
        description: "Import a cloud graph as a local copy. This creates a fork — edits to the local copy " +
            "do not sync back to cloud. For live cloud access, use the Cloud backpack in the viewer. " +
            "Encrypted graphs cannot be imported this way — use the viewer to decrypt them first. " +
            "If a local graph with the same name exists, use asLocalName to rename on import.",
        inputSchema: {
            name: z.string().describe("Name of the cloud graph to import"),
            asLocalName: z.string().optional().describe("Local name for the imported graph (defaults to the cloud name)"),
        },
    }, async ({ name, asLocalName }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_import" });
        const token = await resolveCloudToken();
        if (!token) {
            return {
                content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }],
            };
        }
        const listRes = await fetch(`${getRelayUrl()}/api/graphs`, {
            headers: { "Authorization": `Bearer ${token}` },
        });
        if (!listRes.ok) {
            return { content: [{ type: "text" as const, text: "Failed to access cloud backpack." }] };
        }
        const graphs = await listRes.json() as {
            name: string;
            encrypted?: boolean;
        }[];
        const target = graphs.find(g => g.name === name);
        if (!target) {
            return { content: [{ type: "text" as const, text: `Graph "${name}" not found in cloud backpack.` }] };
        }
        if (target.encrypted) {
            return { content: [{ type: "text" as const, text: `Graph "${name}" is encrypted. Encrypted graphs cannot be imported via MCP — open the graph in the viewer to decrypt it, or re-sync it as plaintext from the viewer's Share panel.` }] };
        }
        const dataRes = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}`, {
            headers: { "Authorization": `Bearer ${token}` },
        });
        if (!dataRes.ok) {
            return { content: [{ type: "text" as const, text: `Failed to download graph "${name}": ${dataRes.status}` }] };
        }
        const data = await dataRes.json();
        const localName = asLocalName || name;
        const exists = await backpack.ontologyExists(localName);
        if (exists) {
            return { content: [{ type: "text" as const, text: `A local graph named "${localName}" already exists. Use a different name with asLocalName, or delete the local one first.` }] };
        }
        await backpack.createOntologyFromData(localName, data);
        return {
            content: [{ type: "text" as const, text: `Imported "${name}" from cloud as "${localName}". ${data.nodes?.length ?? 0} nodes, ${data.edges?.length ?? 0} edges. You can now use backpack_search, backpack_describe, etc.` }],
        };
    });
    server.registerTool("backpack_cloud_search", {
        title: "Search Cloud Graphs",
        description: "Search across graphs in the user's cloud backpack. Searches node types and property values. " +
            "Specify ontology to search a single graph, or omit to search across all non-encrypted cloud graphs (up to 5). " +
            "Requires authentication — use backpack_cloud_login first if not signed in.",
        inputSchema: {
            query: z.string().describe("Search query — matches node types and property values"),
            ontology: z.string().optional().describe("Search a specific cloud graph by name (searches all if omitted)"),
        },
        annotations: { readOnlyHint: true },
    }, async ({ query, ontology }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_search" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        const lowerQuery = query.toLowerCase();
        let graphNames: string[];
        if (ontology) {
            graphNames = [ontology];
        }
        else {
            const listRes = await fetch(`${getRelayUrl()}/api/graphs`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            if (!listRes.ok) {
                return { content: [{ type: "text" as const, text: `Failed to list cloud graphs: ${listRes.status}` }] };
            }
            const graphs = await listRes.json() as {
                name: string;
                encrypted?: boolean;
            }[];
            graphNames = graphs.filter(g => !g.encrypted).map(g => g.name).slice(0, 5);
        }
        if (graphNames.length === 0) {
            return { content: [{ type: "text" as const, text: "No searchable cloud graphs found (encrypted graphs cannot be searched)." }] };
        }
        const results: {
            graph: string;
            matches: {
                id: string;
                type: string;
                label: string;
            }[];
        }[] = [];
        for (const name of graphNames) {
            try {
                const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}`, {
                    headers: { "Authorization": `Bearer ${token}` },
                });
                if (!res.ok)
                    continue;
                const data = await res.json() as {
                    nodes?: {
                        id: string;
                        type: string;
                        properties: Record<string, unknown>;
                    }[];
                };
                if (!data.nodes)
                    continue;
                const matches = data.nodes.filter(node => {
                    if (node.type.toLowerCase().includes(lowerQuery))
                        return true;
                    return Object.values(node.properties).some(v => {
                        if (typeof v === "string")
                            return v.toLowerCase().includes(lowerQuery);
                        if (Array.isArray(v))
                            return v.some(item => typeof item === "string" && item.toLowerCase().includes(lowerQuery));
                        return false;
                    });
                }).slice(0, 10).map(n => ({
                    id: n.id,
                    type: n.type,
                    label: (Object.values(n.properties).find(v => typeof v === "string") as string) ?? n.id,
                }));
                if (matches.length > 0) {
                    results.push({ graph: name, matches });
                }
            }
            catch { }
        }
        if (results.length === 0) {
            return { content: [{ type: "text" as const, text: `No matches for "${query}" across ${graphNames.length} cloud graph(s). Try backpack_cloud_list to see available graphs.` }] };
        }
        const lines: string[] = [`Cloud search results for "${query}":\n`];
        for (const r of results) {
            lines.push(`**${r.graph}** (${r.matches.length} match${r.matches.length !== 1 ? "es" : ""}):`);
            for (const m of r.matches) {
                lines.push(`  - [${m.type}] ${m.label} (${m.id})`);
            }
            lines.push(`  → Use backpack_cloud_import("${r.graph}") to pull this graph locally for full access.\n`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    });
    server.registerTool("backpack_cloud_sync", {
        title: "Sync to Cloud",
        description: "Push local graphs to the cloud backpack as plaintext JSON. " +
            "Specify graphName to sync a single graph, or omit to sync all local graphs. " +
            "For encrypted sync, use the viewer's Share panel instead. " +
            "Requires authentication — use backpack_cloud_login first if not signed in.",
        inputSchema: {
            graphName: z.string().optional().describe("Name of a specific graph to sync (syncs all if omitted)"),
        },
    }, async ({ graphName }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_sync" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        let names: string[];
        if (graphName) {
            const exists = await backpack.ontologyExists(graphName);
            if (!exists) {
                return { content: [{ type: "text" as const, text: `Local graph "${graphName}" not found.` }] };
            }
            names = [graphName];
        }
        else {
            const all = await backpack.listOntologies();
            names = all.map(o => o.name);
            if (names.length === 0) {
                return { content: [{ type: "text" as const, text: "No local graphs to sync." }] };
            }
        }
        let synced = 0;
        let failed = 0;
        const errors: string[] = [];
        for (const name of names) {
            try {
                const data = await backpack.loadOntology(name);
                const graphJSON = new TextEncoder().encode(JSON.stringify(data));
                const typeSet = new Set<string>();
                for (const n of data.nodes ?? [])
                    typeSet.add(n.type);
                const checksumBuf = await crypto.subtle.digest("SHA-256", graphJSON.buffer as ArrayBuffer);
                const checksum = "sha256:" + Array.from(new Uint8Array(checksumBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
                const headerObj = {
                    format: "plaintext",
                    kind: "learning_graph",
                    created_at: new Date().toISOString(),
                    backpack_name: name,
                    checksum,
                    graph_count: 1,
                    node_count: data.nodes?.length ?? 0,
                    edge_count: data.edges?.length ?? 0,
                    node_types: Array.from(typeSet),
                };
                const headerBytes = new TextEncoder().encode(JSON.stringify(headerObj));
                const headerLenBuf = new ArrayBuffer(4);
                new DataView(headerLenBuf).setUint32(0, headerBytes.length, false);
                const envelope = new Uint8Array(4 + 1 + 4 + headerBytes.length + graphJSON.length);
                let off = 0;
                envelope.set(new Uint8Array([0x42, 0x50, 0x41, 0x4b]), off);
                off += 4;
                envelope[off] = 0x01;
                off += 1;
                envelope.set(new Uint8Array(headerLenBuf), off);
                off += 4;
                envelope.set(headerBytes, off);
                off += headerBytes.length;
                envelope.set(graphJSON, off);
                const syncHeaders: Record<string, string> = {
                    "Content-Type": "application/octet-stream",
                    "Authorization": `Bearer ${token}`,
                };
                try {
                    const osModule = await import("os");
                    syncHeaders["X-Backpack-Device-Name"] = osModule.hostname();
                    syncHeaders["X-Backpack-Device-Hostname"] = osModule.hostname();
                    syncHeaders["X-Backpack-Device-Platform"] = osModule.platform();
                    const idPath = path.join(configDir(), "machine-id");
                    let mid: string;
                    try {
                        mid = (await fs.readFile(idPath, "utf-8")).trim();
                    }
                    catch {
                        mid = crypto.createHash("sha256").update(osModule.hostname() + osModule.platform()).digest("hex").slice(0, 16);
                        try {
                            await fs.mkdir(path.dirname(idPath), { recursive: true });
                        }
                        catch { }
                        await fs.writeFile(idPath, mid, "utf-8");
                    }
                    syncHeaders["X-Backpack-Device-Id"] = mid;
                    const entry = backpack.getActiveBackpackEntry();
                    if (entry)
                        syncHeaders["X-Backpack-Source-Name"] = entry.name;
                }
                catch { }
                const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}/sync`, {
                    method: "PUT",
                    headers: syncHeaders,
                    body: envelope,
                });
                if (res.ok) {
                    synced++;
                }
                else {
                    failed++;
                    const errBody = await res.text().catch(() => "");
                    errors.push(`${name}: ${res.status} ${errBody}`);
                }
            }
            catch (err) {
                failed++;
                errors.push(`${name}: ${(err as Error).message}`);
            }
        }
        const lines = [`Cloud sync complete: ${synced} synced, ${failed} failed (of ${names.length} total).`];
        if (errors.length > 0) {
            lines.push("\nErrors:");
            for (const e of errors)
                lines.push(`  - ${e}`);
        }
        if (synced > 0) {
            lines.push("\nNote: graphs were synced as plaintext. For encrypted sync, use the viewer's Share panel.");
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    });
    server.registerTool("backpack_cloud_refresh", {
        title: "Refresh Cloud Status",
        description: "Fetch the current state of the cloud backpack — lists all cloud graphs and KB documents. " +
            "Use this to see what's available in the cloud before importing or syncing. " +
            "Requires authentication — use backpack_cloud_login first if not signed in.",
        annotations: { readOnlyHint: true },
    }, async () => {
        trackEvent("tool_call", { tool: "backpack_cloud_refresh" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        const email = emailFromToken(token);
        const lines: string[] = [`Cloud backpack${email ? ` (${email})` : ""}:\n`];
        let graphCount = 0;
        try {
            const res = await fetch(`${getRelayUrl()}/api/graphs`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            if (res.ok) {
                const graphs = await res.json() as {
                    name: string;
                    description?: string;
                    nodeCount?: number;
                    edgeCount?: number;
                    encrypted?: boolean;
                    source?: string;
                }[];
                graphCount = graphs.length;
                if (graphs.length > 0) {
                    lines.push(`Graphs (${graphs.length}):`);
                    for (const g of graphs) {
                        const badges: string[] = [];
                        if (g.encrypted)
                            badges.push("encrypted");
                        if (g.source === "local")
                            badges.push("synced");
                        const badgeStr = badges.length > 0 ? ` [${badges.join(", ")}]` : "";
                        lines.push(`  - ${g.name}${badgeStr}: ${g.nodeCount ?? "?"} nodes, ${g.edgeCount ?? "?"} edges`);
                    }
                }
                else {
                    lines.push("Graphs: none");
                }
            }
            else {
                lines.push(`Graphs: failed to fetch (${res.status})`);
            }
        }
        catch (err) {
            lines.push(`Graphs: error (${(err as Error).message})`);
        }
        try {
            const res = await fetch(`${getRelayUrl()}/api/kb/documents`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            if (res.ok) {
                const { documents: docs } = await res.json() as {
                    documents: {
                        id: string;
                        title?: string;
                        sourceGraphs?: string[];
                    }[];
                };
                if (docs.length > 0) {
                    lines.push(`\nKB Documents (${docs.length}):`);
                    for (const d of docs) {
                        const title = d.title || d.id;
                        const graphs = d.sourceGraphs?.join(", ") || "unlinked";
                        lines.push(`  - ${title} (${graphs})`);
                    }
                }
                else {
                    lines.push("\nKB Documents: none");
                }
            }
            else if (res.status !== 404) {
                lines.push(`\nKB Documents: failed to fetch (${res.status})`);
            }
        }
        catch {
        }
        try {
            const local = await backpack.listOntologies();
            if (local.length > 0) {
                lines.push(`\nLocal graphs (${local.length}): ${local.map(o => o.name).join(", ")}`);
            }
        }
        catch { }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    });
    server.registerTool("backpack_cloud_containers", {
        title: "List Cloud Containers",
        description: "List the user's cloud sync_backpack containers (groupings of graphs). Each container has an origin (cloud-native or device-synced) and holds related graphs and KB docs. Use this to plan moves or before creating a new container.",
        annotations: { readOnlyHint: true },
    }, async () => {
        trackEvent("tool_call", { tool: "backpack_cloud_containers" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        let containers: CloudContainer[];
        try {
            containers = await fetchContainers(token);
        }
        catch (err) {
            return { content: [{ type: "text" as const, text: `Failed to list containers: ${(err as Error).message}` }] };
        }
        if (containers.length === 0) {
            return { content: [{ type: "text" as const, text: "No cloud containers yet. Use backpack_cloud_container_create to make one." }] };
        }
        const email = emailFromToken(token);
        const lines: string[] = [`Cloud containers${email ? ` (${email})` : ""}: ${containers.length}\n`];
        for (const c of containers) {
            const origin = c.origin_kind === "local"
                ? `device-synced${c.origin_device_name ? ` from ${c.origin_device_name}` : ""}`
                : "cloud-native";
            const tagStr = c.tags && c.tags.length > 0 ? `  tags=[${c.tags.join(", ")}]` : "";
            lines.push(`- ${c.name}  (${origin})${tagStr}`);
            lines.push(`  id=${c.id}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    });
    server.registerTool("backpack_cloud_container_create", {
        title: "Create Cloud Container",
        description: "Create a new cloud-native sync_backpack container to group graphs. Use this when you want a logical grouping (e.g. 'projects', 'client-acme') that doesn't yet exist. Idempotent: if a container with the same name already exists for this user, the existing one is returned.",
        inputSchema: {
            name: z.string().describe("Display name for the new container (e.g. 'projects', 'client-acme')"),
            color: z.string().optional().describe("Hex color for the container's UI dot (defaults to a standard purple)"),
            tags: z.array(z.string()).optional().describe("Optional tags for filtering"),
        },
    }, async ({ name, color, tags }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_container_create" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        const res = await fetch(`${getRelayUrl()}/api/sync/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name, color, tags: tags ?? [] }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { content: [{ type: "text" as const, text: `Failed to create container: ${res.status} ${body}` }] };
        }
        const created = await res.json() as CloudContainer;
        const verb = res.status === 201 ? "Created" : "Container already existed";
        return { content: [{ type: "text" as const, text: `${verb}: ${created.name} (id=${created.id}, origin=${created.origin_kind})` }] };
    });
    server.registerTool("backpack_cloud_container_rename", {
        title: "Rename Cloud Container",
        description: "Rename a cloud sync_backpack container. Looks up the container by its current name. Color and tags can also be updated; omitted fields are preserved.",
        inputSchema: {
            name: z.string().describe("Current container name"),
            newName: z.string().optional().describe("New container name"),
            color: z.string().optional().describe("New color (hex)"),
            tags: z.array(z.string()).optional().describe("New tags (replaces existing)"),
        },
    }, async ({ name, newName, color, tags }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_container_rename" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        if (!newName && !color && !tags) {
            return { content: [{ type: "text" as const, text: "Nothing to update — provide newName, color, or tags." }] };
        }
        const lookup = await resolveContainerByName(token, name);
        if (!lookup.ok) {
            const msg = lookup.reason === "fetch_failed"
                ? `Failed to look up container "${name}": ${lookup.error ?? "fetch failed"}`
                : `Container "${name}" not found.`;
            return { content: [{ type: "text" as const, text: msg }] };
        }
        const target = lookup.container;
        const body: Record<string, unknown> = {};
        if (newName)
            body.name = newName;
        if (color)
            body.color = color;
        if (tags)
            body.tags = tags;
        const res = await fetch(`${getRelayUrl()}/api/sync/backpacks/${target.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            return { content: [{ type: "text" as const, text: `Rename failed: ${res.status} ${errBody}` }] };
        }
        const updated = await res.json() as CloudContainer;
        return { content: [{ type: "text" as const, text: `Renamed "${name}" → "${updated.name}" (id=${updated.id}).` }] };
    });
    server.registerTool("backpack_cloud_container_delete", {
        title: "Delete Cloud Container",
        description: "Delete an empty cloud sync_backpack container. The server refuses to delete a container that still has graphs or KB docs — move them out first with backpack_cloud_move_graph / backpack_cloud_move_kb.",
        inputSchema: {
            name: z.string().describe("Name of the container to delete"),
        },
    }, async ({ name }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_container_delete" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        const lookup = await resolveContainerByName(token, name);
        if (!lookup.ok) {
            const msg = lookup.reason === "fetch_failed"
                ? `Failed to look up container "${name}": ${lookup.error ?? "fetch failed"}`
                : `Container "${name}" not found.`;
            return { content: [{ type: "text" as const, text: msg }] };
        }
        const target = lookup.container;
        const res = await fetch(`${getRelayUrl()}/api/sync/backpacks/${target.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 204) {
            return { content: [{ type: "text" as const, text: `Deleted container "${name}".` }] };
        }
        const errBody = await res.text().catch(() => "");
        if (res.status === 422) {
            return { content: [{ type: "text" as const, text: `Cannot delete "${name}": still has graphs or KB docs. Move them out first, then retry.` }] };
        }
        return { content: [{ type: "text" as const, text: `Delete failed: ${res.status} ${errBody}` }] };
    });
    server.registerTool("backpack_cloud_move_graph", {
        title: "Move Cloud Graph Between Containers",
        description: "Move a graph (by name) into a different sync_backpack container. The graph data is unchanged — only its container assignment is updated. Useful for reorganizing graphs into client-, project-, or topic-based containers.",
        inputSchema: {
            graphName: z.string().describe("Name of the graph to move"),
            toContainer: z.string().describe("Name of the destination container"),
        },
    }, async ({ graphName, toContainer }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_move_graph" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        const lookup = await resolveContainerByName(token, toContainer);
        if (!lookup.ok) {
            const msg = lookup.reason === "fetch_failed"
                ? `Failed to look up destination container "${toContainer}": ${lookup.error ?? "fetch failed"}`
                : `Destination container "${toContainer}" not found. Create it first with backpack_cloud_container_create.`;
            return { content: [{ type: "text" as const, text: msg }] };
        }
        const dest = lookup.container;
        const res = await fetch(`${getRelayUrl()}/api/sync/backpacks/${dest.id}/move-graph`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: graphName }),
        });
        if (res.status === 404) {
            return { content: [{ type: "text" as const, text: `Graph "${graphName}" not found in your cloud account.` }] };
        }
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            return { content: [{ type: "text" as const, text: `Move failed: ${res.status} ${errBody}` }] };
        }
        return { content: [{ type: "text" as const, text: `Moved graph "${graphName}" into container "${toContainer}".` }] };
    });
    server.registerTool("backpack_cloud_move_kb", {
        title: "Move Cloud KB Doc Between Containers",
        description: "Move a KB document (by id) into a different sync_backpack container.",
        inputSchema: {
            docId: z.string().describe("KB document id"),
            toContainer: z.string().describe("Name of the destination container"),
        },
    }, async ({ docId, toContainer }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_move_kb" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        const lookup = await resolveContainerByName(token, toContainer);
        if (!lookup.ok) {
            const msg = lookup.reason === "fetch_failed"
                ? `Failed to look up destination container "${toContainer}": ${lookup.error ?? "fetch failed"}`
                : `Destination container "${toContainer}" not found.`;
            return { content: [{ type: "text" as const, text: msg }] };
        }
        const dest = lookup.container;
        const res = await fetch(`${getRelayUrl()}/api/sync/backpacks/${dest.id}/move-kb`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id: docId }),
        });
        if (res.status === 404) {
            return { content: [{ type: "text" as const, text: `KB doc "${docId}" not found.` }] };
        }
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            return { content: [{ type: "text" as const, text: `Move failed: ${res.status} ${errBody}` }] };
        }
        return { content: [{ type: "text" as const, text: `Moved KB doc "${docId}" into container "${toContainer}".` }] };
    });
}
export async function countCloudGraphs(): Promise<number> {
    try {
        const token = await resolveCloudToken();
        if (!token)
            return 0;
        const res = await fetch(`${getRelayUrl()}/api/graphs`, {
            headers: { "Authorization": `Bearer ${token}` },
        });
        if (!res.ok)
            return 0;
        const graphs = await res.json();
        return Array.isArray(graphs) ? graphs.length : 0;
    }
    catch {
        return 0;
    }
}
