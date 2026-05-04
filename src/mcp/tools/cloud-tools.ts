import * as crypto from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Backpack } from "../../core/backpack.js";
import { OAuthClient } from "../../auth/oauth.js";
import { trackEvent } from "../../core/telemetry.js";
import { resolveCloudToken, emailFromToken, getRelayUrl, getClientId, getIssuerUrl } from "../../ops/auth.js";
export { resolveCloudToken };
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
        title: "Sync Graph to Cloud",
        description: "Push a local graph to the cloud as a private snapshot, making it accessible from any device or the web app. " +
            "Overwrites any existing cloud copy. Use backpack_share to also create a public link.",
        inputSchema: {
            name: z.string().describe("Name of the local graph to sync"),
        },
    }, async ({ name }) => {
        trackEvent("tool_call", { tool: "backpack_cloud_sync" });
        const token = await resolveCloudToken();
        if (!token) {
            return { content: [{ type: "text" as const, text: "Not signed in. Use backpack_cloud_login first." }] };
        }
        let data: import("../../core/types.js").LearningGraphData;
        try {
            data = await backpack.loadOntology(name);
        } catch {
            return { content: [{ type: "text" as const, text: `Graph "${name}" not found locally.` }], isError: true };
        }
        const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}/events`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name,
                description: data.metadata?.description ?? "",
                snapshot: data,
                events: [],
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { content: [{ type: "text" as const, text: `Sync failed (${res.status}): ${body}` }], isError: true };
        }
        return {
            content: [{ type: "text" as const, text: `Synced "${name}" to cloud. ${data.nodes.length} nodes, ${data.edges.length} edges. Use backpack_cloud_list to see your cloud graphs.` }],
        };
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
