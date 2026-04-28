import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { ParsedArgs, flagString } from "../parser.js";
import { runLs } from "./ls.js";
import { resolveFormat, emitOne } from "../output.js";
import { getKB, saveKB, deleteKB } from "../../ops/kb.js";
import { runMoveKB } from "./cloud-admin.js";
import { confirm } from "../util/confirm.js";
import { red, green, dim, bold, yellow } from "../colors.js";
export async function runKbs(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    if (!verb) {
        process.stderr.write(`bp kbs: verb required.\nusage: bp kbs <list|get> [args]\n`);
        return 1;
    }
    const sub: ParsedArgs = { positional: args.positional.slice(1), flags: args.flags, rest: args.rest };
    switch (verb) {
        case "list":
        case "ls":
            return runLs({ ...sub, positional: ["kbs", ...sub.positional] });
        case "get":
        case "cat":
            return runKbGet(sub);
        case "create":
        case "new":
            return runKbCreate(sub);
        case "delete":
        case "rm":
        case "remove":
            return runKbDelete(sub);
        case "edit":
            return runKbEdit(sub);
        case "move":
        case "mv-to":
            return runMoveKB(sub);
        default:
            process.stderr.write(`bp kbs: unknown verb "${verb}". try list, get, create, edit, delete, or move.\n`);
            return 1;
    }
}
async function runKbCreate(args: ParsedArgs): Promise<number> {
    const file = flagString(args, "f", "file", "from-file");
    const titleArg = flagString(args, "title", "t");
    const contentArg = flagString(args, "content");
    const collection = flagString(args, "collection", "c");
    const tagsRaw = flagString(args, "tags");
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const sourceRaw = flagString(args, "from-graphs");
    const sourceGraphs = sourceRaw ? sourceRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    if (file && contentArg !== undefined) {
        process.stderr.write(`bp kbs create: pass either -f <file> or --content, not both.\n`);
        return 1;
    }
    let title: string;
    let content: string;
    if (file) {
        const raw = await fs.readFile(file, "utf8").catch((err) => {
            process.stderr.write(`${red("✗")} could not read ${file}: ${(err as Error).message}\n`);
            return null;
        });
        if (raw === null)
            return 1;
        const stripped = stripLeadingFrontmatter(raw);
        content = stripped.content;
        title = titleArg ?? stripped.frontmatter.title ?? path.basename(file, path.extname(file));
    }
    else {
        if (!titleArg) {
            process.stderr.write(`bp kbs create: pass either -f <file> or --title <title> --content <text>.\n`);
            return 1;
        }
        title = titleArg;
        if (contentArg === undefined) {
            process.stderr.write(`bp kbs create: --content is required when not using -f <file>.\n`);
            return 1;
        }
        content = contentArg;
    }
    try {
        const { id, created } = await saveKB({ title, content, tags, sourceGraphs, collection });
        process.stdout.write(`${green("✓")} ${created ? "created" : "updated"} ${bold(title)} ${dim(`(${id})`)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
function stripLeadingFrontmatter(raw: string): {
    content: string;
    frontmatter: {
        title?: string;
        tags?: string[];
    };
} {
    if (!raw.startsWith("---"))
        return { content: raw, frontmatter: {} };
    const endMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!endMatch)
        return { content: raw, frontmatter: {} };
    const block = endMatch[1];
    const rest = raw.slice(endMatch[0].length);
    const fm: {
        title?: string;
        tags?: string[];
    } = {};
    for (const line of block.split("\n")) {
        const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (!m)
            continue;
        const k = m[1];
        const v = m[2].trim();
        if (k === "title") {
            fm.title = v.replace(/^["']|["']$/g, "");
        }
        else if (k === "tags") {
            const cleaned = v.replace(/^\[|\]$/g, "");
            fm.tags = cleaned.split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        }
    }
    return { content: rest, frontmatter: fm };
}
async function runKbDelete(args: ParsedArgs): Promise<number> {
    const id = args.positional[0];
    if (!id) {
        process.stderr.write(`bp kbs delete: doc id required.\nusage: bp kbs delete <id> [-y]\n`);
        return 1;
    }
    let existing;
    try {
        existing = await getKB(id);
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
    if (!existing) {
        process.stderr.write(`${red("✗")} kb doc "${id}" not found in the current scope.\n`);
        return 1;
    }
    const ok = await confirm(`delete ${bold(existing.title)} (${id})? [y/N] `, args);
    if (!ok) {
        process.stderr.write(dim("aborted.\n"));
        return 0;
    }
    try {
        await deleteKB(id);
        process.stdout.write(`${green("✓")} deleted ${bold(existing.title)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
async function runKbEdit(args: ParsedArgs): Promise<number> {
    const id = args.positional[0];
    if (!id) {
        process.stderr.write(`bp kbs edit: doc id required.\n`);
        return 1;
    }
    let doc;
    try {
        doc = await getKB(id);
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
    if (!doc) {
        process.stderr.write(`${red("✗")} kb doc "${id}" not found.\n`);
        return 1;
    }
    const editorCmd = process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad" : "vi");
    const tokens = editorCmd.trim().split(/\s+/).filter(Boolean);
    const editor = tokens[0];
    const editorArgs = tokens.slice(1);
    const userTmpDir = path.join(os.tmpdir(), `bp-${process.getuid?.() ?? "u"}`);
    await fs.mkdir(userTmpDir, { recursive: true });
    const tmpFile = path.join(userTmpDir, `kb-edit-${process.pid}-${Date.now()}.md`);
    const original = doc.content;
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
        if (updated === original) {
            process.stdout.write(dim("no changes.\n"));
            return 0;
        }
        await saveKB({ id, title: doc.title, content: updated, tags: doc.tags, sourceGraphs: doc.sourceGraphs, collection: doc.collection });
        process.stdout.write(`${green("✓")} updated ${bold(doc.title)}\n`);
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
async function runKbGet(args: ParsedArgs): Promise<number> {
    const id = args.positional[0];
    if (!id) {
        process.stderr.write(`bp kbs get: doc id required.\n`);
        return 1;
    }
    try {
        const doc = await getKB(id);
        if (!doc) {
            process.stderr.write(`${red("✗")} kb doc "${id}" not found in the current scope.\n`);
            return 1;
        }
        const fmt = resolveFormat(args.flags);
        if (fmt === "human") {
            process.stdout.write(doc.content + (doc.content.endsWith("\n") ? "" : "\n"));
        }
        else {
            emitOne(doc, { format: fmt });
        }
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
