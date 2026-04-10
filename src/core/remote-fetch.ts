// ============================================================
// Hardened HTTPS fetch for remote learning graphs.
//
// Threats this module defends against:
//   1. SSRF — a malicious URL points at the user's private network
//      (router admin, cloud metadata, internal services)
//   2. DNS rebinding — a hostname resolves once for validation,
//      then to a different IP for the actual request
//   3. Resource exhaustion — slow loris, infinite stream, oversized body
//   4. Redirect loops to private addresses
//
// The contract:
//   - HTTPS only
//   - DNS resolved once; the IP is checked against a private-range
//     blocklist; the request is dispatched against the IP directly
//     so DNS rebinding cannot redirect to a different host
//   - Hard size cap (default 10 MB)
//   - Hard total timeout (15s) and connect timeout (5s)
//   - Max 3 redirects, each re-validated
//   - Returns the body bytes plus an ETag if present
// ============================================================

import * as https from "node:https";
import * as dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import * as net from "node:net";
import { URL } from "node:url";

// --- Defaults ---

export const REMOTE_FETCH_DEFAULTS = {
  maxBytes: 10 * 1024 * 1024, // 10 MB
  totalTimeoutMs: 15_000,
  connectTimeoutMs: 5_000,
  maxRedirects: 3,
} as const;

// --- Errors ---

export class RemoteFetchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "RemoteFetchError";
  }
}

// --- Public API ---

export interface RemoteFetchOptions {
  /** Max response body size in bytes. Default: 10 MB. */
  maxBytes?: number;
  /** Total timeout in milliseconds. Default: 15s. */
  totalTimeoutMs?: number;
  /** Connect timeout in milliseconds. Default: 5s. */
  connectTimeoutMs?: number;
  /** Max redirects to follow. Default: 3. */
  maxRedirects?: number;
  /** Optional If-None-Match header value (for conditional GET). */
  ifNoneMatch?: string;
}

export interface RemoteFetchResult {
  /** Response body as a UTF-8 string. */
  body: string;
  /** Number of bytes received. */
  bytes: number;
  /** ETag header value, if any. */
  etag: string | null;
  /** Final URL after redirects. */
  finalUrl: string;
  /** HTTP status code. */
  status: number;
  /** True if the server returned 304 Not Modified. */
  notModified: boolean;
}

/**
 * Fetch a remote URL with full SSRF / size / timeout protections.
 *
 * Throws RemoteFetchError on any policy violation, network error,
 * or oversized response.
 */
export async function remoteFetch(
  rawUrl: string,
  options: RemoteFetchOptions = {},
): Promise<RemoteFetchResult> {
  const opts = {
    maxBytes: options.maxBytes ?? REMOTE_FETCH_DEFAULTS.maxBytes,
    totalTimeoutMs: options.totalTimeoutMs ?? REMOTE_FETCH_DEFAULTS.totalTimeoutMs,
    connectTimeoutMs:
      options.connectTimeoutMs ?? REMOTE_FETCH_DEFAULTS.connectTimeoutMs,
    maxRedirects: options.maxRedirects ?? REMOTE_FETCH_DEFAULTS.maxRedirects,
    ifNoneMatch: options.ifNoneMatch,
  };

  let currentUrl = rawUrl;
  let redirectCount = 0;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > opts.totalTimeoutMs) {
      throw new RemoteFetchError(
        "total fetch timeout exceeded",
        "TIMEOUT",
        currentUrl,
      );
    }

    const parsed = parseAndValidateUrl(currentUrl);
    const resolvedIp = await resolveAndCheckHost(parsed.hostname);
    const remaining = opts.totalTimeoutMs - (Date.now() - startedAt);

    const response = await singleRequest(parsed, resolvedIp, {
      maxBytes: opts.maxBytes,
      totalTimeoutMs: remaining,
      connectTimeoutMs: opts.connectTimeoutMs,
      ifNoneMatch: opts.ifNoneMatch,
    });

    // 304 Not Modified — no body, return immediately
    if (response.status === 304) {
      return {
        body: "",
        bytes: 0,
        etag: response.etag,
        finalUrl: currentUrl,
        status: 304,
        notModified: true,
      };
    }

    // Redirect handling
    if (response.status >= 300 && response.status < 400 && response.location) {
      if (redirectCount >= opts.maxRedirects) {
        throw new RemoteFetchError(
          `too many redirects (max ${opts.maxRedirects})`,
          "TOO_MANY_REDIRECTS",
          currentUrl,
        );
      }
      // Resolve relative redirects against the current URL
      const nextUrl = new URL(response.location, currentUrl).toString();
      redirectCount++;
      currentUrl = nextUrl;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new RemoteFetchError(
        `HTTP ${response.status}`,
        "HTTP_ERROR",
        currentUrl,
      );
    }

    return {
      body: response.body,
      bytes: response.bytes,
      etag: response.etag,
      finalUrl: currentUrl,
      status: response.status,
      notModified: false,
    };
  }
}

// --- Internals ---

interface ParsedUrl {
  href: string;
  hostname: string;
  port: number;
  pathname: string;
  search: string;
}

function parseAndValidateUrl(rawUrl: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteFetchError(`invalid URL: ${rawUrl}`, "INVALID_URL", rawUrl);
  }
  if (url.protocol !== "https:") {
    throw new RemoteFetchError(
      `only https:// URLs are allowed (got ${url.protocol})`,
      "INVALID_SCHEME",
      rawUrl,
    );
  }
  if (!url.hostname) {
    throw new RemoteFetchError("URL has no hostname", "INVALID_URL", rawUrl);
  }
  // Reject userinfo (https://user:pass@host) which can confuse parsers
  if (url.username || url.password) {
    throw new RemoteFetchError(
      "URLs with userinfo are not allowed",
      "INVALID_URL",
      rawUrl,
    );
  }
  // Node's URL parser keeps IPv6 brackets in `hostname` (e.g. "[::1]").
  // Strip them so net.isIP() and DNS resolution work correctly.
  let hostname = url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  return {
    href: url.href,
    hostname,
    port: url.port ? parseInt(url.port, 10) : 443,
    pathname: url.pathname || "/",
    search: url.search || "",
  };
}

/**
 * Resolves a hostname to an IP and rejects if the IP is in a private,
 * loopback, link-local, multicast, or otherwise reserved range.
 *
 * Returns the resolved IP. Callers should dispatch the request against
 * the IP directly to prevent DNS rebinding.
 */
async function resolveAndCheckHost(hostname: string): Promise<string> {
  // If the hostname is already a literal IP, check it directly
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new RemoteFetchError(
        `IP address ${hostname} is in a blocked range`,
        "BLOCKED_IP",
      );
    }
    return hostname;
  }

  let addrs: LookupAddress[];
  try {
    addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new RemoteFetchError(
      `DNS lookup failed: ${(err as Error).message}`,
      "DNS_ERROR",
    );
  }
  if (addrs.length === 0) {
    throw new RemoteFetchError("DNS lookup returned no addresses", "DNS_ERROR");
  }
  // Check ALL returned addresses — if any is private, refuse the whole hostname
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new RemoteFetchError(
        `hostname ${hostname} resolves to blocked IP ${a.address}`,
        "BLOCKED_IP",
      );
    }
  }
  return addrs[0].address;
}

/**
 * Returns true if the IP is in a private, loopback, link-local,
 * multicast, broadcast, or reserved range. Both IPv4 and IPv6.
 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isBlockedIpv6(ip);
  }
  return true; // unknown family — block by default
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 100.64.0.0/10 — CGNAT shared address space
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (includes AWS/GCP metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, 192.0.2.0/24 — IETF protocol assignments / TEST-NET-1
  if (a === 192 && b === 0) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 — TEST-NET-2
  if (a === 198 && b === 51) return true;
  // 203.0.113.0/24 — TEST-NET-3
  if (a === 203 && b === 0) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved + 255.255.255.255 broadcast
  if (a >= 240) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 — loopback
  if (lower === "::1") return true;
  // :: — unspecified
  if (lower === "::") return true;
  // ::ffff:x.x.x.x — IPv4-mapped, recheck the IPv4
  const v4MappedMatch = lower.match(/^::ffff:([\d.]+)$/);
  if (v4MappedMatch) {
    return isBlockedIpv4(v4MappedMatch[1]);
  }
  // fc00::/7 — unique local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 — link-local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ff00::/8 — multicast
  if (lower.startsWith("ff")) return true;
  // 2001:db8::/32 — documentation
  if (lower.startsWith("2001:db8:")) return true;
  return false;
}

interface SingleResponse {
  status: number;
  body: string;
  bytes: number;
  etag: string | null;
  location: string | null;
}

interface SingleRequestOptions {
  maxBytes: number;
  totalTimeoutMs: number;
  connectTimeoutMs: number;
  ifNoneMatch?: string;
}

function singleRequest(
  parsed: ParsedUrl,
  resolvedIp: string,
  opts: SingleRequestOptions,
): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: parsed.hostname, // SNI / virtual host header still uses the name
      "User-Agent": "backpack-remote-fetch/1.0",
      Accept: "application/json",
    };
    if (opts.ifNoneMatch) {
      headers["If-None-Match"] = opts.ifNoneMatch;
    }

    const req = https.request(
      {
        host: resolvedIp,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
        servername: parsed.hostname, // SNI
        // Strict TLS — no insecure fallback
        rejectUnauthorized: true,
        timeout: opts.connectTimeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0;
        const etag = (res.headers.etag as string | undefined) || null;
        const location = (res.headers.location as string | undefined) || null;

        // 304 / 3xx — no body needed (or shouldn't read it)
        if (status === 304 || (status >= 300 && status < 400)) {
          res.resume(); // drain
          resolve({ status, body: "", bytes: 0, etag, location });
          return;
        }

        // Check declared content-length up front
        const declared = parseInt(
          (res.headers["content-length"] as string | undefined) || "0",
          10,
        );
        if (declared > opts.maxBytes) {
          req.destroy();
          reject(
            new RemoteFetchError(
              `Content-Length ${declared} exceeds max ${opts.maxBytes}`,
              "TOO_LARGE",
              parsed.href,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > opts.maxBytes) {
            req.destroy();
            reject(
              new RemoteFetchError(
                `response exceeds max ${opts.maxBytes} bytes`,
                "TOO_LARGE",
                parsed.href,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status, body, bytes: totalBytes, etag, location });
        });
        res.on("error", (err) => {
          reject(
            new RemoteFetchError(
              `response error: ${err.message}`,
              "NETWORK_ERROR",
              parsed.href,
            ),
          );
        });
      },
    );

    // Total timeout (separate from connect timeout)
    const totalTimer = setTimeout(() => {
      req.destroy();
      reject(
        new RemoteFetchError(
          "request timeout exceeded",
          "TIMEOUT",
          parsed.href,
        ),
      );
    }, opts.totalTimeoutMs);

    req.on("timeout", () => {
      req.destroy();
      reject(
        new RemoteFetchError(
          "connect timeout exceeded",
          "CONNECT_TIMEOUT",
          parsed.href,
        ),
      );
    });

    req.on("error", (err) => {
      clearTimeout(totalTimer);
      // Already rejected above? Promise is idempotent, second reject is no-op
      reject(
        new RemoteFetchError(
          `network error: ${err.message}`,
          "NETWORK_ERROR",
          parsed.href,
        ),
      );
    });

    req.on("close", () => {
      clearTimeout(totalTimer);
    });

    req.end();
  });
}
