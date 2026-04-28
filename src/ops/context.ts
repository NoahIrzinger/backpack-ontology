import * as fs from "node:fs/promises";
import * as path from "node:path";
import { configDir } from "../core/paths.js";
import { resolveCloudToken, getRelayUrl, assertSafeRelay } from "./auth.js";
export type ContextSource = "local" | "cloud";
export interface CliContext {
    source: ContextSource;
    backpackPath?: string;
    cloudContainer?: string;
}
interface NamedContext extends CliContext {
    name: string;
    detail?: string;
}
function contextFilePath(): string {
    return path.join(configDir(), "cli-context.json");
}
function backpacksRegistryPath(): string {
    return path.join(configDir(), "backpacks.json");
}
export async function getContext(): Promise<CliContext> {
    try {
        const raw = await fs.readFile(contextFilePath(), "utf8");
        const parsed = JSON.parse(raw) as Partial<CliContext>;
        if (parsed.source === "local" || parsed.source === "cloud") {
            return {
                source: parsed.source,
                backpackPath: parsed.backpackPath,
                cloudContainer: parsed.cloudContainer,
            };
        }
    }
    catch { }
    const local = await readActiveLocalBackpack();
    if (local) {
        return { source: "local", backpackPath: local };
    }
    return { source: "cloud" };
}
export async function setContext(ctx: CliContext): Promise<void> {
    await fs.mkdir(path.dirname(contextFilePath()), { recursive: true });
    await fs.writeFile(contextFilePath(), JSON.stringify(ctx, null, 2), "utf8");
}
export async function clearContext(): Promise<void> {
    try {
        await fs.unlink(contextFilePath());
    }
    catch { }
}
async function readActiveLocalBackpack(): Promise<string | null> {
    try {
        const raw = await fs.readFile(backpacksRegistryPath(), "utf8");
        const reg = JSON.parse(raw) as {
            active?: string;
        };
        return typeof reg.active === "string" ? reg.active : null;
    }
    catch {
        return null;
    }
}
async function readAllLocalBackpacks(): Promise<{
    name: string;
    path: string;
}[]> {
    try {
        const raw = await fs.readFile(backpacksRegistryPath(), "utf8");
        const reg = JSON.parse(raw) as {
            paths?: string[];
        };
        if (!Array.isArray(reg.paths))
            return [];
        return reg.paths.map((p) => ({ name: path.basename(p), path: p }));
    }
    catch {
        return [];
    }
}
interface CloudContainerSummary {
    id: string;
    name: string;
    origin_kind: string;
    origin_device_name?: string;
}
async function readCloudContainers(token: string): Promise<CloudContainerSummary[]> {
    try {
        assertSafeRelay(getRelayUrl());
        const res = await fetch(`${getRelayUrl()}/api/sync/backpacks`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok)
            return [];
        const body = await res.json() as {
            backpacks?: CloudContainerSummary[];
        };
        return body.backpacks ?? [];
    }
    catch {
        return [];
    }
}
export async function listContexts(): Promise<NamedContext[]> {
    const out: NamedContext[] = [];
    for (const bp of await readAllLocalBackpacks()) {
        out.push({ name: `local:${bp.name}`, source: "local", backpackPath: bp.path, detail: bp.path });
    }
    const token = await resolveCloudToken();
    if (token) {
        for (const c of await readCloudContainers(token)) {
            const detail = c.origin_kind === "local" && c.origin_device_name
                ? `device-synced from ${c.origin_device_name}`
                : "cloud-native";
            out.push({ name: `cloud:${c.name}`, source: "cloud", cloudContainer: c.name, detail });
        }
    }
    return out;
}
export type ResolveResult = {
    ctx: NamedContext;
    ambiguous?: never;
} | {
    ctx: null;
    ambiguous: string[];
    suggestions?: never;
} | {
    ctx: null;
    suggestions: string[];
    ambiguous?: never;
};
export async function resolveContextName(input: string): Promise<ResolveResult> {
    const all = await listContexts();
    const lower = input.toLowerCase();
    const exact = all.find((c) => c.name === input);
    if (exact)
        return { ctx: exact };
    const prefixed = all.find((c) => c.name.toLowerCase() === lower);
    if (prefixed)
        return { ctx: prefixed };
    const bareMatches = all.filter((c) => c.name.split(":").pop()?.toLowerCase() === lower);
    if (bareMatches.length === 1)
        return { ctx: bareMatches[0] };
    if (bareMatches.length > 1) {
        return { ctx: null, ambiguous: bareMatches.map((m) => m.name) };
    }
    const suggestions = all
        .map((c) => ({ name: c.name, score: similarityScore(c.name.toLowerCase(), lower) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .filter((s) => s.score > 0)
        .map((s) => s.name);
    return { ctx: null, suggestions };
}
function similarityScore(a: string, b: string): number {
    if (a.includes(b))
        return 100 - (a.length - b.length);
    if (b.includes(a))
        return 100 - (b.length - a.length);
    let common = 0;
    for (const ch of new Set(b))
        if (a.includes(ch))
            common++;
    return common;
}
export function describeContext(ctx: CliContext): string {
    if (ctx.source === "local") {
        return ctx.backpackPath ? `local:${path.basename(ctx.backpackPath)}` : "local";
    }
    return ctx.cloudContainer ? `cloud:${ctx.cloudContainer}` : "cloud (all containers)";
}
