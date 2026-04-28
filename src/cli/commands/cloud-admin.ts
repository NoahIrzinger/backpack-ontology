import { ParsedArgs, flagString } from "../parser.js";
import { createContainer, renameContainer, deleteContainer, moveGraphToContainer, moveKBToContainer, } from "../../ops/containers.js";
import { listGraphs } from "../../ops/graphs.js";
import { listKB } from "../../ops/kb.js";
import { getContext } from "../../ops/context.js";
import { confirm } from "../util/confirm.js";
import { red, green, dim, bold, yellow } from "../colors.js";
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
function parseTags(raw: string | undefined): string[] | undefined {
    if (raw === undefined)
        return undefined;
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
    return tags;
}
export async function runContainerCreate(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp containers create: name required.\nusage: bp containers create <name> [--color=#RRGGBB] [--tags=a,b,c]\n`);
        return 1;
    }
    const color = flagString(args, "color");
    if (color && !HEX_COLOR.test(color)) {
        process.stderr.write(`${red("✗")} --color must be #RRGGBB hex (got "${color}").\n`);
        return 1;
    }
    const tags = parseTags(flagString(args, "tags"));
    try {
        const { container, created } = await createContainer(name, { color, tags });
        const verb = created ? "created" : "already exists, no change to";
        process.stdout.write(`${green("✓")} ${verb} ${bold(container.name)} ${dim(`(${container.id})`)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runContainerRename(args: ParsedArgs): Promise<number> {
    const [oldName, newName] = args.positional;
    if (!oldName) {
        process.stderr.write(`bp containers rename: name required.\nusage: bp containers rename <old> <new> [--color=#xxx] [--tags=a,b,c]\n`);
        return 1;
    }
    const color = flagString(args, "color");
    if (color && !HEX_COLOR.test(color)) {
        process.stderr.write(`${red("✗")} --color must be #RRGGBB hex (got "${color}").\n`);
        return 1;
    }
    const tags = parseTags(flagString(args, "tags"));
    try {
        const updated = await renameContainer(oldName, { newName, color, tags });
        if (newName) {
            process.stdout.write(`${green("✓")} ${bold(oldName)} → ${bold(updated.name)}\n`);
        }
        else {
            process.stdout.write(`${green("✓")} updated ${bold(updated.name)}\n`);
        }
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runContainerDelete(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp containers delete: name required.\nusage: bp containers delete <name> [-y]\n`);
        return 1;
    }
    const ctx = await getContext();
    const wasContainer = ctx.cloudContainer;
    let graphCount = 0;
    let kbCount = 0;
    try {
        const probeCtx = { source: "cloud" as const, cloudContainer: name };
        const { setContext } = await import("../../ops/context.js");
        await setContext(probeCtx);
        try {
            const graphs = await listGraphs();
            graphCount = graphs.length;
            const kbs = await listKB();
            kbCount = kbs.length;
        }
        finally {
            await setContext(ctx).catch(() => { });
            void wasContainer;
        }
    }
    catch {
    }
    const stakes = graphCount + kbCount > 0
        ? `  ${yellow(`it has ${graphCount} graph${graphCount === 1 ? "" : "s"} and ${kbCount} KB doc${kbCount === 1 ? "" : "s"} — server will refuse unless you move them out first`)}\n`
        : "";
    process.stderr.write(stakes);
    const ok = await confirm(`delete cloud container ${bold(name)}? [y/N] `, args);
    if (!ok) {
        process.stderr.write(dim("aborted.\n"));
        return 0;
    }
    try {
        await deleteContainer(name);
        process.stdout.write(`${green("✓")} deleted container ${bold(name)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runMoveGraph(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    const to = flagString(args, "to", "t");
    if (!name) {
        process.stderr.write(`bp graphs move: graph name required.\nusage: bp graphs move <name> --to <container>\n`);
        return 1;
    }
    if (!to) {
        process.stderr.write(`bp graphs move: --to <container> required.\n`);
        return 1;
    }
    let from: string | undefined;
    try {
        const ctx = await getContext();
        const probeCtx = { source: "cloud" as const, cloudContainer: undefined };
        const { setContext } = await import("../../ops/context.js");
        await setContext(probeCtx);
        try {
            const all = await listGraphs();
            from = all.find((g) => g.name === name)?.sourceBackpack;
        }
        finally {
            await setContext(ctx).catch(() => { });
        }
    }
    catch { }
    try {
        await moveGraphToContainer(name, to);
        const fromStr = from ? `${dim(from)} → ` : "";
        process.stdout.write(`${green("✓")} moved ${bold(name)}: ${fromStr}${bold(to)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runMoveKB(args: ParsedArgs): Promise<number> {
    const id = args.positional[0];
    const to = flagString(args, "to", "t");
    if (!id) {
        process.stderr.write(`bp kbs move: doc id required.\nusage: bp kbs move <id> --to <container>\n`);
        return 1;
    }
    if (!to) {
        process.stderr.write(`bp kbs move: --to <container> required.\n`);
        return 1;
    }
    try {
        await moveKBToContainer(id, to);
        process.stdout.write(`${green("✓")} moved ${bold(id)} → ${bold(to)}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
