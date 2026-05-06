import { describe, it, expect } from "vitest";
import { PACKAGE_NAME, PACKAGE_VERSION, MCP_SDK_VERSION } from "../src/core/version.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

describe("version module", () => {
  it("PACKAGE_NAME matches package.json name", () => {
    expect(PACKAGE_NAME).toBe(pkg.name);
    expect(PACKAGE_NAME).toBe("backpack-ontology");
  });

  it("PACKAGE_VERSION matches package.json version (no hardcoded fallback)", () => {
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(PACKAGE_VERSION).not.toBe("0.2.0");
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("MCP_SDK_VERSION resolves to a real semver", () => {
    expect(MCP_SDK_VERSION).not.toBe("unknown");
    expect(MCP_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
