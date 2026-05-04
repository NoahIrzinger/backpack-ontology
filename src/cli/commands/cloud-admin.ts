import { ParsedArgs } from "../parser.js";
import { red } from "../colors.js";
export async function runMoveGraph(_args: ParsedArgs): Promise<number> {
    process.stderr.write(`${red("✗")} bp graphs move: cloud containers have been removed. Graphs belong to your cloud account directly.\n`);
    return 1;
}
export async function runMoveKB(_args: ParsedArgs): Promise<number> {
    process.stderr.write(`${red("✗")} bp kbs move: cloud containers have been removed. KB docs belong to your cloud account directly.\n`);
    return 1;
}
