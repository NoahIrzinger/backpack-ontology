import type { LearningGraphData } from "../core/types.js";
import { Backpack } from "../core/backpack.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { getContext } from "./context.js";
import { resolveCloudToken, getRelayUrl, assertSafeRelay } from "./auth.js";
export interface GraphSummary {
    name: string;
    description?: string;
    tags?: string[];
    nodeCount: number;
    edgeCount: number;
    encrypted?: boolean;
    sourceBackpack?: string;
    origin: "local" | "cloud";
}
async function localBackpack(): Promise<Backpack> {
    const ctx = await getContext();
    if (ctx.source !== "local" || !ctx.backpackPath) {
        throw new Error("active context is not a local backpack");
    }
    const backend = new JsonFileBackend(undefined, { graphsDirOverride: ctx.backpackPath });
    await backend.initialize();
    return new Backpack(backend);
}
interface CloudGraphRow {
    id: string;
    name: string;
    description?: string;
    encrypted?: boolean;
    source?: string;
    sourceBackpack?: string;
    syncBackpackId?: string;
    nodeCount?: number;
    edgeCount?: number;
}
async function fetchCloudGraphs(token: string): Promise<CloudGraphRow[]> {
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/graphs`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud /api/graphs returned HTTP ${res.status}`);
    }
    const body = await res.json();
    return Array.isArray(body) ? body as CloudGraphRow[] : [];
}
export async function listGraphs(): Promise<GraphSummary[]> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const bp = await localBackpack();
        const summaries = await bp.listOntologies();
        return summaries.map((s) => ({
            name: s.name,
            description: s.description,
            tags: s.tags,
            nodeCount: s.nodeCount,
            edgeCount: s.edgeCount,
            origin: "local" as const,
        }));
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    const rows = await fetchCloudGraphs(token);
    const wantContainer = (ctx.cloudContainer ?? "").trim();
    const filtered = wantContainer
        ? rows.filter((g) => g.sourceBackpack === wantContainer)
        : rows;
    return filtered.map((g) => ({
        name: g.name,
        description: g.description,
        tags: [],
        nodeCount: g.nodeCount ?? 0,
        edgeCount: g.edgeCount ?? 0,
        encrypted: g.encrypted,
        sourceBackpack: g.sourceBackpack,
        origin: "cloud" as const,
    }));
}
export type GraphFetchResult = {
    kind: "ok";
    data: LearningGraphData;
} | {
    kind: "missing";
} | {
    kind: "encrypted";
};
export async function getGraph(name: string): Promise<GraphFetchResult> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const bp = await localBackpack();
        try {
            const data = await bp.loadOntology(name);
            return { kind: "ok", data };
        }
        catch (err) {
            const msg = (err as Error).message;
            if (/not found/i.test(msg))
                return { kind: "missing" };
            throw err;
        }
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404)
        return { kind: "missing" };
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud /api/graphs/${name} returned HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data === null)
        return { kind: "encrypted" };
    return { kind: "ok", data: data as LearningGraphData };
}
export async function getGraphSummary(name: string): Promise<GraphSummary | null> {
    const all = await listGraphs();
    return all.find((g) => g.name === name) ?? null;
}
export async function createGraph(name: string, opts: {
    description?: string;
} = {}): Promise<void> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const bp = await localBackpack();
        await bp.createOntology(name, opts.description ?? "");
        return;
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const now = new Date().toISOString();
    const empty = {
        metadata: { name, description: opts.description ?? "", createdAt: now, updatedAt: now },
        nodes: [],
        edges: [],
    };
    const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(empty),
    });
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud create returned HTTP ${res.status}`);
    }
}
export async function deleteGraph(name: string): Promise<void> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const bp = await localBackpack();
        await bp.deleteOntology(name);
        return;
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404)
        throw new Error(`graph "${name}" not found in the current scope`);
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud delete returned HTTP ${res.status}`);
    }
}
export async function renameGraph(oldName: string, newName: string): Promise<void> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const bp = await localBackpack();
        await bp.renameOntology(oldName, newName);
        return;
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(oldName)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName }),
    });
    if (res.status === 404)
        throw new Error(`graph "${oldName}" not found in the current scope`);
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        if (res.status === 409)
            throw new Error(`a graph named "${newName}" already exists`);
        throw new Error(`cloud rename returned HTTP ${res.status}`);
    }
}
export async function applyGraph(name: string, data: LearningGraphData): Promise<{
    created: boolean;
}> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const bp = await localBackpack();
        const exists = await bp.ontologyExists(name);
        if (exists) {
            await bp.saveOntologyData(name, data);
        }
        else {
            await bp.createOntologyFromData(name, data);
        }
        return { created: !exists };
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/graphs/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud apply returned HTTP ${res.status}`);
    }
    return { created: false };
}
export interface SearchHit {
    graphName: string;
    nodeId: string;
    nodeType: string;
    label: string;
}
export interface SearchResult {
    hits: SearchHit[];
    graphsScanned: number;
    graphsInScope: number;
    graphsSkipped: number;
    truncated: boolean;
}
const SEARCH_DEFAULT_MAX_GRAPHS = 50;
const SEARCH_DEFAULT_HITS_PER_GRAPH = 5;
export async function searchGraphs(query: string, opts: {
    hitsPerGraph?: number;
    maxGraphs?: number;
} = {}): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) {
        return { hits: [], graphsScanned: 0, graphsInScope: 0, graphsSkipped: 0, truncated: false };
    }
    const q = trimmed.toLowerCase();
    const hitsPerGraph = opts.hitsPerGraph ?? SEARCH_DEFAULT_HITS_PER_GRAPH;
    const maxGraphs = opts.maxGraphs ?? SEARCH_DEFAULT_MAX_GRAPHS;
    const summaries = await listGraphs();
    const scannable = summaries.filter((s) => !s.encrypted);
    const truncated = scannable.length > maxGraphs;
    const targets = scannable.slice(0, maxGraphs);
    const hits: SearchHit[] = [];
    for (const s of targets) {
        let result: GraphFetchResult;
        try {
            result = await getGraph(s.name);
        }
        catch {
            continue;
        }
        if (result.kind !== "ok")
            continue;
        let countInThis = 0;
        for (const n of result.data.nodes) {
            const label = (Object.values(n.properties ?? {}).find((v) => typeof v === "string") as string) ?? n.id;
            const haystack = (n.type + " " + Object.values(n.properties ?? {}).filter((v) => typeof v === "string").join(" ")).toLowerCase();
            if (haystack.includes(q)) {
                hits.push({ graphName: s.name, nodeId: n.id, nodeType: n.type, label });
                countInThis++;
                if (countInThis >= hitsPerGraph)
                    break;
            }
        }
    }
    return {
        hits,
        graphsScanned: targets.length,
        graphsInScope: summaries.length,
        graphsSkipped: summaries.length - targets.length,
        truncated,
    };
}
