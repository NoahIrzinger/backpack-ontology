const NO_COLOR_ENV = process.env.NO_COLOR != null && process.env.NO_COLOR !== "";
const FORCE_COLOR_ENV = process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true";
let colorEnabled = FORCE_COLOR_ENV || (process.stdout.isTTY === true && !NO_COLOR_ENV);
export function setColorEnabled(on: boolean): void {
    colorEnabled = on;
}
export function isColorEnabled(): boolean {
    return colorEnabled;
}
function wrap(open: number, close: number) {
    return (s: string): string => (colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}
export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);
export function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}
export function visibleWidth(s: string): number {
    return [...stripAnsi(s)].length;
}
export const symbols = {
    ok: () => (colorEnabled ? green("✓") : "ok"),
    err: () => (colorEnabled ? red("✗") : "fail"),
    warn: () => (colorEnabled ? yellow("!") : "warn"),
    bullet: () => "·",
};
