import { ParsedArgs } from "../parser.js";
import { authStatus } from "../../ops/auth.js";
import { getContext, setContext, listContexts, resolveContextName, describeContext, } from "../../ops/context.js";
import { bold, dim, green, red, cyan } from "../colors.js";
export async function runWhere(): Promise<number> {
    const ctx = await getContext();
    const auth = await authStatus();
    process.stdout.write(`context: ${bold(describeContext(ctx))}\n`);
    if (ctx.source === "local" && ctx.backpackPath) {
        process.stdout.write(dim(`  path: ${ctx.backpackPath}\n`));
    }
    else if (ctx.source === "cloud") {
        process.stdout.write(dim(`  endpoint: ${auth.endpoint}\n`));
    }
    if (auth.authenticated) {
        process.stdout.write(dim(`  identity: ${auth.email ?? "(unknown email)"}\n`));
    }
    else {
        process.stdout.write(dim(`  identity: ${dim("not signed in")}\n`));
    }
    return 0;
}
export async function runUse(args: ParsedArgs): Promise<number> {
    const target = args.positional[0];
    if (!target) {
        const all = await listContexts();
        if (all.length === 0) {
            process.stdout.write(`${dim("no contexts available. register a local backpack or run")} ${bold("bp login")}\n`);
            return 0;
        }
        const cur = describeContext(await getContext());
        process.stdout.write(bold("available contexts:") + "\n");
        for (const c of all) {
            const marker = c.name === cur ? cyan("*") : " ";
            process.stdout.write(`  ${marker} ${bold(c.name)}${c.detail ? dim("  " + c.detail) : ""}\n`);
        }
        process.stdout.write(dim("\nuse: bp use <name>\n"));
        return 0;
    }
    const result = await resolveContextName(target);
    if (!result.ctx) {
        if ("ambiguous" in result && result.ambiguous && result.ambiguous.length > 0) {
            process.stderr.write(`${red("✗")} ${bold(target)} is ambiguous — matches multiple contexts:\n`);
            for (const name of result.ambiguous) {
                process.stderr.write(`  - ${bold(name)}\n`);
            }
            process.stderr.write(dim(`pass the full name (e.g. \`bp use ${result.ambiguous[0]}\`).\n`));
            return 1;
        }
        process.stderr.write(`${red("✗")} no context named ${bold(target)}\n`);
        if ("suggestions" in result && result.suggestions && result.suggestions.length > 0) {
            process.stderr.write(dim(`  did you mean: ${result.suggestions.join(", ")}?\n`));
        }
        return 1;
    }
    await setContext(result.ctx);
    process.stdout.write(`${green("✓")} context → ${bold(result.ctx.name)}\n`);
    return 0;
}
