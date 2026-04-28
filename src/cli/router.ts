import { ParsedArgs, parseArgs, flagBool } from "./parser.js";
import { setColorEnabled } from "./colors.js";
import { printHint, printFullHelp } from "./help.js";
import { runVersion } from "./commands/version.js";
import { runDoctor } from "./commands/doctor.js";
import { runLogin, runLogout, runWhoami } from "./commands/auth.js";
import { runWhere, runUse } from "./commands/context.js";
import { runLs } from "./commands/ls.js";
import { runCat } from "./commands/cat.js";
import { runShow } from "./commands/show.js";
import { runOpen } from "./commands/open.js";
import { runSearch } from "./commands/search.js";
import { runGraphs } from "./commands/graphs.js";
import { runContainers } from "./commands/containers.js";
import { runKbs } from "./commands/kbs.js";
import { runDelete, runRename } from "./commands/mutate.js";
import { runInit } from "./commands/init.js";
import { runCompletion } from "./commands/completion.js";
type Handler = (args: ParsedArgs) => Promise<number>;
const COMMANDS: Record<string, Handler> = {
    help: async () => { printFullHelp(); return 0; },
    version: async () => runVersion(),
    doctor: runDoctor,
    login: runLogin,
    logout: runLogout,
    whoami: runWhoami,
    where: runWhere,
    use: runUse,
    ls: runLs,
    cat: runCat,
    show: runShow,
    open: runOpen,
    search: runSearch,
    rm: runDelete,
    mv: runRename,
    init: runInit,
    completion: runCompletion,
    graphs: runGraphs, graph: runGraphs,
    containers: runContainers, container: runContainers,
    kbs: runKbs, kb: runKbs,
};
export async function run(rawArgv: string[]): Promise<number> {
    const args = parseArgs(rawArgv);
    if (args.flags.color === false)
        setColorEnabled(false);
    if (args.positional.length === 0 && Object.keys(args.flags).length === 0) {
        printHint();
        return 0;
    }
    if (flagBool(args, "version", "V") && args.positional.length === 0) {
        return runVersion();
    }
    if (flagBool(args, "help", "h") && args.positional.length === 0) {
        printFullHelp();
        return 0;
    }
    const cmd = args.positional[0];
    const handler = COMMANDS[cmd];
    if (!handler) {
        process.stderr.write(`bp: unknown command "${cmd}"\n`);
        const suggestion = closestCommand(cmd, Object.keys(COMMANDS));
        if (suggestion) {
            process.stderr.write(`  did you mean \`bp ${suggestion}\`?\n`);
        }
        process.stderr.write(`run \`bp help\` for the full list of commands\n`);
        return 1;
    }
    const handlerArgs: ParsedArgs = {
        positional: args.positional.slice(1),
        flags: args.flags,
        rest: args.rest,
    };
    try {
        const result = await handler(handlerArgs);
        if (typeof result !== "number") {
            process.stderr.write(`bp: command "${cmd}" returned ${typeof result} (expected number) — treating as failure\n`);
            return 1;
        }
        return result;
    }
    catch (err) {
        process.stderr.write(`bp: ${(err as Error).message}\n`);
        return 1;
    }
}
function closestCommand(typed: string, options: string[]): string | null {
    if (!typed)
        return null;
    let best: {
        name: string;
        score: number;
    } | null = null;
    for (const name of options) {
        const d = levenshtein(typed.toLowerCase(), name.toLowerCase());
        const score = name.length - d;
        if (!best || score > best.score)
            best = { name, score };
    }
    if (!best)
        return null;
    const ratio = (best.score + typed.length) / (2 * typed.length);
    return ratio >= 0.6 ? best.name : null;
}
function levenshtein(a: string, b: string): number {
    if (a === b)
        return 0;
    const al = a.length, bl = b.length;
    if (al === 0)
        return bl;
    if (bl === 0)
        return al;
    const prev = new Array(bl + 1);
    const curr = new Array(bl + 1);
    for (let j = 0; j <= bl; j++)
        prev[j] = j;
    for (let i = 1; i <= al; i++) {
        curr[0] = i;
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= bl; j++)
            prev[j] = curr[j];
    }
    return prev[bl];
}
