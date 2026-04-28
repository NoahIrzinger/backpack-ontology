import { ParsedArgs } from "../parser.js";
import { getGraph, getGraphSummary } from "../../ops/graphs.js";
import { resolveFormat, emitOne } from "../output.js";
import { bold, dim, red, yellow, cyan } from "../colors.js";
export async function runShow(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp show: graph name required.\nusage: bp show <name>\n`);
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
    const fmt = resolveFormat(args.flags);
    if (fmt !== "human") {
        let data;
        if (!summary.encrypted) {
            const r = await getGraph(name).catch(() => null);
            if (r && r.kind === "ok")
                data = r.data;
        }
        emitOne({ ...summary, data }, { format: fmt });
        return 0;
    }
    process.stdout.write(`${bold(summary.name)}${summary.encrypted ? "  " + yellow("[encrypted]") : ""}${summary.origin === "cloud" ? "  " + dim("(cloud)") : ""}\n`);
    if (summary.description)
        process.stdout.write(`  ${summary.description}\n`);
    process.stdout.write(`  ${cyan(String(summary.nodeCount))} nodes, ${cyan(String(summary.edgeCount))} edges\n`);
    if (summary.tags && summary.tags.length > 0) {
        process.stdout.write(`  ${dim("tags:")} ${summary.tags.join(", ")}\n`);
    }
    if (summary.sourceBackpack) {
        process.stdout.write(`  ${dim("container:")} ${summary.sourceBackpack}\n`);
    }
    if (summary.encrypted) {
        process.stdout.write(`\n  ${yellow("encrypted graph — open in your local viewer to inspect contents.")}\n`);
        return 0;
    }
    const HISTOGRAM_NODE_LIMIT = 50000;
    try {
        const r = await getGraph(name);
        if (r.kind === "ok" && Array.isArray(r.data.nodes)) {
            if (r.data.nodes.length > HISTOGRAM_NODE_LIMIT) {
                process.stdout.write(dim(`\n  (graph has ${r.data.nodes.length} nodes — type histogram skipped; use \`bp cat ${name} | jq '.nodes | group_by(.type)'\`)\n`));
            }
            else {
                const types = new Map<string, number>();
                for (const n of r.data.nodes)
                    types.set(n.type, (types.get(n.type) ?? 0) + 1);
                if (types.size > 0) {
                    process.stdout.write("\n  " + bold("types") + "\n");
                    const sorted = [...types.entries()].sort((a, b) => b[1] - a[1]);
                    for (const [t, c] of sorted.slice(0, 12)) {
                        process.stdout.write(`    ${cyan(String(c).padStart(4))}  ${t}\n`);
                    }
                    if (sorted.length > 12)
                        process.stdout.write(dim(`    … ${sorted.length - 12} more\n`));
                }
            }
        }
    }
    catch {
    }
    return 0;
}
