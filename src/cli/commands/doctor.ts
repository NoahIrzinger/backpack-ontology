import { ParsedArgs, flagBool } from "../parser.js";
import { resolveCloudToken, getRelayUrl, emailFromToken, assertSafeRelay } from "../../ops/auth.js";
import { getContext, describeContext } from "../../ops/context.js";
import { bold, green, red, yellow } from "../colors.js";
interface CheckResult {
    name: string;
    ok: boolean;
    detail: string;
}
export async function runDoctor(args: ParsedArgs): Promise<number> {
    const checks: CheckResult[] = [];
    try {
        const ctx = await getContext();
        checks.push({ name: "context", ok: true, detail: describeContext(ctx) });
    }
    catch (err) {
        checks.push({ name: "context", ok: false, detail: (err as Error).message });
    }
    const token = await resolveCloudToken();
    if (token) {
        const email = emailFromToken(token);
        checks.push({ name: "auth", ok: true, detail: `signed in${email ? ` as ${email}` : ""}` });
    }
    else {
        checks.push({ name: "auth", ok: false, detail: "not signed in (run `bp login`)" });
    }
    if (token) {
        try {
            assertSafeRelay(getRelayUrl());
            const res = await fetch(`${getRelayUrl()}/api/sync/backpacks`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                checks.push({ name: "cloud", ok: true, detail: `${getRelayUrl()} reachable (HTTP ${res.status})` });
            }
            else if (res.status === 401) {
                checks.push({ name: "cloud", ok: false, detail: `${getRelayUrl()} rejected token (HTTP 401) — re-run \`bp login\`` });
            }
            else {
                checks.push({ name: "cloud", ok: false, detail: `${getRelayUrl()} (HTTP ${res.status})` });
            }
        }
        catch (err) {
            checks.push({ name: "cloud", ok: false, detail: `${getRelayUrl()} unreachable: ${(err as Error).message}` });
        }
    }
    else {
        checks.push({ name: "cloud", ok: true, detail: "skipped (not signed in)" });
    }
    const major = parseInt(process.versions.node.split(".")[0], 10);
    if (major >= 18) {
        checks.push({ name: "node", ok: true, detail: process.versions.node });
    }
    else {
        checks.push({ name: "node", ok: false, detail: `${process.versions.node} (need >= 18)` });
    }
    if (flagBool(args, "json")) {
        process.stdout.write(JSON.stringify({ checks }, null, 2) + "\n");
    }
    else {
        for (const c of checks) {
            const mark = c.ok ? green("✓") : red("✗");
            process.stdout.write(`${mark} ${bold(c.name.padEnd(8))} ${c.ok ? c.detail : yellow(c.detail)}\n`);
        }
        const failures = checks.filter((c) => !c.ok).length;
        process.stdout.write("\n" + (failures === 0 ? green("everything looks good.") : red(`${failures} check${failures === 1 ? "" : "s"} failed.`)) + "\n");
    }
    return checks.every((c) => c.ok) ? 0 : 1;
}
