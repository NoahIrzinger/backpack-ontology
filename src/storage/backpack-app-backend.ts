import type {
  StorageBackend,
  OntologyData,
  OntologySummary,
} from "../core/types.js";

/**
 * Storage backend that delegates to the Backpack App HTTP API.
 *
 * Expects:
 *   - baseUrl: e.g. "https://app.backpackontology.com"
 *   - token:   a Bearer JWT from the Backpack App token system
 */
export class BackpackAppBackend implements StorageBackend {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Backpack App API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
    }
    return res;
  }

  async initialize(): Promise<void> {
    // Verify connectivity by listing ontologies
    await this.request("/api/ontologies");
  }

  async listOntologies(): Promise<OntologySummary[]> {
    const res = await this.request("/api/ontologies");
    return (await res.json()) as OntologySummary[];
  }

  async loadOntology(name: string): Promise<OntologyData> {
    const res = await this.request(`/api/ontologies/${encodeURIComponent(name)}`);
    return (await res.json()) as OntologyData;
  }

  async saveOntology(name: string, data: OntologyData): Promise<void> {
    await this.request(`/api/ontologies/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async createOntology(name: string, description: string): Promise<OntologyData> {
    const now = new Date().toISOString();
    const data: OntologyData = {
      metadata: { name, description, createdAt: now, updatedAt: now },
      nodes: [],
      edges: [],
    };

    await this.request("/api/ontologies", {
      method: "POST",
      body: JSON.stringify({ name, description, data }),
    });

    return data;
  }

  async deleteOntology(name: string): Promise<void> {
    await this.request(`/api/ontologies/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async ontologyExists(name: string): Promise<boolean> {
    try {
      await this.request(`/api/ontologies/${encodeURIComponent(name)}`);
      return true;
    } catch {
      return false;
    }
  }
}
