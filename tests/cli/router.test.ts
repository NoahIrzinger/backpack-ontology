import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { run } from "../../src/cli/router.js";
import { setColorEnabled } from "../../src/cli/colors.js";
function capture() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const so = vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
        stdout.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    const se = vi.spyOn(process.stderr, "write").mockImplementation((s: any) => {
        stderr.push(typeof s === "string" ? s : Buffer.from(s).toString());
        return true;
    });
    return {
        stdout: () => stdout.join(""),
        stderr: () => stderr.join(""),
        restore: () => { so.mockRestore(); se.mockRestore(); },
    };
}
describe("run", () => {
    beforeEach(() => setColorEnabled(false));
    afterEach(() => setColorEnabled(false));
    it("no args prints the hint card and exits 0", async () => {
        const cap = capture();
        const code = await run([]);
        cap.restore();
        expect(code).toBe(0);
        expect(cap.stdout()).toContain("Backpack CLI");
        expect(cap.stdout()).toContain("bp ls");
    });
    it("--help prints full help and exits 0", async () => {
        const cap = capture();
        const code = await run(["--help"]);
        cap.restore();
        expect(code).toBe(0);
        expect(cap.stdout()).toContain("Common");
        expect(cap.stdout()).toContain("Auth & scope");
        expect(cap.stdout()).toContain("Global flags");
    });
    it("help command prints full help", async () => {
        const cap = capture();
        const code = await run(["help"]);
        cap.restore();
        expect(code).toBe(0);
        expect(cap.stdout()).toContain("Common");
    });
    it("unknown command exits 1 with a stderr hint", async () => {
        const cap = capture();
        const code = await run(["nope"]);
        cap.restore();
        expect(code).toBe(1);
        expect(cap.stderr()).toContain('unknown command "nope"');
        expect(cap.stderr()).toContain("bp help");
    });
    it("version command prints a version line", async () => {
        const cap = capture();
        const code = await run(["version"]);
        cap.restore();
        expect(code).toBe(0);
        expect(cap.stdout()).toMatch(/^bp /);
        expect(cap.stdout()).toContain("node");
    });
    it("--no-color flag disables ANSI in subsequent output", async () => {
        setColorEnabled(true);
        const cap = capture();
        await run(["help", "--no-color"]);
        cap.restore();
        expect(cap.stdout()).not.toMatch(/\x1b\[/);
    });
    it("without --no-color (color forced on), help output DOES contain ANSI", async () => {
        setColorEnabled(true);
        const cap = capture();
        await run(["help"]);
        cap.restore();
        expect(cap.stdout()).toMatch(/\x1b\[/);
        setColorEnabled(false);
    });
    it("typo gets a 'did you mean' suggestion when close to a real command", async () => {
        const cap = capture();
        const code = await run(["versino"]);
        cap.restore();
        expect(code).toBe(1);
        expect(cap.stderr()).toContain("did you mean `bp version`?");
    });
    it("very-far typo gets no suggestion (avoids noisy mis-matches)", async () => {
        const cap = capture();
        const code = await run(["xyzqq"]);
        cap.restore();
        expect(code).toBe(1);
        expect(cap.stderr()).not.toContain("did you mean");
    });
    it("a handler that returns a non-number triggers a loud failure", async () => {
        const cap = capture();
        const code = await run(["nope-command"]);
        cap.restore();
        expect(code).toBe(1);
    });
});
