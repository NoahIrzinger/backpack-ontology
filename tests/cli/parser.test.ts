import { describe, it, expect } from "vitest";
import { parseArgs, flagBool, flagString } from "../../src/cli/parser.js";
describe("parseArgs", () => {
    it("splits positional from flags", () => {
        const r = parseArgs(["graphs", "list", "--json"]);
        expect(r.positional).toEqual(["graphs", "list"]);
        expect(r.flags).toEqual({ json: true });
        expect(r.rest).toEqual([]);
    });
    it("accepts --key=value", () => {
        const r = parseArgs(["use", "--name=foo"]);
        expect(r.positional).toEqual(["use"]);
        expect(r.flags).toEqual({ name: "foo" });
    });
    it("accepts --key value when next isn't a flag", () => {
        const r = parseArgs(["graphs", "move", "x", "--to", "client-acme"]);
        expect(r.positional).toEqual(["graphs", "move", "x"]);
        expect(r.flags).toEqual({ to: "client-acme" });
    });
    it("treats known boolean flags as boolean even if followed by a non-flag", () => {
        const r = parseArgs(["ls", "--json", "graphs"]);
        expect(r.positional).toEqual(["ls", "graphs"]);
        expect(r.flags).toEqual({ json: true });
    });
    it("supports --no-key as boolean false", () => {
        const r = parseArgs(["foo", "--no-color"]);
        expect(r.flags).toEqual({ color: false });
    });
    it("handles bundled short flags", () => {
        const r = parseArgs(["foo", "-yh"]);
        expect(r.flags).toEqual({ y: true, h: true });
    });
    it("short flag with value", () => {
        const r = parseArgs(["use", "-n", "projects"]);
        expect(r.flags).toEqual({ n: "projects" });
    });
    it("-- stops flag parsing", () => {
        const r = parseArgs(["search", "--", "--literal-arg"]);
        expect(r.positional).toEqual(["search"]);
        expect(r.rest).toEqual(["--literal-arg"]);
    });
    it("flagBool reads any of multiple aliases", () => {
        const r = parseArgs(["foo", "-y"]);
        expect(flagBool(r, "yes", "y")).toBe(true);
        expect(flagBool(r, "yes")).toBe(false);
    });
    it("flagString returns undefined for absent flags", () => {
        const r = parseArgs(["foo"]);
        expect(flagString(r, "name")).toBeUndefined();
    });
    it("flagString returns undefined when the flag is set without a value", () => {
        const r = parseArgs(["foo", "--name"]);
        expect(flagString(r, "name")).toBeUndefined();
    });
    it("ignores --=value (empty key)", () => {
        const r = parseArgs(["foo", "--=value"]);
        expect(r.flags).toEqual({});
        expect(r.positional).toEqual(["foo"]);
    });
    it("normalizes --- prefix to a regular flag", () => {
        const r = parseArgs(["foo", "---bar"]);
        expect(r.flags).toEqual({ bar: true });
    });
    it("accepts empty value (--name=)", () => {
        const r = parseArgs(["foo", "--name="]);
        expect(r.flags).toEqual({ name: "" });
    });
    it("treats single - as a positional argument (stdin convention)", () => {
        const r = parseArgs(["cat", "-"]);
        expect(r.positional).toEqual(["cat", "-"]);
        expect(r.flags).toEqual({});
    });
    it("`--` with no following tokens just stops parsing", () => {
        const r = parseArgs(["foo", "--bar", "--"]);
        expect(r.flags).toEqual({ bar: true });
        expect(r.rest).toEqual([]);
    });
    it("--no-X with =value is treated as a normal flag (not negation)", () => {
        const r = parseArgs(["foo", "--no-cache=baz"]);
        expect(r.flags).toEqual({ "no-cache": "baz" });
    });
    it("missing-value at end of argv leaves the flag as boolean true", () => {
        const r = parseArgs(["foo", "--to"]);
        expect(r.flags).toEqual({ to: true });
        expect(flagString(r, "to")).toBeUndefined();
    });
});
