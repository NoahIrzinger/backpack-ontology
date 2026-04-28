import { ParsedArgs } from "../parser.js";
import { runLs } from "./ls.js";
import { runContainerCreate, runContainerRename, runContainerDelete } from "./cloud-admin.js";
export async function runContainers(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    if (!verb) {
        process.stderr.write(`bp containers: verb required.\nusage: bp containers <list|create|rename|delete> [args]\n`);
        return 1;
    }
    const sub: ParsedArgs = { positional: args.positional.slice(1), flags: args.flags, rest: args.rest };
    switch (verb) {
        case "list":
        case "ls":
            return runLs({ ...sub, positional: ["containers", ...sub.positional] });
        case "create":
        case "new":
            return runContainerCreate(sub);
        case "rename":
        case "mv":
            return runContainerRename(sub);
        case "delete":
        case "rm":
        case "remove":
            return runContainerDelete(sub);
        default:
            process.stderr.write(`bp containers: unknown verb "${verb}". try list, create, rename, or delete.\n`);
            return 1;
    }
}
