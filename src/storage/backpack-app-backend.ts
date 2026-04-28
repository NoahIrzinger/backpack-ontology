import type {
  StorageBackend,
  LearningGraphData,
  LearningGraphSummary,
} from "../core/types.js";

/**
 * Storage backend that delegates to the Backpack App HTTP API.
 *
 * Accepts either a static token string or a function that returns a token
 * (for OAuth flows with token refresh).
 */
export class BackpackAppBackend implements StorageBackend {
  private baseUrl: string;
  private getToken: () => Promise<string>;

  constructor(baseUrl: string, token: string | (() => Promise<string>)) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.getToken =
      typeof token === "string" ? () => Promise.resolve(token) : token;
  }

  private async headers(): Promise<Record<string, string>> {
    const accessToken = await this.getToken();
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const hdrs = await this.headers();
    const res = await fetch(url, {
      ...init,
      headers: { ...hdrs, ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Backpack App API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`
      );
    }
    return res;
  }

  async initialize(): Promise<void> {
    await this.request("/api/graphs");
  }

  async listOntologies(): Promise<LearningGraphSummary[]> {
    const res = await this.request("/api/graphs");
    return (await res.json()) as LearningGraphSummary[];
  }

  async loadOntology(name: string): Promise<LearningGraphData> {
    const res = await this.request(
      `/api/graphs/${encodeURIComponent(name)}`
    );
    return (await res.json()) as LearningGraphData;
  }

  async saveOntology(
    name: string,
    data: LearningGraphData,
    _expectedVersion?: number,
  ): Promise<void> {
    await this.request(`/api/graphs/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async createOntology(
    name: string,
    description: string
  ): Promise<LearningGraphData> {
    const now = new Date().toISOString();
    const data: LearningGraphData = {
      metadata: { name, description, createdAt: now, updatedAt: now },
      nodes: [],
      edges: [],
    };

    // Respect the session's active sync_backpack so iOS / web Claude
    // can switch containers and have new graphs land in the right one.
    // Falls back to the user's cloud-native default when unset.
    const target = this.activeSyncBackpackId;
    const url = target
      ? `/api/graphs?backpack_id=${encodeURIComponent(target)}`
      : "/api/graphs";
    await this.request(url, {
      method: "POST",
      body: JSON.stringify({ name, description, data }),
    });

    return data;
  }

  // --- Sync backpack management (cloud-only) ---

  /**
   * Active sync_backpack for this session. Cloud-mode tools set it via
   * backpack_switch so subsequent createOntology / KB writes go to the
   * right container. Null means "use the user's cloud-native default".
   */
  activeSyncBackpackId: string | null = null;

  async listSyncBackpacks(): Promise<Array<{ id: string; name: string; color: string; origin_kind: string; origin_device_id: string | null; origin_device_name?: string }>> {
    const res = await this.request("/api/sync/backpacks");
    const body = (await res.json()) as { backpacks?: unknown[] };
    return (body.backpacks ?? []) as Array<{ id: string; name: string; color: string; origin_kind: string; origin_device_id: string | null; origin_device_name?: string }>;
  }

  async registerSyncBackpack(name: string, color?: string, tags?: string[]): Promise<{ id: string; name: string }> {
    const res = await this.request("/api/sync/register", {
      method: "POST",
      body: JSON.stringify({ name, color, tags }),
    });
    return (await res.json()) as { id: string; name: string };
  }

  async deleteSyncBackpack(id: string): Promise<void> {
    await this.request(`/api/sync/backpacks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async renameSyncBackpack(id: string, fields: { name?: string; color?: string; tags?: string[] }): Promise<{ id: string; name: string }> {
    const res = await this.request(`/api/sync/backpacks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    return (await res.json()) as { id: string; name: string };
  }

  async getSyncBackpackManifest(id: string): Promise<unknown> {
    const res = await this.request(`/api/sync/backpacks/${encodeURIComponent(id)}/manifest`);
    return await res.json();
  }

  async moveGraphToBackpack(targetId: string, graphName: string): Promise<void> {
    await this.request(`/api/sync/backpacks/${encodeURIComponent(targetId)}/move-graph`, {
      method: "POST",
      body: JSON.stringify({ name: graphName }),
    });
  }

  async moveKBToBackpack(targetId: string, docId: string): Promise<void> {
    await this.request(`/api/sync/backpacks/${encodeURIComponent(targetId)}/move-kb`, {
      method: "POST",
      body: JSON.stringify({ id: docId }),
    });
  }

  async renameOntology(oldName: string, newName: string): Promise<void> {
    await this.request(
      `/api/graphs/${encodeURIComponent(oldName)}/rename`,
      {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      }
    );
  }

  async deleteOntology(name: string): Promise<void> {
    await this.request(`/api/graphs/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async ontologyExists(name: string): Promise<boolean> {
    try {
      await this.request(`/api/graphs/${encodeURIComponent(name)}`);
      return true;
    } catch {
      return false;
    }
  }
}
