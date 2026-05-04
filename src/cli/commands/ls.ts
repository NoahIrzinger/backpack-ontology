import { ParsedArgs } from "../parser.js";
import { resolveFormat, emitList } from "../output.js";
import { dim, red, yellow } from "../colors.js";
import { listGraphs, type GraphSummary } from "../../ops/graphs.js";
import { listKB, type KBSummary } from "../../ops/kb.js";
import { describeContext, getContext } from "../../ops/context.js";
import { resolveCloudToken } from "../../ops/auth.js";
const RESOURCE_ALIASES: Record<string, "graphs" | "kbs"> = {
    graphs: "graphs", graph: "graphs", g: "graphs",
    kbs: "kbs", kb: "kbs", docs: "kbs", doc: "kbs",
};
export async function runLs(args: ParsedArgs): Promise<number> {
    const target = args.positional[0] ?? "graphs";
    const resource = RESOURCE_ALIASES[target.toLowerCase()];
    if (!resource) {
        process.stderr.write(`bp ls: unknown resource "${target}". try graphs or kbs.\n`);
        return 1;
    }
    const fmt = { format: resolveFormat(args.flags) };
    const ctx = await getContext();
    if (ctx.source === "cloud") {
        const token = await resolveCloudToken();
        if (!token) {
            process.stderr.write(`${yellow("!")} not signed in. run \`bp login\` first to list ${resource}.\n`);
            return 1;
        }
    }
    try {
        if (resource === "graphs") {
            const rows = await listGraphs();
            emitList<GraphSummary>({
                rows,
                pluralLabel: "graphs",
                empty: `no graphs in ${describeContext(await getContext())}.`,
                cols: [
                    { header: "NAME", get: (r) => r.name, max: 40 },
                    { header: "NODES", get: (r) => String(r.nodeCount), numeric: true },
                    { header: "EDGES", get: (r) => String(r.edgeCount), numeric: true },
                    { header: "FLAGS", get: (r) => r.encrypted ? yellow("encrypted") : "", wide: true },
                    { header: "DESCRIPTION", get: (r) => r.description ?? "", dim: true, max: 60, wide: true },
                ],
            }, fmt);
            return 0;
        }
        const rows = await listKB();
        emitList<KBSummary>({
            rows,
            pluralLabel: "kbs",
            empty: dim("no KB documents in the current scope."),
            cols: [
                { header: "ID", get: (r) => r.id, max: 40 },
                { header: "TITLE", get: (r) => r.title, max: 50 },
                { header: "TAGS", get: (r) => r.tags.join(","), dim: true, wide: true },
                { header: "GRAPHS", get: (r) => r.sourceGraphs.join(","), dim: true, wide: true },
            ],
        }, fmt);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
