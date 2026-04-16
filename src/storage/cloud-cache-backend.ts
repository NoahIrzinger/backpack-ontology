import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type {
  StorageBackend,
  LearningGraphData,
  LearningGraphSummary,
} from "../core/types.js";

/**
 * Write-through cache backend for cloud backpack data.
 *
 * Reads come from local cache files (fast, offline-capable).
 * Writes go to the cloud relay API over the network, then update
 * the local cache on success.
 *
 * Cache layout:
 *   ~/.cache/backpack/cloud/
 *   ├── meta.json
 *   ├── graphs/<name>/data.json
 *   └── kb/<doc-id>.json
 */
export class CloudCacheBackend implements StorageBackend {
  private cachePath: string;
  private getAuth: () => Promise<{ token: string; relayUrl: string } | null>;

  constructor(
    cachePath: string,
    getAuth: () => Promise<{ token: string; relayUrl: string } | null>,
  ) {
    this.cachePath = cachePath;
    this.getAuth = getAuth;
  }

  /** Default cache directory following XDG_CACHE_HOME. */
  static defaultCachePath(): string {
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cacheHome, "backpack", "cloud");
  }

  private graphsDir(): string { return path.join(this.cachePath, "graphs"); }
  private graphDir(name: string): string { return path.join(this.graphsDir(), name); }
  private graphFile(name: string): string { return path.join(this.graphDir(name), "data.json"); }
  private kbDir(): string { return path.join(this.cachePath, "kb"); }
  private kbFile(id: string): string { return path.join(this.kbDir(), `${id}.json`); }
  private metaFile(): string { return path.join(this.cachePath, "meta.json"); }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private async writeAtomic(filePath: string, data: string): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    const tmp = filePath + ".tmp";
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, filePath);
  }

  private async authHeaders(): Promise<{ Authorization: string; "Content-Type": string; relayUrl: string }> {
    const auth = await this.getAuth();
    if (!auth) throw new Error("Sign in to access cloud backpack");
    return {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
      relayUrl: auth.relayUrl,
    };
  }

  // --- StorageBackend: reads (from cache) ---

  async initialize(): Promise<void> {
    await this.ensureDir(this.graphsDir());
    await this.ensureDir(this.kbDir());
  }

  async listOntologies(): Promise<LearningGraphSummary[]> {
    const summaries: LearningGraphSummary[] = [];
    try {
      const entries = await fs.readdir(this.graphsDir(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dataPath = path.join(this.graphsDir(), entry.name, "data.json");
        try {
          const raw = await fs.readFile(dataPath, "utf-8");
          const data = JSON.parse(raw) as LearningGraphData;
          const typeMap = new Map<string, number>();
          for (const n of data.nodes ?? []) {
            typeMap.set(n.type, (typeMap.get(n.type) ?? 0) + 1);
          }
          summaries.push({
            name: entry.name,
            description: data.metadata?.description || "",
            tags: data.metadata?.tags ?? [],
            nodeCount: data.nodes?.length ?? 0,
            edgeCount: data.edges?.length ?? 0,
            nodeTypes: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
          });
        } catch { /* skip corrupt/missing cache files */ }
      }
    } catch { /* empty cache */ }
    return summaries;
  }

  async loadOntology(name: string): Promise<LearningGraphData> {
    try {
      const raw = await fs.readFile(this.graphFile(name), "utf-8");
      return JSON.parse(raw) as LearningGraphData;
    } catch {
      // Cache miss — try fetching from relay
      const { Authorization, relayUrl } = await this.authHeaders();
      const res = await fetch(`${relayUrl}/api/graphs/${encodeURIComponent(name)}`, {
        headers: { Authorization },
      });
      if (!res.ok) throw new Error(`Graph "${name}" not found in cloud`);
      const data = await res.json() as LearningGraphData;
      await this.cacheGraph(name, data);
      return data;
    }
  }

  async ontologyExists(name: string): Promise<boolean> {
    try {
      await fs.access(this.graphFile(name));
      return true;
    } catch {
      return false;
    }
  }

  // --- StorageBackend: writes (to relay, then cache) ---

  async saveOntology(name: string, data: LearningGraphData, _expectedVersion?: number): Promise<void> {
    const { Authorization, relayUrl } = await this.authHeaders();
    const res = await fetch(`${relayUrl}/api/graphs/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { Authorization, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloud save failed (${res.status}): ${body}`);
    }
    await this.cacheGraph(name, data);
  }

  async createOntology(name: string, description: string): Promise<LearningGraphData> {
    const now = new Date().toISOString();
    const data: LearningGraphData = {
      metadata: { name, description, createdAt: now, updatedAt: now },
      nodes: [],
      edges: [],
    };
    const { Authorization, relayUrl } = await this.authHeaders();
    const res = await fetch(`${relayUrl}/api/graphs`, {
      method: "POST",
      headers: { Authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, data }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloud create failed (${res.status}): ${body}`);
    }
    await this.cacheGraph(name, data);
    return data;
  }

  async deleteOntology(name: string): Promise<void> {
    const { Authorization, relayUrl } = await this.authHeaders();
    const res = await fetch(`${relayUrl}/api/graphs/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { Authorization },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloud delete failed (${res.status}): ${body}`);
    }
    try { await fs.rm(this.graphDir(name), { recursive: true }); } catch { /* already gone */ }
  }

  async renameOntology(oldName: string, newName: string): Promise<void> {
    const { Authorization, relayUrl } = await this.authHeaders();
    const res = await fetch(`${relayUrl}/api/graphs/${encodeURIComponent(oldName)}/rename`, {
      method: "POST",
      headers: { Authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloud rename failed (${res.status}): ${body}`);
    }
    try {
      await this.ensureDir(this.graphDir(newName));
      await fs.rename(this.graphFile(oldName), this.graphFile(newName));
      await fs.rm(this.graphDir(oldName), { recursive: true });
    } catch { /* cache cleanup best-effort */ }
  }

  // --- Cache management ---

  async cacheGraph(name: string, data: LearningGraphData): Promise<void> {
    await this.writeAtomic(this.graphFile(name), JSON.stringify(data));
  }

  async cacheKBDoc(doc: { id: string; [key: string]: unknown }): Promise<void> {
    await this.writeAtomic(this.kbFile(doc.id), JSON.stringify(doc));
  }

  async listCachedKBDocs(): Promise<{ id: string; title: string; tags: string[]; sourceGraphs: string[]; collection: string; createdAt: string; updatedAt: string }[]> {
    const docs: { id: string; title: string; tags: string[]; sourceGraphs: string[]; collection: string; createdAt: string; updatedAt: string }[] = [];
    try {
      const entries = await fs.readdir(this.kbDir());
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(this.kbDir(), entry), "utf-8");
          const doc = JSON.parse(raw);
          docs.push({
            id: doc.id,
            title: doc.title || doc.id,
            tags: doc.tags || [],
            sourceGraphs: doc.sourceGraphs || [],
            collection: doc.collection || "cloud",
            createdAt: doc.createdAt || "",
            updatedAt: doc.updatedAt || "",
          });
        } catch { /* skip corrupt */ }
      }
    } catch { /* empty cache */ }
    return docs;
  }

  async readCachedKBDoc(id: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(this.kbFile(id), "utf-8");
    return JSON.parse(raw);
  }

  async refreshFromCloud(): Promise<{ graphs: number; kbDocs: number }> {
    const { Authorization, relayUrl } = await this.authHeaders();
    let graphCount = 0;
    let kbCount = 0;

    // Refresh graphs
    const graphsRes = await fetch(`${relayUrl}/api/graphs`, { headers: { Authorization } });
    if (graphsRes.ok) {
      const graphs = await graphsRes.json() as { name: string; encrypted?: boolean; source?: string }[];
      const cloudNames = new Set<string>();
      for (const g of graphs) {
        cloudNames.add(g.name);
        if (g.encrypted) continue; // skip encrypted (can't cache without key)
        if (g.source === "local") continue; // skip device-synced graphs (they belong to local backpacks)
        try {
          const dataRes = await fetch(`${relayUrl}/api/graphs/${encodeURIComponent(g.name)}`, { headers: { Authorization } });
          if (dataRes.ok) {
            const data = await dataRes.json() as LearningGraphData;
            await this.cacheGraph(g.name, data);
            graphCount++;
          }
        } catch { /* skip individual failures */ }
      }
      // Remove cached graphs that no longer exist on the cloud
      try {
        const cached = await fs.readdir(this.graphsDir(), { withFileTypes: true });
        for (const entry of cached) {
          if (entry.isDirectory() && !cloudNames.has(entry.name)) {
            await fs.rm(path.join(this.graphsDir(), entry.name), { recursive: true });
          }
        }
      } catch { /* no cache dir yet */ }
    }

    // Refresh KB docs
    const kbRes = await fetch(`${relayUrl}/api/kb/documents?limit=1000`, { headers: { Authorization } });
    if (kbRes.ok) {
      const { documents } = await kbRes.json() as { documents: { id: string }[] };
      const cloudDocIds = new Set<string>();
      for (const d of documents) {
        cloudDocIds.add(d.id);
        try {
          const docRes = await fetch(`${relayUrl}/api/kb/documents/${encodeURIComponent(d.id)}`, { headers: { Authorization } });
          if (docRes.ok) {
            const doc = await docRes.json();
            await this.cacheKBDoc(doc);
            kbCount++;
          }
        } catch { /* skip individual failures */ }
      }
      // Remove cached KB docs that no longer exist on the cloud
      try {
        const cached = await fs.readdir(this.kbDir());
        for (const f of cached) {
          const id = f.replace(/\.json$/, "");
          if (f.endsWith(".json") && !cloudDocIds.has(id)) {
            await fs.unlink(path.join(this.kbDir(), f));
          }
        }
      } catch { /* no cache dir yet */ }
    }

    // Update meta
    await this.writeAtomic(this.metaFile(), JSON.stringify({
      lastRefresh: new Date().toISOString(),
    }));

    return { graphs: graphCount, kbDocs: kbCount };
  }

  async clearCache(): Promise<void> {
    try { await fs.rm(this.cachePath, { recursive: true }); } catch { /* already clean */ }
    await this.initialize();
  }

  async getCacheMeta(): Promise<{ lastRefresh?: string } | null> {
    try {
      const raw = await fs.readFile(this.metaFile(), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
