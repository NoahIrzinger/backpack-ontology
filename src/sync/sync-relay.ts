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
    if (!res.ok) {
      throw await errorFromResponse(res, "register failed");
    }
    return (await res.json()) as SyncBackpack;
  }

  /** GET /api/sync/backpacks — list the user's sync backpacks. */
  async listBackpacks(): Promise<SyncBackpack[]> {
    const res = await this.request("GET", "/api/sync/backpacks");
    if (!res.ok) {
      throw await errorFromResponse(res, "listBackpacks failed");
    }
    const body = (await res.json()) as { backpacks: SyncBackpack[] };
    return body.backpacks ?? [];
  }

  /** GET /api/sync/backpacks/{id}/manifest. */
  async manifest(backpackId: string): Promise<SyncManifest> {
    const res = await this.request(
      "GET",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}/manifest`,
    );
    if (!res.ok) {
      throw await errorFromResponse(res, "manifest failed");
    }
    return (await res.json()) as SyncManifest;
  }

  /** GET one artifact. */
  async getArtifact(backpackId: string, artifactId: string): Promise<SyncArtifact> {
    const res = await this.request(
      "GET",
      `/api/sync/backpacks/${encodeURIComponent(backpackId)}/artifacts/${encodeURIComponent(artifactId)}`,
    );
    if (!res.ok) {
      throw await errorFromResponse(res, "getArtifact failed");
    }
    return (await res.json()) as SyncArtifact;
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
    if (!res.ok) {
      throw await errorFromResponse(res, "putArtifact failed");
    }
    return (await res.json()) as SyncArtifact;
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
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed?.error) detail = parsed.error;
  } catch {
    // not JSON, keep raw text
  }
  return new Error(`${prefix}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
}
