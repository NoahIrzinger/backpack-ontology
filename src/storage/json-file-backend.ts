import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dataDir } from "../core/paths.js";
import type {
  StorageBackend,
  LearningGraphData,
  LearningGraphSummary,
} from "../core/types.js";

/**
 * Default storage backend: JSON files on disk.
 *
 * Layout (XDG Base Directory spec):
 *   ~/.local/share/backpack/
 *   └── ontologies/
 *       ├── cooking/
 *       │   └── ontology.json
 *       └── codebase/
 *           └── ontology.json
 *
 * Each ontology is a single JSON file containing metadata, nodes, and edges.
 * Writes are atomic (write to .tmp, then rename) to prevent corruption.
 */
export class JsonFileBackend implements StorageBackend {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? dataDir();
  }

  private ontologiesDir(): string {
    return path.join(this.baseDir, "ontologies");
  }

  private ontologyDir(name: string): string {
    return path.join(this.ontologiesDir(), name);
  }

  private ontologyFile(name: string): string {
    return path.join(this.ontologyDir(name), "ontology.json");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.ontologiesDir(), { recursive: true });
  }

  async listOntologies(): Promise<LearningGraphSummary[]> {
    const dir = this.ontologiesDir();
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const summaries: LearningGraphSummary[] = [];

    for (const entry of entries) {
      const filePath = path.join(dir, entry, "ontology.json");
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const data: LearningGraphData = JSON.parse(raw);

        // Derive node type counts from actual data
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
        // Skip directories that don't have a valid ontology.json
      }
    }

    return summaries;
  }

  async loadOntology(name: string): Promise<LearningGraphData> {
    const filePath = this.ontologyFile(name);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as LearningGraphData;
    } catch (err) {
      throw new Error(`Ontology not found: ${name}`);
    }
  }

  async saveOntology(name: string, data: LearningGraphData): Promise<void> {
    const filePath = this.ontologyFile(name);
    const tmpPath = filePath + ".tmp";

    // Atomic write: write to temp file, then rename
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, filePath);
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

    await fs.mkdir(this.ontologyDir(name), { recursive: true });
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

    // Update metadata inside the JSON
    const data = await this.loadOntology(oldName);
    data.metadata.name = newName;
    data.metadata.updatedAt = new Date().toISOString();

    // Create new directory, write data, remove old
    await fs.mkdir(this.ontologyDir(newName), { recursive: true });
    await this.saveOntology(newName, data);
    await fs.rm(this.ontologyDir(oldName), { recursive: true });
  }

  async deleteOntology(name: string): Promise<void> {
    if (!(await this.ontologyExists(name))) {
      throw new Error(`Ontology not found: ${name}`);
    }
    await fs.rm(this.ontologyDir(name), { recursive: true });
  }

  async ontologyExists(name: string): Promise<boolean> {
    try {
      await fs.access(this.ontologyFile(name));
      return true;
    } catch {
      return false;
    }
  }
}
