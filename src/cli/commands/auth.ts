import { authStatus, login as opsLogin, logout as opsLogout } from "../../ops/auth.js";
import { dim, green, red, yellow, bold } from "../colors.js";
export async function runLogin(): Promise<number> {
    const before = await authStatus();
    if (before.authenticated) {
        process.stdout.write(`${green("✓")} already signed in${before.email ? ` as ${bold(before.email)}` : ""}\n`);
        process.stdout.write(dim(`  endpoint: ${before.endpoint}\n`));
        return 0;
    }
    process.stdout.write(`opening browser to sign in at ${dim(before.endpoint)} …\n`);
    try {
        const { email } = await opsLogin();
        process.stdout.write(`${green("✓")} signed in${email ? ` as ${bold(email)}` : ""}\n`);
        return 0;
    }
    catch (err) {
        process.stderr.write(`${red("✗")} sign-in failed: ${(err as Error).message}\n`);
        return 1;
    }
}
export async function runLogout(): Promise<number> {
    const { cleared, errors } = await opsLogout();
    if (errors.length > 0) {
        process.stderr.write(`${red("✗")} sign-out incomplete — ${errors.length} token location${errors.length === 1 ? "" : "s"} could not be cleared:\n`);
        for (const e of errors) {
            process.stderr.write(`  - ${e.path}: ${e.reason}\n`);
        }
        process.stderr.write(`${dim("your token may still be readable. inspect those files manually.")}\n`);
        return 1;
    }
    if (cleared === 0) {
        process.stdout.write(`${yellow("!")} not signed in\n`);
        return 0;
    }
    process.stdout.write(`${green("✓")} signed out (cleared ${cleared} token file${cleared === 1 ? "" : "s"})\n`);
    return 0;
}
export async function runWhoami(): Promise<number> {
    const status = await authStatus();
    if (!status.authenticated) {
        process.stdout.write(`${dim("not signed in.")} run ${bold("bp login")} to authenticate.\n`);
        return 0;
    }
    process.stdout.write(`${bold(status.email ?? "signed in")}\n`);
    process.stdout.write(dim(`  endpoint: ${status.endpoint}\n`));
    return 0;
}
