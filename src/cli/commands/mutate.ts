import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { ParsedArgs, flagString } from "../parser.js";
import { createGraph, deleteGraph, renameGraph, applyGraph, getGraph, getGraphSummary, } from "../../ops/graphs.js";
import { red, yellow, green, dim, bold } from "../colors.js";
import { confirm } from "../util/confirm.js";
import type { LearningGraphData } from "../../core/types.js";
export async function runCreate(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp graphs create: name required.\nusage: bp graphs create <name> [--description=...] [--from-file=path.json]\n`);
        return 1;
    }
    const fromFile = flagString(args, "from-file", "f");
    const description = flagString(args, "description", "d") ?? "";
    try {
        const existing = await getGraphSummary(name).catch(() => null);
        if (existing) {
            process.stderr.write(`${red("✗")} graph "${name}" already exists. use \`bp graphs apply\` to overwrite.\n`);
            return 1;
        }
        if (fromFile) {
            const raw = await fs.readFile(fromFile, "utf8");
            const data = JSON.parse(raw) as LearningGraphData;
            if (data.metadata?.name && data.metadata.name !== name) {
                process.stderr.write(`${red("✗")} file's metadata.name is "${data.metadata.name}" but the create target is "${name}". rename in the file or call \`bp graphs apply\` instead.\n`);
                return 1;
            }
            await applyGraph(name, data);
            process.stdout.write(`${green("✓")} created ${bold(name)} from ${dim(fromFile)}\n`);
        }
        else {
            await createGraph(name, { description });
            process.stdout.write(`${green("✓")} created ${bold(name)}\n`);
        }
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runDelete(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp graphs delete: name required.\nusage: bp graphs delete <name> [-y]\n`);
        return 1;
    }
    let summary;
    try {
        summary = await getGraphSummary(name);
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
    if (!summary) {
        process.stderr.write(`${red("✗")} graph "${name}" not found in the current scope.\n`);
        return 1;
    }
    const ok = await confirm(`delete ${bold(name)} (${summary.nodeCount} nodes, ${summary.edgeCount} edges)? [y/N] `, args);
    if (!ok) {
        process.stdout.write(dim("aborted.\n"));
        return 0;
    }
    try {
        await deleteGraph(name);
        process.stdout.write(`${green("✓")} deleted ${bold(name)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runRename(args: ParsedArgs): Promise<number> {
    const [oldName, newName] = args.positional;
    if (!oldName || !newName) {
        process.stderr.write(`bp graphs rename: old + new names required.\nusage: bp graphs rename <old> <new>\n`);
        return 1;
    }
    if (oldName === newName) {
        process.stderr.write(`bp graphs rename: old and new names are the same.\n`);
        return 1;
    }
    try {
        await renameGraph(oldName, newName);
        process.stdout.write(`${green("✓")} ${bold(oldName)} → ${bold(newName)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runApply(args: ParsedArgs): Promise<number> {
    const file = flagString(args, "f", "file", "from-file");
    if (!file) {
        process.stderr.write(`bp graphs apply: -f <file> required.\nusage: bp graphs apply -f <file.json>\n`);
        return 1;
    }
    let data: LearningGraphData;
    try {
        const raw = await fs.readFile(file, "utf8");
        data = JSON.parse(raw) as LearningGraphData;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} could not read ${file}: ${(err as Error).message}\n`);
        return 1;
    }
    const explicit = args.positional[0];
    const fileName = data.metadata?.name;
    if (explicit && fileName && explicit !== fileName) {
        process.stderr.write(`${red("✗")} name mismatch: argument is "${explicit}" but file's metadata.name is "${fileName}". pick one or fix the file.\n`);
        return 1;
    }
    const name = explicit ?? fileName;
    if (!name) {
        process.stderr.write(`bp graphs apply: graph name not in file metadata; pass it as the first positional arg.\n`);
        return 1;
    }
    try {
        const { created } = await applyGraph(name, data);
        process.stdout.write(`${green("✓")} ${created ? "created" : "applied"} ${bold(name)} (${data.nodes?.length ?? 0} nodes, ${data.edges?.length ?? 0} edges)\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runEdit(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp graphs edit: name required.\nusage: bp graphs edit <name>\n`);
        return 1;
    }
    let result;
    try {
        result = await getGraph(name);
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
    if (result.kind === "missing") {
        process.stderr.write(`${red("✗")} graph "${name}" not found in the current scope.\n`);
        return 1;
    }
    if (result.kind === "encrypted") {
        process.stderr.write(`${yellow("!")} graph "${name}" is encrypted — cannot edit from the CLI.\n`);
        return 1;
    }
    const editorCmd = process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad" : "vi");
    const editorTokens = editorCmd.trim().split(/\s+/).filter(Boolean);
    const editor = editorTokens[0];
    const editorArgs = editorTokens.slice(1);
    const userTmpDir = path.join(os.tmpdir(), `bp-${process.getuid?.() ?? "u"}`);
    await fs.mkdir(userTmpDir, { recursive: true });
    const tmpFile = path.join(userTmpDir, `edit-${process.pid}-${Date.now()}.json`);
    const original = JSON.stringify(result.data, null, 2);
    await fs.writeFile(tmpFile, original, { mode: 0o600 });
    let cleanedUp = false;
    let interrupted = false;
    const cleanup = async () => {
        if (cleanedUp)
            return;
        cleanedUp = true;
        await fs.unlink(tmpFile).catch(() => { });
    };
    const onSig = () => {
        interrupted = true;
        process.exitCode = 130;
    };
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
    try {
        const exitCode = await new Promise<number>((resolve, reject) => {
            const child = spawn(editor, [...editorArgs, tmpFile], { stdio: "inherit" });
            child.on("error", reject);
            child.on("exit", (code) => resolve(code ?? 0));
        });
        if (interrupted)
            return 130;
        if (exitCode !== 0) {
            process.stderr.write(`${yellow("!")} editor exited ${exitCode} — changes discarded.\n`);
            return 1;
        }
        const updated = await fs.readFile(tmpFile, "utf8");
        let parsed: LearningGraphData;
        try {
            parsed = JSON.parse(updated) as LearningGraphData;
        }
        catch (err) {
            process.stderr.write(`${red("✗")} edited file is not valid JSON: ${(err as Error).message}\n`);
            process.stderr.write(dim(`  preserved at ${tmpFile}\n`));
            cleanedUp = true;
            return 1;
        }
        const beforeKey = canonicalKey(result.data);
        const afterKey = canonicalKey(parsed);
        if (beforeKey === afterKey) {
            process.stdout.write(dim("no changes.\n"));
            return 0;
        }
        await applyGraph(name, parsed);
        process.stdout.write(`${green("✓")} updated ${bold(name)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
    finally {
        process.removeListener("SIGINT", onSig);
        process.removeListener("SIGTERM", onSig);
        await cleanup();
    }
}
function canonicalKey(data: LearningGraphData): string {
    const stripped = {
        metadata: {
            name: data.metadata?.name,
            description: data.metadata?.description,
            tags: [...(data.metadata?.tags ?? [])].sort(),
        },
        nodes: data.nodes,
        edges: data.edges,
    };
    return stableStringify(stripped);
}
function stableStringify(v: unknown): string {
    if (v === null || typeof v !== "object")
        return JSON.stringify(v);
    if (Array.isArray(v))
        return "[" + v.map(stableStringify).join(",") + "]";
    const keys = Object.keys(v as object).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}
