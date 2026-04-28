import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
export async function runVersion(): Promise<number> {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(dir, "..", "..", "..", "package.json");
    let version = "unknown";
    try {
        const raw = await fs.readFile(pkgPath, "utf8");
        version = (JSON.parse(raw) as {
            version?: string;
        }).version ?? "unknown";
    }
    catch { }
    process.stdout.write(`bp ${version}  (node ${process.version})\n`);
    return 0;
}
