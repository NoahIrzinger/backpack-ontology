import * as path from "node:path";
import { spawn } from "node:child_process";
import { ParsedArgs } from "../parser.js";
import { getGraphSummary } from "../../ops/graphs.js";
import { getContext } from "../../ops/context.js";
import { red, dim, green, yellow } from "../colors.js";
const VIEWER_URL = process.env.BACKPACK_VIEWER_URL || "http://127.0.0.1:5173";
async function syncViewerContext(): Promise<{
    ok: boolean;
    label: string | null;
    container?: string;
    error?: string;
}> {
    const ctx = await getContext();
    let switchName: string | null = null;
    let label: string | null = null;
    let container: string | undefined;
    if (ctx.source === "local" && ctx.backpackPath) {
        switchName = path.basename(ctx.backpackPath);
        label = `local:${switchName}`;
    }
    else if (ctx.source === "cloud") {
        switchName = "__cloud__";
        label = ctx.cloudContainer ? `cloud:${ctx.cloudContainer}` : "cloud";
        container = ctx.cloudContainer;
    }
    if (!switchName) return { ok: false, label: null, error: "no active context" };
    try {
        const res = await fetch(`${VIEWER_URL}/api/backpacks/switch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: switchName }),
        });
        if (!res.ok) return { ok: false, label, container, error: `viewer returned HTTP ${res.status}` };
        return { ok: true, label, container };
    }
    catch (err) {
        return { ok: false, label, container, error: (err as Error).message };
    }
}
export async function runOpen(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp open: graph name required.\nusage: bp open <name>\n`);
        return 1;
    }
    try {
        const summary = await getGraphSummary(name);
        if (!summary) {
            process.stderr.write(`${red("✗")} graph "${name}" not found in the current scope.\n`);
            return 1;
        }
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
    const sync = await syncViewerContext();
    if (sync.ok) {
        process.stdout.write(`${dim("·")} viewer switched to ${sync.label}\n`);
        if (sync.container) {
            process.stdout.write(dim(`  (cloud container filter is set client-side — click "${sync.container}" in the picker if the viewer doesn't already show it)\n`));
        }
    }
    else if (sync.error?.includes("ECONNREFUSED") || sync.error?.includes("fetch failed")) {
        process.stdout.write(`${yellow("!")} viewer doesn't appear to be running at ${VIEWER_URL} — opening anyway.\n`);
        process.stdout.write(dim(`  start it with: npx backpack-viewer@latest\n`));
    }
    else if (sync.error) {
        process.stdout.write(`${yellow("!")} couldn't sync viewer context (${sync.error}) — opening anyway.\n`);
    }
    const containerHash = sync.container ? `&container=${encodeURIComponent(sync.container)}` : "";
    const url = `${VIEWER_URL}/#${encodeURIComponent(name)}${containerHash}`;
    process.stdout.write(`${green("→")} ${url}\n`);
    let cmd: string;
    let cmdArgs: string[];
    if (process.platform === "darwin") {
        cmd = "open";
        cmdArgs = [url];
    }
    else if (process.platform === "win32") {
        cmd = "cmd";
        cmdArgs = ["/c", "start", "", url];
    }
    else {
        cmd = "xdg-open";
        cmdArgs = [url];
    }
    try {
        const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" });
        child.on("error", () => {
            process.stdout.write(dim("  (couldn't auto-launch — copy the URL above into your browser)\n"));
        });
        child.unref();
    }
    catch {
        process.stdout.write(dim("  (couldn't auto-launch — copy the URL above into your browser)\n"));
    }
    return 0;
}
