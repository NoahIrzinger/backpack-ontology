import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertSafeRelay, emailFromToken } from "../../src/ops/auth.js";
describe("assertSafeRelay", () => {
    let prevInsecure: string | undefined;
    beforeEach(() => {
        prevInsecure = process.env.BACKPACK_INSECURE_RELAY;
        delete process.env.BACKPACK_INSECURE_RELAY;
    });
    afterEach(() => {
        if (prevInsecure !== undefined)
            process.env.BACKPACK_INSECURE_RELAY = prevInsecure;
        else
            delete process.env.BACKPACK_INSECURE_RELAY;
    });
    it("accepts https URLs", () => {
        expect(() => assertSafeRelay("https://app.backpackontology.com")).not.toThrow();
    });
    it("rejects http URLs to non-localhost without override", () => {
        expect(() => assertSafeRelay("http://evil.example.com")).toThrow(/non-HTTPS/);
    });
    it("allows http://localhost for local dev", () => {
        expect(() => assertSafeRelay("http://localhost:8080")).not.toThrow();
    });
    it("allows http://127.0.0.1 for local dev", () => {
        expect(() => assertSafeRelay("http://127.0.0.1:8080")).not.toThrow();
    });
    it("allows http with explicit insecure override", () => {
        process.env.BACKPACK_INSECURE_RELAY = "1";
        expect(() => assertSafeRelay("http://staging.internal")).not.toThrow();
    });
    it("throws on a malformed URL", () => {
        expect(() => assertSafeRelay("not a url")).toThrow(/invalid relay URL/);
    });
});
describe("emailFromToken", () => {
    it("returns undefined for malformed tokens", () => {
        expect(emailFromToken("not-a-jwt")).toBeUndefined();
    });
    it("returns undefined when payload is not an object (e.g. JSON number)", () => {
        const payload = Buffer.from("42").toString("base64url");
        const fakeToken = `header.${payload}.sig`;
        expect(emailFromToken(fakeToken)).toBeUndefined();
    });
    it("extracts email claim", () => {
        const payload = Buffer.from(JSON.stringify({ email: "a@b.com" })).toString("base64url");
        const fakeToken = `header.${payload}.sig`;
        expect(emailFromToken(fakeToken)).toBe("a@b.com");
    });
    it("falls back to preferred_username when email is missing", () => {
        const payload = Buffer.from(JSON.stringify({ preferred_username: "u@x" })).toString("base64url");
        const fakeToken = `header.${payload}.sig`;
        expect(emailFromToken(fakeToken)).toBe("u@x");
    });
    it("returns undefined when email is not a string (e.g. number)", () => {
        const payload = Buffer.from(JSON.stringify({ email: 12345 })).toString("base64url");
        const fakeToken = `header.${payload}.sig`;
        expect(emailFromToken(fakeToken)).toBeUndefined();
    });
});
