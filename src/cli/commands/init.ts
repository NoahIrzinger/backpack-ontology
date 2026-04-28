import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ParsedArgs } from "../parser.js";
import { configDir } from "../../core/paths.js";
import { setContext } from "../../ops/context.js";
import { red, green, dim, bold, yellow } from "../colors.js";
interface BackpacksRegistry {
    version?: number;
    paths: string[];
    active?: string;
}
export async function runInit(args: ParsedArgs): Promise<number> {
    const target = args.positional[0]
        ? path.resolve(args.positional[0])
        : process.cwd();
    try {
        const stat = await fs.stat(target);
        if (!stat.isDirectory()) {
            process.stderr.write(`${red("✗")} ${target} is not a directory.\n`);
            return 1;
        }
    }
    catch {
    }
    await fs.mkdir(target, { recursive: true });
    const regPath = path.join(configDir(), "backpacks.json");
    let reg: BackpacksRegistry;
    try {
        const raw = await fs.readFile(regPath, "utf8");
        reg = JSON.parse(raw) as BackpacksRegistry;
        if (!Array.isArray(reg.paths))
            reg.paths = [];
    }
    catch {
        reg = { version: 2, paths: [] };
    }
    if (reg.paths.includes(target)) {
        process.stdout.write(`${yellow("!")} ${dim(target)} is already registered.\n`);
    }
    else {
        reg.paths.push(target);
        process.stdout.write(`${green("✓")} registered ${bold(target)}\n`);
    }
    reg.active = target;
    await fs.mkdir(path.dirname(regPath), { recursive: true });
    await fs.writeFile(regPath, JSON.stringify(reg, null, 2), "utf8");
    await setContext({ source: "local", backpackPath: target });
    process.stdout.write(`${green("✓")} active context → ${bold("local:" + path.basename(target))}\n`);
    process.stdout.write(dim("\n  ready. try: `bp ls` to see what's in this backpack (it'll be empty until you create graphs).\n"));
    return 0;
}
