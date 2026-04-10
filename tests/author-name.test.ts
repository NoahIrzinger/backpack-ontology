import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateAuthorName, resolveAuthorName } from "../src/core/author-name.js";

const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  envBackup.BACKPACK_AUTHOR = process.env.BACKPACK_AUTHOR;
  delete process.env.BACKPACK_AUTHOR;
});

afterEach(() => {
  if (envBackup.BACKPACK_AUTHOR === undefined) {
    delete process.env.BACKPACK_AUTHOR;
  } else {
    process.env.BACKPACK_AUTHOR = envBackup.BACKPACK_AUTHOR;
  }
});

describe("generateAuthorName", () => {
  it("returns a kebab-case two-word name", () => {
    const name = generateAuthorName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("is deterministic — same machine always yields the same name", () => {
    const a = generateAuthorName();
    const b = generateAuthorName();
    expect(a).toBe(b);
  });

  it("never returns 'unknown' or an empty string", () => {
    const name = generateAuthorName();
    expect(name).not.toBe("unknown");
    expect(name).not.toBe("");
    expect(name.length).toBeGreaterThan(3);
  });
});

describe("resolveAuthorName", () => {
  it("honors explicit option first", () => {
    process.env.BACKPACK_AUTHOR = "env-value";
    expect(resolveAuthorName("explicit-name")).toBe("explicit-name");
  });

  it("falls back to BACKPACK_AUTHOR env var when no explicit option", () => {
    process.env.BACKPACK_AUTHOR = "noah";
    expect(resolveAuthorName()).toBe("noah");
  });

  it("falls back to generated docker-style name when env var is unset", () => {
    delete process.env.BACKPACK_AUTHOR;
    const name = resolveAuthorName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(name).toBe(generateAuthorName());
  });

  it("treats empty string option as absent", () => {
    process.env.BACKPACK_AUTHOR = "noah";
    // Empty explicit should not shadow the env var
    expect(resolveAuthorName("")).toBe("noah");
  });

  it("treats empty env var as absent", () => {
    process.env.BACKPACK_AUTHOR = "";
    // Falls through to generated
    const name = resolveAuthorName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("never returns 'unknown'", () => {
    delete process.env.BACKPACK_AUTHOR;
    expect(resolveAuthorName()).not.toBe("unknown");
  });
});
