export interface ParsedArgs {
    positional: string[];
    flags: Record<string, string | boolean>;
    rest: string[];
}
const KNOWN_BOOL_FLAGS = new Set([
    "json", "yaml", "names", "wide", "watch", "all", "help", "h", "H",
    "verbose", "v", "V", "quiet", "q", "yes", "y", "force", "no-color", "version",
]);
export function parseArgs(argv: string[]): ParsedArgs {
    const positional: string[] = [];
    const flags: Record<string, string | boolean> = {};
    const rest: string[] = [];
    let i = 0;
    while (i < argv.length) {
        const tok = argv[i];
        if (tok === "--") {
            rest.push(...argv.slice(i + 1));
            break;
        }
        if (tok.startsWith("--")) {
            const eq = tok.indexOf("=");
            let key: string;
            let value: string | boolean;
            if (eq !== -1) {
                key = tok.slice(2, eq);
                value = tok.slice(eq + 1);
                if (key === "") {
                    i++;
                    continue;
                }
            }
            else {
                key = tok.slice(2);
                if (key === "") {
                    i++;
                    continue;
                }
                if (key.startsWith("no-")) {
                    flags[key.slice(3)] = false;
                    i++;
                    continue;
                }
                if (key.startsWith("-")) {
                    key = key.replace(/^-+/, "");
                    if (key === "") {
                        i++;
                        continue;
                    }
                }
                const next = argv[i + 1];
                if (KNOWN_BOOL_FLAGS.has(key) || next === undefined || next.startsWith("-")) {
                    value = true;
                }
                else {
                    value = next;
                    i++;
                }
            }
            flags[key] = value;
        }
        else if (tok.startsWith("-") && tok.length > 1) {
            const chars = tok.slice(1);
            for (let j = 0; j < chars.length; j++) {
                const k = chars[j];
                const isLast = j === chars.length - 1;
                if (isLast) {
                    const next = argv[i + 1];
                    if (KNOWN_BOOL_FLAGS.has(k) || next === undefined || next.startsWith("-")) {
                        flags[k] = true;
                    }
                    else {
                        flags[k] = next;
                        i++;
                    }
                }
                else {
                    flags[k] = true;
                }
            }
        }
        else {
            positional.push(tok);
        }
        i++;
    }
    return { positional, flags, rest };
}
export function flagBool(args: ParsedArgs, ...keys: string[]): boolean {
    for (const k of keys) {
        const v = args.flags[k];
        if (v === true)
            return true;
        if (v === "true" || v === "1")
            return true;
        if (v === false || v === "false" || v === "0")
            return false;
    }
    return false;
}
export function flagString(args: ParsedArgs, ...keys: string[]): string | undefined {
    for (const k of keys) {
        const v = args.flags[k];
        if (typeof v === "string")
            return v;
        if (v === true)
            return undefined;
    }
    return undefined;
}
