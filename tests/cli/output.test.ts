import { describe, it, expect, vi } from "vitest";
import { emitList, emitOne, resolveFormat, type Column } from "../../src/cli/output.js";
import { setColorEnabled } from "../../src/cli/colors.js";
interface Row {
    name: string;
    count: number;
}
const cols: Column<Row>[] = [
    { header: "NAME", get: (r) => r.name },
    { header: "COUNT", get: (r) => String(r.count) },
];
function captureStdout(fn: () => void): string {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
        writes.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    setColorEnabled(false);
    try {
        fn();
    }
    finally {
        spy.mockRestore();
    }
    return writes.join("");
}
describe("emitList", () => {
    const rows: Row[] = [{ name: "alpha", count: 3 }, { name: "beta", count: 12 }];
    it("--json emits a stable shape", () => {
        const out = captureStdout(() => emitList({ rows, cols, pluralLabel: "items" }, { format: "json" }));
        const parsed = JSON.parse(out);
        expect(parsed).toEqual({ items: rows });
    });
    it("--names emits one name per line", () => {
        const out = captureStdout(() => emitList({ rows, cols, pluralLabel: "items" }, { format: "names" }));
        expect(out).toBe("alpha\nbeta\n");
    });
    it("--yaml emits valid YAML", () => {
        const out = captureStdout(() => emitList({ rows, cols, pluralLabel: "items" }, { format: "yaml" }));
        expect(out).toContain("items:");
        expect(out).toContain("name: alpha");
        expect(out).toContain("count: 12");
    });
    it("human format renders a table with headers", () => {
        const out = captureStdout(() => emitList({ rows, cols, pluralLabel: "items" }, { format: "human" }));
        expect(out).toContain("NAME");
        expect(out).toContain("alpha");
        expect(out).toContain("12");
    });
    it("human format shows the empty message when no rows", () => {
        const out = captureStdout(() => emitList({ rows: [], cols, pluralLabel: "items", empty: "no items yet." }, { format: "human" }));
        expect(out).toContain("no items yet.");
    });
    it("--names with no nameKey falls back to first column", () => {
        const out = captureStdout(() => emitList({ rows, cols, pluralLabel: "items" }, { format: "names" }));
        expect(out).toBe("alpha\nbeta\n");
    });
});
describe("emitOne", () => {
    it("--json emits the record verbatim", () => {
        const out = captureStdout(() => emitOne({ name: "foo", count: 1 }, { format: "json" }));
        expect(JSON.parse(out)).toEqual({ name: "foo", count: 1 });
    });
    it("--yaml emits YAML for the record", () => {
        const out = captureStdout(() => emitOne({ name: "foo", count: 1 }, { format: "yaml" }));
        expect(out).toContain("name: foo");
        expect(out).toContain("count: 1");
    });
    it("--names emits just the name field", () => {
        const out = captureStdout(() => emitOne({ name: "foo" }, { format: "names" }));
        expect(out).toBe("foo\n");
    });
    it("human format prints key: value lines", () => {
        const out = captureStdout(() => emitOne({ name: "foo", count: 1 }, { format: "human" }));
        expect(out).toContain("name:");
        expect(out).toContain("foo");
        expect(out).toContain("count:");
    });
});
describe("YAML scalar quoting", () => {
    it("quotes strings containing colons", () => {
        const out = captureStdout(() => emitOne({ desc: "key: value" }, { format: "yaml" }));
        expect(out).toContain('"key: value"');
    });
    it("quotes strings starting with a leading dash", () => {
        const out = captureStdout(() => emitOne({ desc: "-leading" }, { format: "yaml" }));
        expect(out).toMatch(/desc: ".*-leading"/);
    });
    it("quotes strings starting with #", () => {
        const out = captureStdout(() => emitOne({ desc: "#comment-like" }, { format: "yaml" }));
        expect(out).toMatch(/desc: ".*#comment-like"/);
    });
    it("quotes strings that look like booleans/numbers", () => {
        const out = captureStdout(() => emitOne({ a: "true", b: "42", c: "null" }, { format: "yaml" }));
        expect(out).toContain('a: "true"');
        expect(out).toContain('b: "42"');
        expect(out).toContain('c: "null"');
    });
    it("encodes newlines as JSON-style escapes (valid YAML 1.2 double-quoted)", () => {
        const out = captureStdout(() => emitOne({ desc: "first\nsecond" }, { format: "yaml" }));
        expect(out).toContain('"first\\nsecond"');
    });
    it("does not quote plain strings", () => {
        const out = captureStdout(() => emitOne({ desc: "plain-string" }, { format: "yaml" }));
        expect(out).toContain("desc: plain-string");
        expect(out).not.toContain('"plain-string"');
    });
    it("emits empty array as []", () => {
        const out = captureStdout(() => emitOne({ tags: [] }, { format: "yaml" }));
        expect(out).toContain("tags: []");
    });
});
describe("resolveFormat", () => {
    it("returns json when --json is set", () => {
        expect(resolveFormat({ json: true })).toBe("json");
    });
    it("returns yaml when --yaml is set", () => {
        expect(resolveFormat({ yaml: true })).toBe("yaml");
    });
    it("returns names when --names is set", () => {
        expect(resolveFormat({ names: true })).toBe("names");
    });
    it("returns wide when --wide is set", () => {
        expect(resolveFormat({ wide: true })).toBe("wide");
    });
    it("defaults to human", () => {
        expect(resolveFormat({})).toBe("human");
    });
    it("--json wins over --yaml", () => {
        expect(resolveFormat({ json: true, yaml: true })).toBe("json");
    });
});
