import { ParsedArgs, flagString } from "../parser.js";
import { searchGraphs } from "../../ops/graphs.js";
import { resolveFormat, emitList } from "../output.js";
import { dim, bold, red, yellow } from "../colors.js";
export async function runSearch(args: ParsedArgs): Promise<number> {
    const query = args.positional.join(" ").trim();
    if (!query) {
        process.stderr.write(`bp search: query required.\nusage: bp search <query>\n`);
        return 1;
    }
    const maxGraphs = parseInt(flagString(args, "max-graphs") ?? "", 10);
    try {
        const result = await searchGraphs(query, {
            maxGraphs: Number.isFinite(maxGraphs) && maxGraphs > 0 ? maxGraphs : undefined,
        });
        const fmt = resolveFormat(args.flags);
        if (fmt === "json" || fmt === "yaml") {
            emitList({
                rows: result.hits,
                pluralLabel: "hits",
                cols: [
                    { header: "GRAPH", get: (r) => r.graphName },
                    { header: "TYPE", get: (r) => r.nodeType },
                    { header: "LABEL", get: (r) => r.label },
                    { header: "ID", get: (r) => r.nodeId },
                ],
            }, { format: fmt });
            return 0;
        }
        emitList({
            rows: result.hits,
            pluralLabel: "hits",
            empty: dim(`no matches for "${query}".`),
            cols: [
                { header: "GRAPH", get: (r) => r.graphName, max: 32 },
                { header: "TYPE", get: (r) => r.nodeType, max: 20 },
                { header: "LABEL", get: (r) => r.label, max: 60 },
                { header: "ID", get: (r) => r.nodeId, dim: true, wide: true },
            ],
        }, { format: fmt });
        if (fmt === "names")
            return 0;
        const notes: string[] = [];
        if (result.hits.length > 0)
            notes.push(`${result.hits.length} match${result.hits.length === 1 ? "" : "es"} for "${bold(query)}"`);
        if (result.graphsSkipped > 0)
            notes.push(yellow(`skipped ${result.graphsSkipped} encrypted graph${result.graphsSkipped === 1 ? "" : "s"}`));
        if (result.truncated)
            notes.push(yellow(`only scanned the first ${result.graphsScanned} of ${result.graphsInScope} graphs — pass --max-graphs to widen`));
        if (notes.length > 0)
            process.stdout.write("\n  " + dim(notes.join(" · ")) + "\n");
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
