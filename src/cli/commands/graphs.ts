import { ParsedArgs } from "../parser.js";
import { runLs } from "./ls.js";
import { runCat } from "./cat.js";
import { runShow } from "./show.js";
import { runCreate, runDelete, runRename, runApply, runEdit } from "./mutate.js";
import { runMoveGraph } from "./cloud-admin.js";
import { getGraphSummary } from "../../ops/graphs.js";
export async function runGraphs(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    if (!verb) {
        process.stderr.write(`bp graphs: verb required.\nusage: bp graphs <list|get|describe> [args]\n`);
        return 1;
    }
    const sub: ParsedArgs = { positional: args.positional.slice(1), flags: args.flags, rest: args.rest };
    switch (verb) {
        case "list":
        case "ls":
            return runLs({ ...sub, positional: ["graphs", ...sub.positional] });
        case "get":
        case "cat":
            return runCat(sub);
        case "describe":
        case "show":
            return runShow(sub);
        case "create":
        case "new":
            return runCreate(sub);
        case "delete":
        case "rm":
        case "remove":
            return runDelete(sub);
        case "rename":
        case "mv":
            return runRename(sub);
        case "apply":
            return runApply(sub);
        case "edit":
            return runEdit(sub);
        case "move":
        case "mv-to":
            return runMoveGraph(sub);
        default: {
            const couldBeName = args.positional.length === 1 && verb && !verb.startsWith("-");
            if (couldBeName) {
                try {
                    const summary = await getGraphSummary(verb);
                    if (summary) {
                        return runShow({ positional: [verb], flags: args.flags, rest: args.rest });
                    }
                }
                catch { }
            }
            process.stderr.write(`bp graphs: unknown verb "${verb}". try list, get, or describe.\n`);
            return 1;
        }
    }
}
