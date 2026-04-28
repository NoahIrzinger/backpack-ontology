import { dim, bold, gray, visibleWidth } from "./colors.js";
export type OutputFormat = "human" | "json" | "yaml" | "names" | "wide";
export interface Column<T> {
    header: string;
    get: (row: T) => string;
    max?: number;
    dim?: boolean;
    wide?: boolean;
    numeric?: boolean;
}
export interface ListOptions<T> {
    rows: T[];
    cols: Column<T>[];
    nameKey?: (row: T) => string;
    pluralLabel: string;
    empty?: string;
}
export interface FormatChoice {
    format: OutputFormat;
}
export function emitList<T>(opts: ListOptions<T>, choice: FormatChoice): void {
    const { rows, cols, pluralLabel, nameKey, empty } = opts;
    switch (choice.format) {
        case "json":
            process.stdout.write(JSON.stringify({ [pluralLabel]: rows }, null, 2) + "\n");
            return;
        case "yaml":
            process.stdout.write(toYaml({ [pluralLabel]: rows }) + "\n");
            return;
        case "names": {
            const getName = nameKey ?? ((r: T) => stripAnsi(cols[0].get(r)));
            for (const r of rows)
                process.stdout.write(getName(r) + "\n");
            return;
        }
        case "wide":
            process.stdout.write(renderTable(rows, cols, true) + "\n");
            return;
        case "human":
        default:
            if (rows.length === 0 && empty) {
                process.stdout.write(dim(empty) + "\n");
                return;
            }
            process.stdout.write(renderTable(rows, cols, false) + "\n");
            return;
    }
}
export function emitOne(value: unknown, choice: FormatChoice): void {
    switch (choice.format) {
        case "json":
        case "wide":
        case "human":
            if (choice.format === "human") {
                process.stdout.write(humanizeOne(value) + "\n");
            }
            else {
                process.stdout.write(JSON.stringify(value, null, 2) + "\n");
            }
            return;
        case "yaml":
            process.stdout.write(toYaml(value) + "\n");
            return;
        case "names":
            if (value && typeof value === "object" && "name" in value) {
                process.stdout.write(String((value as {
                    name: unknown;
                }).name) + "\n");
            }
            return;
    }
}
function renderTable<T>(rows: T[], cols: Column<T>[], wide: boolean): string {
    const visible = cols.filter((c) => wide || !c.wide);
    if (visible.length === 0)
        return "";
    const termWidth = process.stdout.columns ?? 100;
    const widths = visible.map((c) => {
        const headerW = visibleWidth(c.header);
        const maxRow = rows.reduce((m, r) => Math.max(m, visibleWidth(c.get(r))), 0);
        const desired = Math.max(headerW, maxRow);
        if (c.numeric)
            return desired;
        return c.max ? Math.min(desired, c.max) : desired;
    });
    const totalGap = (visible.length - 1) * 2;
    const totalContent = widths.reduce((a, b) => a + b, 0);
    if (totalContent + totalGap > termWidth - 2) {
        let budget = termWidth - 2 - totalGap;
        if (budget < visible.length * 6) {
            return rows.map((r) => visible.map((c, i) => `${dim(visible[i].header)}: ${c.get(r)}`).join("\n")).join("\n\n");
        }
        while (widths.reduce((a, b) => a + b, 0) > budget) {
            const idx = widths.indexOf(Math.max(...widths));
            widths[idx]--;
            if (widths[idx] < 4)
                break;
        }
    }
    const lines: string[] = [];
    lines.push(visible.map((c, i) => padRight(bold(c.header), widths[i])).join("  "));
    for (const r of rows) {
        lines.push(visible.map((c, i) => {
            let cell = c.get(r);
            const w = widths[i];
            if (visibleWidth(cell) > w)
                cell = truncate(cell, w);
            cell = padRight(cell, w);
            return c.dim ? dim(cell) : cell;
        }).join("  "));
    }
    return lines.join("\n");
}
function humanizeOne(value: unknown): string {
    if (value === null || value === undefined)
        return dim("(empty)");
    if (typeof value !== "object")
        return String(value);
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined)
            continue;
        const formatted = typeof v === "object" && v !== null
            ? JSON.stringify(v, null, 2).split("\n").map((l, i) => i === 0 ? l : "  " + l).join("\n")
            : String(v);
        lines.push(`${gray(k + ":")} ${formatted}`);
    }
    return lines.join("\n");
}
function padRight(s: string, width: number): string {
    const w = visibleWidth(s);
    if (w >= width)
        return s;
    return s + " ".repeat(width - w);
}
function truncate(s: string, width: number): string {
    if (visibleWidth(s) <= width)
        return s;
    const plain = stripAnsi(s);
    if (plain.length <= width)
        return s;
    return plain.slice(0, Math.max(0, width - 1)) + "…";
}
function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function toYaml(v: unknown, indent = 0): string {
    const pad = "  ".repeat(indent);
    if (v === null || v === undefined)
        return "null";
    if (typeof v === "string")
        return yamlScalar(v);
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    if (Array.isArray(v)) {
        if (v.length === 0)
            return "[]";
        return v.map((item) => {
            if (item !== null && typeof item === "object") {
                const inner = toYaml(item, indent + 1);
                const lines = inner.split("\n");
                const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
                if (firstNonEmpty === -1)
                    return `${pad}- {}`;
                const first = lines[firstNonEmpty].replace(/^\s+/, "");
                const rest = lines.slice(firstNonEmpty + 1).join("\n");
                return rest ? `${pad}- ${first}\n${rest}` : `${pad}- ${first}`;
            }
            return `${pad}- ${toYaml(item, indent + 1)}`;
        }).join("\n");
    }
    if (typeof v === "object") {
        const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => val !== undefined);
        if (entries.length === 0)
            return "{}";
        return entries.map(([k, val]) => {
            if (val !== null && typeof val === "object") {
                const inner = toYaml(val, indent + 1);
                if (Array.isArray(val) && val.length === 0)
                    return `${pad}${k}: []`;
                if (!Array.isArray(val) && Object.keys(val as object).length === 0)
                    return `${pad}${k}: {}`;
                return `${pad}${k}:\n${inner}`;
            }
            return `${pad}${k}: ${toYaml(val, indent + 1)}`;
        }).join("\n");
    }
    return String(v);
}
function yamlScalar(s: string): string {
    const hasControl = /[\x00-\x1f]/.test(s);
    if (hasControl ||
        s === "" ||
        /[:#\[\]{},&*!|>'"%@`]|^\s|\s$|^-|^\?|^(null|true|false|yes|no)$|^-?\d/.test(s)) {
        return JSON.stringify(s);
    }
    return s;
}
export function resolveFormat(flags: Record<string, string | boolean>): OutputFormat {
    if (flags.json)
        return "json";
    if (flags.yaml)
        return "yaml";
    if (flags.names)
        return "names";
    if (flags.wide)
        return "wide";
    return "human";
}
