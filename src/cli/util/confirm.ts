import { ParsedArgs, flagBool } from "../parser.js";
import { yellow } from "../colors.js";
export async function confirm(prompt: string, args: ParsedArgs): Promise<boolean> {
    if (flagBool(args, "yes", "y"))
        return true;
    if (!process.stdin.isTTY) {
        process.stderr.write(`${yellow("!")} stdin is not a TTY — pass --yes to confirm in non-interactive contexts.\n`);
        return false;
    }
    process.stderr.write(prompt);
    const answer: string = await new Promise((resolve) => {
        let buf = "";
        process.stdin.setEncoding("utf8");
        const onData = (chunk: string) => {
            buf += chunk;
            const nl = buf.indexOf("\n");
            if (nl !== -1) {
                cleanup();
                resolve(buf.slice(0, nl).trim());
            }
        };
        const onEnd = () => {
            cleanup();
            resolve(buf.trim());
        };
        const cleanup = () => {
            process.stdin.removeListener("data", onData);
            process.stdin.removeListener("end", onEnd);
            process.stdin.pause();
        };
        process.stdin.on("data", onData);
        process.stdin.on("end", onEnd);
        process.stdin.resume();
    });
    return /^y(es)?$/i.test(answer);
}
