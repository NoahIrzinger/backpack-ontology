import { describe, it, expect } from "vitest";
import { isBlockedIp, RemoteFetchError, remoteFetch } from "../src/core/remote-fetch.js";

describe("isBlockedIp", () => {
  // IPv4 — should be blocked
  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254", // AWS metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.1.1",
    "224.0.0.1", // multicast
    "239.255.255.255",
    "255.255.255.255",
  ])("blocks IPv4 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  // IPv4 — should be allowed
  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "151.101.0.1",
    "200.0.0.1",
  ])("allows public IPv4 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  // IPv6 — should be blocked
  it.each([
    "::1",
    "::",
    "fe80::1", // link-local
    "fc00::1", // unique local
    "fd12::1", // unique local
    "ff02::1", // multicast
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1", // IPv4-mapped private
    "2001:db8::1", // documentation
  ])("blocks IPv6 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  // IPv6 — should be allowed
  it.each([
    "2606:4700:4700::1111", // Cloudflare
    "2001:4860:4860::8888", // Google
  ])("allows public IPv6 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it("blocks malformed IPs", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
    expect(isBlockedIp("256.256.256.256")).toBe(true);
  });
});

describe("remoteFetch URL validation", () => {
  it("rejects http://", async () => {
    await expect(remoteFetch("http://example.com/")).rejects.toThrow(
      /only https:\/\/ URLs are allowed/,
    );
  });

  it("rejects file://", async () => {
    await expect(remoteFetch("file:///etc/passwd")).rejects.toThrow(
      /only https:\/\//,
    );
  });

  it("rejects ftp://", async () => {
    await expect(remoteFetch("ftp://example.com/")).rejects.toThrow(
      /only https:\/\//,
    );
  });

  it("rejects javascript:", async () => {
    await expect(remoteFetch("javascript:alert(1)")).rejects.toThrow(
      /only https:\/\//,
    );
  });

  it("rejects URLs with userinfo", async () => {
    await expect(remoteFetch("https://user:pass@example.com/")).rejects.toThrow(
      /userinfo/,
    );
  });

  it("rejects malformed URLs", async () => {
    await expect(remoteFetch("not a url")).rejects.toThrow(/invalid URL/);
  });

  it("rejects literal IP in private range", async () => {
    await expect(remoteFetch("https://127.0.0.1/")).rejects.toThrow(
      /blocked range/,
    );
  });

  it("rejects literal AWS metadata IP", async () => {
    await expect(remoteFetch("https://169.254.169.254/")).rejects.toThrow(
      /blocked range/,
    );
  });

  it("rejects literal IPv6 loopback", async () => {
    await expect(remoteFetch("https://[::1]/")).rejects.toThrow(/blocked range/);
  });

  it("throws RemoteFetchError with code", async () => {
    try {
      await remoteFetch("http://example.com/");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteFetchError);
      expect((err as RemoteFetchError).code).toBe("INVALID_SCHEME");
    }
  });
});

describe("remoteFetch hostname resolution", () => {
  it("rejects a hostname that resolves to localhost", async () => {
    // localhost resolves to 127.0.0.1 / ::1, both blocked
    await expect(remoteFetch("https://localhost/")).rejects.toThrow(
      /blocked IP/,
    );
  });

  it("throws on unresolvable hostname", async () => {
    await expect(
      remoteFetch("https://nonexistent-host-for-testing-12345.invalid/"),
    ).rejects.toThrow();
  });
});
