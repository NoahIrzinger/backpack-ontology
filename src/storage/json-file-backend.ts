import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dataDir } from "../core/paths.js";
import type {
  StorageBackend,
  LearningGraphData,
  LearningGraphSummary,
} from "../core/types.js";

function firstStringValue(properties: Record<string, unknown>): string | null {
  for (const value of Object.values(properties)) {
    if (typeof value === "string") return value;
  }
  return null;
}

interface GraphMeta {
  activeBranch: string;
  snapshotLimit: number;
}

interface SnapshotEnvelope {
  version: number;
  timestamp: string;
  label?: string;
  branch: string;
  data: LearningGraphData;
}

const DEFAULT_META: GraphMeta = { activeBranch: "main", snapshotLimit: 20 };

export class JsonFileBackend implements StorageBackend {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? dataDir();
  }

  // --- Path helpers ---

  private graphsDir(): string {
    return path.join(this.baseDir, "graphs");
  }

  private graphDir(name: string): string {
    return path.join(this.graphsDir(), name);
  }

  private metaFile(name: string): string {
    return path.join(this.graphDir(name), "meta.json");
  }

  private branchesDir(name: string): string {
    return path.join(this.graphDir(name), "branches");
  }

  private branchFile(name: string, branch: string): string {
    return path.join(this.branchesDir(name), `${branch}.json`);
  }

  private snapshotsDir(name: string, branch: string): string {
    return path.join(this.graphDir(name), "snapshots", branch);
  }

  private snapshotFile(name: string, branch: string, version: number): string {
    const padded = String(version).padStart(3, "0");
    return path.join(this.snapshotsDir(name, branch), `${padded}.json`);
  }

  private termsFile(name: string): string {
    return path.join(this.graphDir(name), "terms.json");
  }

  private snippetsDir(name: string): string {
    return path.join(this.graphDir(name), "snippets");
  }

  private snippetFile(name: string, snippetId: string): string {
    return path.join(this.snippetsDir(name), `${snippetId}.json`);
  }

  // --- Meta helpers ---

  async loadMeta(name: string): Promise<GraphMeta> {
    try {
      const raw = await fs.readFile(this.metaFile(name), "utf-8");
      return JSON.parse(raw) as GraphMeta;
    } catch {
      return { ...DEFAULT_META };
    }
  }

  async saveMeta(name: string, meta: GraphMeta): Promise<void> {
    const filePath = this.metaFile(name);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(meta, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  // --- Migration ---

  private async migrate(): Promise<void> {
    const oldDir = path.join(this.baseDir, "ontologies");
    const newDir = this.graphsDir();

    let oldExists = false;
    try {
      await fs.access(oldDir);
      oldExists = true;
    } catch {}

    let newExists = false;
    try {
      await fs.access(newDir);
      newExists = true;
    } catch {}

    if (!oldExists || newExists) return;

    console.error("[backpack] migrating ontologies/ → graphs/");

    let entries: string[];
    try {
      entries = await fs.readdir(oldDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const oldOntologyFile = path.join(oldDir, entry, "ontology.json");
      try {
        await fs.access(oldOntologyFile);
      } catch {
        continue;
      }

      const graphDir = path.join(newDir, entry);
      const branchesDir = path.join(graphDir, "branches");
      await fs.mkdir(branchesDir, { recursive: true });

      // Copy ontology.json → branches/main.json
      const raw = await fs.readFile(oldOntologyFile, "utf-8");
      const branchFile = path.join(branchesDir, "main.json");
      const tmpBranch = branchFile + ".tmp";
      await fs.writeFile(tmpBranch, raw, "utf-8");
      await fs.rename(tmpBranch, branchFile);

      // Create meta.json
      const metaFile = path.join(graphDir, "meta.json");
      const tmpMeta = metaFile + ".tmp";
      await fs.writeFile(tmpMeta, JSON.stringify(DEFAULT_META, null, 2), "utf-8");
      await fs.rename(tmpMeta, metaFile);

      // Copy terms.json if exists
      const oldTermsFile = path.join(oldDir, entry, "terms.json");
      try {
        const termsRaw = await fs.readFile(oldTermsFile, "utf-8");
        const newTermsFile = path.join(graphDir, "terms.json");
        const tmpTerms = newTermsFile + ".tmp";
        await fs.writeFile(tmpTerms, termsRaw, "utf-8");
        await fs.rename(tmpTerms, newTermsFile);
      } catch {}

      console.error(`[backpack]   migrated: ${entry}`);
    }

    await fs.rm(oldDir, { recursive: true });
    console.error("[backpack] migration complete");
  }

  // --- StorageBackend methods ---

  async initialize(): Promise<void> {
    await this.migrate();
    await fs.mkdir(this.graphsDir(), { recursive: true });
  }

  async listOntologies(): Promise<LearningGraphSummary[]> {
    const dir = this.graphsDir();
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const summaries: LearningGraphSummary[] = [];

    for (const entry of entries) {
      try {
        const meta = await this.loadMeta(entry);
        const filePath = this.branchFile(entry, meta.activeBranch);
        const raw = await fs.readFile(filePath, "utf-8");
        const data: LearningGraphData = JSON.parse(raw);

        const typeCounts = new Map<string, number>();
        for (const node of data.nodes) {
          typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
        }

        summaries.push({
          name: data.metadata.name,
          description: data.metadata.description,
          nodeCount: data.nodes.length,
          edgeCount: data.edges.length,
          nodeTypes: Array.from(typeCounts.entries()).map(([type, count]) => ({
            type,
            count,
          })),
        });
      } catch {
        // Skip directories that don't have valid data
      }
    }

    return summaries;
  }

  async loadOntology(name: string): Promise<LearningGraphData> {
    const meta = await this.loadMeta(name);
    const filePath = this.branchFile(name, meta.activeBranch);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as LearningGraphData;
    } catch {
      throw new Error(`Ontology not found: ${name}`);
    }
  }

  async saveOntology(name: string, data: LearningGraphData): Promise<void> {
    const meta = await this.loadMeta(name);
    const filePath = this.branchFile(name, meta.activeBranch);
    const tmpPath = filePath + ".tmp";

    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, filePath);

    this.writeTerms(name, data).catch(() => {});
  }

  private async writeTerms(name: string, data: LearningGraphData): Promise<void> {
    if (data.nodes.length === 0) return;

    const typeCounts = new Map<string, number>();
    const edgeTypeCounts = new Map<string, number>();
    const entities: { name: string; type: string }[] = [];
    const seenNames = new Set<string>();

    for (const node of data.nodes) {
      typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
      const label = firstStringValue(node.properties);
      if (label && !seenNames.has(label)) {
        seenNames.add(label);
        entities.push({ name: label, type: node.type });
      }
    }

    for (const edge of data.edges) {
      edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) ?? 0) + 1);
    }

    const terms = {
      types: [...typeCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
      edgeTypes: [...edgeTypeCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
      entities: entities
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
        .slice(0, 200),
    };

    const filePath = this.termsFile(name);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(terms, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  async loadTerms(name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.termsFile(name), "utf-8");
    } catch {
      return null;
    }
  }

  async createOntology(
    name: string,
    description: string
  ): Promise<LearningGraphData> {
    if (await this.ontologyExists(name)) {
      throw new Error(`Ontology already exists: ${name}`);
    }

    const now = new Date().toISOString();
    const data: LearningGraphData = {
      metadata: {
        name,
        description,
        createdAt: now,
        updatedAt: now,
      },
      nodes: [],
      edges: [],
    };

    await fs.mkdir(this.branchesDir(name), { recursive: true });
    await this.saveMeta(name, { ...DEFAULT_META });
    await this.saveOntology(name, data);
    return data;
  }

  async renameOntology(oldName: string, newName: string): Promise<void> {
    if (!(await this.ontologyExists(oldName))) {
      throw new Error(`Ontology not found: ${oldName}`);
    }
    if (await this.ontologyExists(newName)) {
      throw new Error(`Ontology already exists: ${newName}`);
    }

    // Rename the directory
    await fs.rename(this.graphDir(oldName), this.graphDir(newName));

    // Update metadata in the active branch
    const data = await this.loadOntology(newName);
    data.metadata.name = newName;
    data.metadata.updatedAt = new Date().toISOString();
    await this.saveOntology(newName, data);
  }

  async deleteOntology(name: string): Promise<void> {
    if (!(await this.ontologyExists(name))) {
      throw new Error(`Ontology not found: ${name}`);
    }
    await fs.rm(this.graphDir(name), { recursive: true });
  }

  async ontologyExists(name: string): Promise<boolean> {
    try {
      const meta = await this.loadMeta(name);
      await fs.access(this.branchFile(name, meta.activeBranch));
      return true;
    } catch {
      return false;
    }
  }

  // --- Branch methods ---

  async listBranches(name: string): Promise<{ name: string; nodeCount: number; edgeCount: number; active: boolean }[]> {
    const meta = await this.loadMeta(name);
    const dir = this.branchesDir(name);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const branches: { name: string; nodeCount: number; edgeCount: number; active: boolean }[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const branchName = entry.replace(/\.json$/, "");
      try {
        const raw = await fs.readFile(path.join(dir, entry), "utf-8");
        const data: LearningGraphData = JSON.parse(raw);
        branches.push({
          name: branchName,
          nodeCount: data.nodes.length,
          edgeCount: data.edges.length,
          active: branchName === meta.activeBranch,
        });
      } catch {}
    }

    return branches;
  }

  async createBranch(name: string, branchName: string, fromBranch?: string): Promise<void> {
    const branchFile = this.branchFile(name, branchName);
    try {
      await fs.access(branchFile);
      throw new Error(`Branch already exists: ${branchName}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Branch already exists")) throw err;
    }

    const meta = await this.loadMeta(name);
    const sourceBranch = fromBranch ?? meta.activeBranch;
    const sourceFile = this.branchFile(name, sourceBranch);

    const raw = await fs.readFile(sourceFile, "utf-8");
    await fs.mkdir(this.branchesDir(name), { recursive: true });
    const tmpPath = branchFile + ".tmp";
    await fs.writeFile(tmpPath, raw, "utf-8");
    await fs.rename(tmpPath, branchFile);
  }

  async switchBranch(name: string, branchName: string): Promise<void> {
    const branchFile = this.branchFile(name, branchName);
    try {
      await fs.access(branchFile);
    } catch {
      throw new Error(`Branch not found: ${branchName}`);
    }

    const meta = await this.loadMeta(name);
    meta.activeBranch = branchName;
    await this.saveMeta(name, meta);
  }

  async deleteBranch(name: string, branchName: string): Promise<void> {
    const meta = await this.loadMeta(name);
    if (meta.activeBranch === branchName) {
      throw new Error(`Cannot delete the active branch: ${branchName}`);
    }

    const branchFile = this.branchFile(name, branchName);
    try {
      await fs.access(branchFile);
    } catch {
      throw new Error(`Branch not found: ${branchName}`);
    }

    await fs.rm(branchFile);
  }

  async loadBranch(name: string, branchName: string): Promise<LearningGraphData> {
    const filePath = this.branchFile(name, branchName);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as LearningGraphData;
    } catch {
      throw new Error(`Branch not found: ${branchName}`);
    }
  }

  // --- Snapshot methods ---

  async createSnapshot(name: string, label?: string): Promise<number> {
    const meta = await this.loadMeta(name);
    const branch = meta.activeBranch;
    const snapDir = this.snapshotsDir(name, branch);
    await fs.mkdir(snapDir, { recursive: true });

    // Determine next version number
    const existing = await this.listSnapshotFiles(name, branch);
    const nextVersion = existing.length > 0
      ? existing[existing.length - 1].version + 1
      : 1;

    // Read current branch data
    const raw = await fs.readFile(this.branchFile(name, branch), "utf-8");
    const data: LearningGraphData = JSON.parse(raw);

    const envelope: SnapshotEnvelope = {
      version: nextVersion,
      timestamp: new Date().toISOString(),
      branch,
      data,
    };
    if (label) envelope.label = label;

    const filePath = this.snapshotFile(name, branch, nextVersion);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(envelope, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);

    // Prune old snapshots
    await this.pruneSnapshots(name, branch, meta.snapshotLimit);

    return nextVersion;
  }

  async listSnapshots(name: string): Promise<{ version: number; timestamp: string; nodeCount: number; edgeCount: number; label?: string }[]> {
    const meta = await this.loadMeta(name);
    const branch = meta.activeBranch;
    const snapDir = this.snapshotsDir(name, branch);

    let entries: string[];
    try {
      entries = await fs.readdir(snapDir);
    } catch {
      return [];
    }

    const snapshots: { version: number; timestamp: string; nodeCount: number; edgeCount: number; label?: string }[] = [];

    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(snapDir, entry), "utf-8");
        const envelope: SnapshotEnvelope = JSON.parse(raw);
        const item: { version: number; timestamp: string; nodeCount: number; edgeCount: number; label?: string } = {
          version: envelope.version,
          timestamp: envelope.timestamp,
          nodeCount: envelope.data.nodes.length,
          edgeCount: envelope.data.edges.length,
        };
        if (envelope.label) item.label = envelope.label;
        snapshots.push(item);
      } catch {}
    }

    return snapshots.sort((a, b) => b.version - a.version);
  }

  async loadSnapshot(name: string, version: number): Promise<LearningGraphData> {
    const meta = await this.loadMeta(name);
    const filePath = this.snapshotFile(name, meta.activeBranch, version);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const envelope: SnapshotEnvelope = JSON.parse(raw);
      return envelope.data;
    } catch {
      throw new Error(`Snapshot not found: version ${version}`);
    }
  }

  async rollback(name: string, version: number): Promise<void> {
    const data = await this.loadSnapshot(name, version);
    await this.saveOntology(name, data);
  }

  async getSnapshotLimit(name: string): Promise<number> {
    const meta = await this.loadMeta(name);
    return meta.snapshotLimit;
  }

  // --- Snapshot internals ---

  private async listSnapshotFiles(name: string, branch: string): Promise<{ version: number; filename: string }[]> {
    const dir = this.snapshotsDir(name, branch);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => ({ version: parseInt(e.replace(/\.json$/, ""), 10), filename: e }))
      .filter((e) => !isNaN(e.version))
      .sort((a, b) => a.version - b.version);
  }

  private async pruneSnapshots(name: string, branch: string, limit: number): Promise<void> {
    const existing = await this.listSnapshotFiles(name, branch);
    if (existing.length <= limit) return;

    const toDelete = existing.slice(0, existing.length - limit);
    for (const snap of toDelete) {
      const filePath = path.join(this.snapshotsDir(name, branch), snap.filename);
      await fs.rm(filePath).catch(() => {});
    }
  }

  // --- Snippet methods ---

  async saveSnippet(graphName: string, snippet: {
    label: string;
    description?: string;
    nodeIds: string[];
    edgeIds: string[];
  }): Promise<string> {
    const id = snippet.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 50) || "snippet";

    const data = await this.loadOntology(graphName);
    const meta = await this.loadMeta(graphName);

    const nodeSet = new Set(snippet.nodeIds);

    let resolvedEdgeIds = snippet.edgeIds;
    if (!resolvedEdgeIds || resolvedEdgeIds.length === 0) {
      resolvedEdgeIds = data.edges
        .filter(e => nodeSet.has(e.sourceId) && nodeSet.has(e.targetId))
        .map(e => e.id);
    }
    const edgeSet = new Set(resolvedEdgeIds);

    const snippetData = {
      id,
      label: snippet.label,
      description: snippet.description ?? "",
      parentGraph: graphName,
      parentBranch: meta.activeBranch,
      nodeIds: snippet.nodeIds,
      edgeIds: resolvedEdgeIds,
      nodes: data.nodes.filter(n => nodeSet.has(n.id)),
      edges: data.edges.filter(e => edgeSet.has(e.id)),
      nodeCount: snippet.nodeIds.length,
      edgeCount: resolvedEdgeIds.length,
      createdAt: new Date().toISOString(),
    };

    const dir = this.snippetsDir(graphName);
    await fs.mkdir(dir, { recursive: true });

    const filePath = this.snippetFile(graphName, id);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(snippetData, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);

    return id;
  }

  async listSnippets(graphName: string): Promise<Array<{
    id: string;
    label: string;
    description: string;
    nodeCount: number;
    edgeCount: number;
    createdAt: string;
  }>> {
    const dir = this.snippetsDir(graphName);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const snippets = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), "utf-8");
        const data = JSON.parse(raw);
        snippets.push({
          id: data.id,
          label: data.label,
          description: data.description ?? "",
          nodeCount: data.nodeCount ?? data.nodes?.length ?? 0,
          edgeCount: data.edgeCount ?? data.edges?.length ?? 0,
          createdAt: data.createdAt,
        });
      } catch {}
    }
    return snippets;
  }

  async loadSnippet(graphName: string, snippetId: string): Promise<any> {
    const filePath = this.snippetFile(graphName, snippetId);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async deleteSnippet(graphName: string, snippetId: string): Promise<void> {
    const filePath = this.snippetFile(graphName, snippetId);
    await fs.rm(filePath);
  }
}
