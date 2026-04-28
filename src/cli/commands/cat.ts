import { ParsedArgs } from "../parser.js";
import { getGraph } from "../../ops/graphs.js";
import { red, yellow } from "../colors.js";
export async function runCat(args: ParsedArgs): Promise<number> {
    const name = args.positional[0];
    if (!name) {
        process.stderr.write(`bp cat: graph name required.\nusage: bp cat <name>\n`);
        return 1;
    }
    try {
        const result = await getGraph(name);
        switch (result.kind) {
            case "ok":
                process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
                return 0;
            case "encrypted":
                process.stderr.write(`${yellow("!")} graph "${name}" is encrypted — open it in the local viewer to decrypt.\n`);
                return 1;
            case "missing":
                process.stderr.write(`${red("✗")} graph "${name}" not found in the current scope.\n`);
                return 1;
        }
    }
    catch (err) {
        process.stderr.write(`${red("✗")} ${(err as Error).message}\n`);
        return 1;
    }
}
