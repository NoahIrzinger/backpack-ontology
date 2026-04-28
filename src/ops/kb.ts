import { DocumentStore, type KBMount } from "../core/document-store.js";
import { getKBMounts } from "../core/backpacks-registry.js";
import { getContext } from "./context.js";
import { resolveCloudToken, getRelayUrl, assertSafeRelay } from "./auth.js";
export interface KBSummary {
    id: string;
    title: string;
    tags: string[];
    sourceGraphs: string[];
    collection?: string;
    sourceBackpack?: string;
    origin: "local" | "cloud";
}
async function localStore(): Promise<DocumentStore> {
    const ctx = await getContext();
    if (ctx.source !== "local" || !ctx.backpackPath) {
        throw new Error("active context is not a local backpack");
    }
    const mountConfigs = await getKBMounts(ctx.backpackPath);
    const mounts: KBMount[] = mountConfigs.map((m) => ({
        name: m.name,
        path: m.path,
        writable: m.writable !== false,
    }));
    return new DocumentStore(mounts);
}
interface CloudKBRow {
    id: string;
    title?: string;
    tags?: string[];
    sourceGraphs?: string[];
    collection?: string;
    sourceBackpack?: string;
    syncBackpackId?: string;
}
export async function listKB(): Promise<KBSummary[]> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const store = await localStore();
        const result = await store.list({ limit: 1000 });
        return result.documents.map((d) => ({
            id: d.id,
            title: d.title,
            tags: d.tags ?? [],
            sourceGraphs: d.sourceGraphs ?? [],
            collection: d.collection,
            origin: "local" as const,
        }));
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/kb/documents?limit=1000`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        if (res.status === 404)
            return [];
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud /api/kb/documents returned HTTP ${res.status}`);
    }
    const body = await res.json() as {
        documents?: CloudKBRow[];
    };
    const all = (body.documents ?? []).map((d): KBSummary => ({
        id: d.id,
        title: d.title ?? d.id,
        tags: d.tags ?? [],
        sourceGraphs: d.sourceGraphs ?? [],
        collection: d.collection,
        sourceBackpack: d.sourceBackpack,
        origin: "cloud" as const,
    }));
    const wantContainer = (ctx.cloudContainer ?? "").trim();
    return wantContainer
        ? all.filter((d) => d.sourceBackpack === wantContainer)
        : all;
}
export interface KBDocument extends KBSummary {
    content: string;
}
export interface KBSaveInput {
    id?: string;
    title: string;
    content: string;
    tags?: string[];
    sourceGraphs?: string[];
    collection?: string;
}
export async function saveKB(input: KBSaveInput): Promise<{
    id: string;
    created: boolean;
}> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const store = await localStore();
        const before = input.id ? await store.read(input.id).catch(() => null) : null;
        const saved = await store.save(input);
        return { id: saved.id, created: !before };
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const haveId = !!input.id;
    const url = haveId
        ? `${getRelayUrl()}/api/kb/documents/${encodeURIComponent(input.id!)}`
        : `${getRelayUrl()}/api/kb/documents`;
    const res = await fetch(url, {
        method: haveId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            title: input.title,
            content: input.content,
            tags: input.tags ?? [],
            sourceGraphs: input.sourceGraphs ?? [],
            collection: input.collection,
        }),
    });
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud KB save returned HTTP ${res.status}`);
    }
    const body = await res.json() as {
        id: string;
    };
    return { id: body.id, created: res.status === 201 };
}
export async function deleteKB(id: string): Promise<void> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const store = await localStore();
        await store.delete(id);
        return;
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/kb/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404)
        throw new Error(`kb doc "${id}" not found`);
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud KB delete returned HTTP ${res.status}`);
    }
}
export async function getKB(id: string): Promise<KBDocument | null> {
    const ctx = await getContext();
    if (ctx.source === "local") {
        const store = await localStore();
        const doc = await store.read(id);
        if (!doc)
            return null;
        return {
            id: doc.id,
            title: doc.title,
            tags: doc.tags ?? [],
            sourceGraphs: doc.sourceGraphs ?? [],
            collection: doc.collection,
            content: doc.content,
            origin: "local",
        };
    }
    const token = await resolveCloudToken();
    if (!token)
        throw new Error("not signed in — run `bp login` first");
    assertSafeRelay(getRelayUrl());
    const res = await fetch(`${getRelayUrl()}/api/kb/documents/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404)
        return null;
    if (!res.ok) {
        if (res.status === 401)
            throw new Error("cloud session expired — run `bp login` to refresh");
        throw new Error(`cloud /api/kb/documents/${id} returned HTTP ${res.status}`);
    }
    const d = await res.json() as CloudKBRow & {
        content?: string;
    };
    return {
        id: d.id,
        title: d.title ?? d.id,
        tags: d.tags ?? [],
        sourceGraphs: d.sourceGraphs ?? [],
        collection: d.collection,
        sourceBackpack: d.sourceBackpack,
        content: d.content ?? "",
        origin: "cloud",
    };
}
