import { resolveCloudToken, getRelayUrl, assertSafeRelay } from "./auth.js";
export interface ContainerSummary {
    id: string;
    name: string;
    color?: string;
    tags?: string[];
    origin_kind: "cloud" | "local";
    origin_device_name?: string;
}
async function authedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
    assertSafeRelay(getRelayUrl());
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`,
        ...(init?.headers as Record<string, string> ?? {}),
    };
    return fetch(`${getRelayUrl()}${path}`, { ...init, headers });
}
function authError(): Error {
    return new Error("not signed in — run `bp login` first");
}
function expiredError(): Error {
    return new Error("cloud session expired — run `bp login` to refresh");
}
export async function listContainers(): Promise<ContainerSummary[]> {
    const token = await resolveCloudToken();
    if (!token)
        throw authError();
    const res = await authedFetch(token, `/api/sync/backpacks`);
    if (!res.ok) {
        if (res.status === 401)
            throw expiredError();
        throw new Error(`cloud /api/sync/backpacks returned HTTP ${res.status}`);
    }
    const body = await res.json() as {
        backpacks?: ContainerSummary[];
    };
    return body.backpacks ?? [];
}
async function findContainer(token: string, name: string): Promise<ContainerSummary | null> {
    const res = await authedFetch(token, `/api/sync/backpacks`);
    if (!res.ok) {
        if (res.status === 401)
            throw expiredError();
        throw new Error(`cloud /api/sync/backpacks returned HTTP ${res.status}`);
    }
    const body = await res.json() as {
        backpacks?: ContainerSummary[];
    };
    return body.backpacks?.find((c) => c.name === name) ?? null;
}
export async function createContainer(name: string, opts: {
    color?: string;
    tags?: string[];
} = {}): Promise<{
    container: ContainerSummary;
    created: boolean;
}> {
    const token = await resolveCloudToken();
    if (!token)
        throw authError();
    const res = await authedFetch(token, `/api/sync/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: opts.color, tags: opts.tags ?? [] }),
    });
    if (!res.ok) {
        if (res.status === 401)
            throw expiredError();
        throw new Error(`cloud create container returned HTTP ${res.status}`);
    }
    return {
        container: await res.json() as ContainerSummary,
        created: res.status === 201,
    };
}
export async function renameContainer(oldName: string, opts: {
    newName?: string;
    color?: string;
    tags?: string[];
}): Promise<ContainerSummary> {
    const token = await resolveCloudToken();
    if (!token)
        throw authError();
    const target = await findContainer(token, oldName);
    if (!target)
        throw new Error(`container "${oldName}" not found`);
    const body: Record<string, unknown> = {};
    if (opts.newName)
        body.name = opts.newName;
    if (opts.color)
        body.color = opts.color;
    if (opts.tags)
        body.tags = opts.tags;
    if (Object.keys(body).length === 0) {
        throw new Error("nothing to update — pass --name, --color, or --tags");
    }
    const res = await authedFetch(token, `/api/sync/backpacks/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        if (res.status === 401)
            throw expiredError();
        throw new Error(`cloud rename container returned HTTP ${res.status}`);
    }
    return await res.json() as ContainerSummary;
}
export async function deleteContainer(name: string): Promise<void> {
    const token = await resolveCloudToken();
    if (!token)
        throw authError();
    const target = await findContainer(token, name);
    if (!target)
        throw new Error(`container "${name}" not found`);
    const res = await authedFetch(token, `/api/sync/backpacks/${target.id}`, { method: "DELETE" });
    if (res.status === 204)
        return;
    if (res.status === 422) {
        throw new Error(`container "${name}" still has graphs or KB docs — move them out first`);
    }
    if (res.status === 401)
        throw expiredError();
    throw new Error(`cloud delete container returned HTTP ${res.status}`);
}
export async function moveGraphToContainer(graphName: string, toContainer: string): Promise<void> {
    const token = await resolveCloudToken();
    if (!token)
        throw authError();
    const dest = await findContainer(token, toContainer);
    if (!dest)
        throw new Error(`destination container "${toContainer}" not found — create it with \`bp containers create\``);
    const res = await authedFetch(token, `/api/sync/backpacks/${dest.id}/move-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: graphName }),
    });
    if (res.status === 404)
        throw new Error(`graph "${graphName}" not found in your account`);
    if (!res.ok) {
        if (res.status === 401)
            throw expiredError();
        throw new Error(`cloud move graph returned HTTP ${res.status}`);
    }
}
export async function moveKBToContainer(docId: string, toContainer: string): Promise<void> {
    const token = await resolveCloudToken();
    if (!token)
        throw authError();
    const dest = await findContainer(token, toContainer);
    if (!dest)
        throw new Error(`destination container "${toContainer}" not found`);
    const res = await authedFetch(token, `/api/sync/backpacks/${dest.id}/move-kb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId }),
    });
    if (res.status === 404)
        throw new Error(`KB doc "${docId}" not found in your account`);
    if (!res.ok) {
        if (res.status === 401)
            throw expiredError();
        throw new Error(`cloud move kb returned HTTP ${res.status}`);
    }
}
