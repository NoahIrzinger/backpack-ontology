// HTTP client for the Backpack Sync Protocol v0.1 relay endpoints.
// Used by SyncClient (OSS) and the cloud MCP sidecar (when configured for sync).

import type {
  SyncArtifact,
  SyncBackpack,
  SyncManifest,
} from "./types.js";
import {
  SyncVersionConflictError,
  SYNC_PROTOCOL_VERSION,
} from "./types.js";

export type TokenProvider = string | (() => Promise<string>);

export interface SyncRelayClientOptions {
  baseUrl: string;
  token: TokenProvider;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
}

export class SyncRelayClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SyncRelayClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.getToken =
      typeof opts.token === "string"
        ? () => Promise.resolve(opts.token as string)
        : opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Backpack-Sync-Protocol": SYNC_PROTOCOL_VERSION,
      ...(extra ?? {}),
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: await this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const url = `${this.baseUrl}${path}`;
    return this.fetchImpl(url, init);
  }

  /** POST /api/sync/register — idempotent. Returns the canonical record. */
  async register(input: {
    id?: string;
    name: string;
    color?: string;
    tags?: string[];
  }): Promise<SyncBackpack> {
    const res = await this.request("POST", "/api/sync/register", input);
    if (!res.ok || isHtmlResponse(res)) {
      throw await errorFromResponse(res, "register failed");
    }
    return (await safeJson<SyncBackpack>(res, "register"))!;
  }

  /** GET /api/sync/backpacks — list the user's sync backpacks. */
  async listBackpacks(): Promise<SyncBackpack[]> {
    const res = await this.request("GET", "/api/sync/backpacks");
    if (!res.ok || isHtmlResponse(res)) {
      throw await errorFromResponse(res, "listBackpacks failed");
    }
    const body = await safeJson<{ backpacks: SyncBackpack[] }>(res, "listBackpacks");
    return body?.backpacks ?? [];
  }

  /** GET /api/sync/backpacks/{id}/manifest. */
  async manifest(backpackId: string): Promise<SyncManifest> {
    const res = await this.request(
      "GET",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}/manifest`,
    );
    if (!res.ok || isHtmlResponse(res)) {
      throw await errorFromResponse(res, "manifest failed");
    }
    return (await safeJson<SyncManifest>(res, "manifest"))!;
  }

  /**
   * GET one artifact. Returns null if the artifact is missing on the
   * relay (404). Callers must treat null as "manifest is stale, skip
   * this entry"; throwing on every transient inconsistency would break
   * the whole sync. Other non-OK responses still throw.
   */
  async getArtifact(backpackId: string, artifactId: string): Promise<SyncArtifact | null> {
    const res = await this.request(
      "GET",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}/artifacts/${encodeURIComponent(artifactId)}`,
    );
    if (res.status === 404) {
      return null;
    }
    if (!res.ok || isHtmlResponse(res)) {
      throw await errorFromResponse(res, "getArtifact failed");
    }
    return (await safeJson<SyncArtifact>(res, "getArtifact"))!;
  }

  /**
   * PUT one artifact. expectedVersion is the version the client believes the
   * server holds. Pass 0 for new artifacts. Throws SyncVersionConflictError
   * on 409. Returns the new artifact (with assigned version).
   */
  async putArtifact(
    backpackId: string,
    artifactId: string,
    content: unknown,
    expectedVersion: number,
  ): Promise<SyncArtifact> {
    const res = await this.request(
      "PUT",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { expected_version: expectedVersion, content },
    );
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as {
        current?: SyncArtifact;
        error?: string;
      };
      const cur = body.current;
      throw new SyncVersionConflictError(
        artifactId,
        cur?.version ?? 0,
        cur?.content_hash ?? "",
      );
    }
    if (!res.ok || isHtmlResponse(res)) {
      throw await errorFromResponse(res, "putArtifact failed");
    }
    return (await safeJson<SyncArtifact>(res, "putArtifact"))!;
  }

  /** DELETE one artifact (tombstones it). */
  async deleteArtifact(backpackId: string, artifactId: string): Promise<void> {
    const res = await this.request(
      "DELETE",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}/artifacts/${encodeURIComponent(artifactId)}`,
    );
    if (res.status === 404) return; // already gone, idempotent
    if (!res.ok) {
      throw await errorFromResponse(res, "deleteArtifact failed");
    }
  }

  /** DELETE the entire sync backpack. */
  async deleteBackpack(backpackId: string): Promise<void> {
    const res = await this.request(
      "DELETE",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}`,
    );
    if (res.status === 404) return;
    if (!res.ok) {
      throw await errorFromResponse(res, "deleteBackpack failed");
    }
  }
}

async function errorFromResponse(res: Response, prefix: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  // Special-case the oauth2-proxy redirect-to-IDP HTML response: that means
  // the bearer token was rejected (typically expired). Surface a clear
  // message instead of the raw HTML.
  if (
    res.status === 302 ||
    res.headers.get("content-type")?.includes("text/html") ||
    /^\s*<(!doctype|html|\?xml)/i.test(text)
  ) {
    return new Error(
      `${prefix}: relay token rejected (likely expired). Re-sign-in via the Share extension and try again.`,
    );
  }
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed?.error) detail = parsed.error;
  } catch {
    // not JSON, keep raw text
  }
  return new Error(`${prefix}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
}

function isHtmlResponse(res: Response): boolean {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("text/html");
}

async function safeJson<T>(res: Response, op: string): Promise<T | null> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${op} returned non-JSON body (status ${res.status})`);
  }
}
