// ============================================================
// Event-sourced storage backend.
//
// Each graph branch is an append-only events.jsonl file plus a
// snapshot.json materialized cache. Events are the source of truth;
// the snapshot is a derived view that exists for fast reads.
//
// On-disk layout:
//   graphs/<name>/
//     metadata.json              graph-level metadata + defaultBranch
//     branches/<branch>/
//       events.jsonl             append-only event log (truth)
//       snapshot.json            materialized cache (rebuildable)
//     snippets/<id>.json         saved queries (orthogonal to events)
//     terms.json                 term registry (carry-forward)
//
// Snapshots (the user-visible "save state and roll back here later"
// feature) are events with op="snapshot.label". Listing snapshots is
// scanning events for label entries. Rolling back is truncating the
// event log at the snapshot's position.
//
// Branches are forks: creating a branch copies the parent branch's
// events.jsonl and snapshot.json into a new branch directory.
//
// The current event count of a branch is its version number, used
// for optimistic concurrency.
// ============================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dataDir } from "../core/paths.js";
import {
  applyEvents,
  diffToEvents,
  makeSnapshotLabelEvent,
  parseEvent,
  replay,
  serializeEvent,
  type GraphEvent,
  type SnapshotLabelEvent,
} from "../core/events.js";
import type {
  StorageBackend,
  LearningGraphData,
  LearningGraphMetadata,
  LearningGraphSummary,
} from "../core/types.js";

interface GraphMetadataFile {
  name: string;
  description: string;
  defaultBranch: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

const SCHEMA_VERSION = 1;
const DEFAULT_BRANCH = "main";

function emptyGraphData(name: string, description: string): LearningGraphData {
  const now = new Date().toISOString();
  return {
    metadata: {
      name,
      description,
      createdAt: now,
      updatedAt: now,
    },
    nodes: [],
    edges: [],
  };
}

export interface EventSourcedBackendOptions {
  /**
   * Identifier recorded as the author of every event this backend
   * generates. Defaults to the BACKPACK_AUTHOR environment variable.
   * Used by collaboration features to attribute changes.
   */
  author?: string;
}

export class EventSourcedBackend implements StorageBackend {
  private baseDir: string;
  private author: string | undefined;

  constructor(baseDir?: string, options?: EventSourcedBackendOptions) {
    this.baseDir = baseDir ?? dataDir();
    this.author =
      options?.author ?? process.env.BACKPACK_AUTHOR ?? undefined;
  }

  /**
   * Set the author identifier used for newly-emitted events. Pass
   * undefined to clear it. Useful in tests and in long-running
   * processes where the active user changes.
   */
  setAuthor(author: string | undefined): void {
    this.author = author;
  }

  getAuthor(): string | undefined {
    return this.author;
  }

  // --- Path helpers ---

  private graphsDir(): string {
    return path.join(this.baseDir, "graphs");
  }

  private graphDir(name: string): string {
    return path.join(this.graphsDir(), name);
  }

  private metadataFile(name: string): string {
    return path.join(this.graphDir(name), "metadata.json");
  }

  private branchesDir(name: string): string {
    return path.join(this.graphDir(name), "branches");
  }

  private branchDir(name: string, branch: string): string {
    return path.join(this.branchesDir(name), branch);
  }

  private eventsFile(name: string, branch: string): string {
    return path.join(this.branchDir(name, branch), "events.jsonl");
  }

  private snapshotFile(name: string, branch: string): string {
    return path.join(this.branchDir(name, branch), "snapshot.json");
  }

  private snippetsDir(name: string): string {
    return path.join(this.graphDir(name), "snippets");
  }

  private snippetFile(name: string, snippetId: string): string {
    return path.join(this.snippetsDir(name), `${snippetId}.json`);
  }

  private termsFile(name: string): string {
    return path.join(this.graphDir(name), "terms.json");
  }

  // --- IO helpers ---

  private async writeAtomic(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath);
  }

  // --- Metadata ---

  async loadMetadata(name: string): Promise<GraphMetadataFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.metadataFile(name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Learning graph "${name}" not found`);
      }
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`metadata.json for "${name}" is malformed`);
    }
    return parsed as GraphMetadataFile;
  }

  private async writeMetadata(name: string, meta: GraphMetadataFile): Promise<void> {
    await this.writeAtomic(
      this.metadataFile(name),
      JSON.stringify(meta, null, 2),
    );
  }

  // --- Snapshot helpers ---

  /**
   * Load the materialized state for a branch. Reads snapshot.json
   * directly. If the cache is missing, rebuilds it from the event log.
   */
  private async loadBranchSnapshot(
    name: string,
    branch: string,
  ): Promise<LearningGraphData> {
    try {
      const raw = await fs.readFile(this.snapshotFile(name, branch), "utf8");
      return JSON.parse(raw) as LearningGraphData;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return this.rebuildSnapshot(name, branch);
    }
  }

  private async writeSnapshotFile(
    name: string,
    branch: string,
    data: LearningGraphData,
  ): Promise<void> {
    await this.writeAtomic(
      this.snapshotFile(name, branch),
      JSON.stringify(data, null, 2),
    );
  }

  private async rebuildSnapshot(
    name: string,
    branch: string,
  ): Promise<LearningGraphData> {
    const events = await this.loadEvents(name, branch);
    const meta = await this.loadMetadata(name);
    const initial: LearningGraphMetadata = {
      name: meta.name,
      description: meta.description,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    const state = replay(events, initial);
    await this.writeSnapshotFile(name, branch, state);
    return state;
  }

  // --- Event log helpers ---

  private async loadEvents(name: string, branch: string): Promise<GraphEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.eventsFile(name, branch), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const events: GraphEvent[] = [];
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue;
      try {
        events.push(parseEvent(line));
      } catch (err) {
        throw new Error(
          `parse error in ${this.eventsFile(name, branch)}:${i + 1}: ${(err as Error).message}`,
        );
      }
    }
    return events;
  }

  private async eventCount(name: string, branch: string): Promise<number> {
    const events = await this.loadEvents(name, branch);
    return events.length;
  }

  /**
   * Append events to a branch's event log and update its snapshot
   * cache. If `expectedVersion` is provided, the append fails when the
   * current event count differs (optimistic concurrency).
   *
   * Returns the new event count after append.
   */
  async appendEvents(
    name: string,
    branch: string,
    events: GraphEvent[],
    expectedVersion?: number,
  ): Promise<number> {
    if (events.length === 0) {
      return this.eventCount(name, branch);
    }

    if (expectedVersion !== undefined) {
      const current = await this.eventCount(name, branch);
      if (current !== expectedVersion) {
        throw new Error(
          `version conflict on ${name}/${branch}: expected ${expectedVersion}, found ${current}`,
        );
      }
    }

    const currentState = await this.loadBranchSnapshot(name, branch);
    const newState = applyEvents(currentState, events);

    const lines = events.map(serializeEvent).join("\n") + "\n";
    await fs.appendFile(this.eventsFile(name, branch), lines, "utf8");

    await this.writeSnapshotFile(name, branch, newState);

    return await this.eventCount(name, branch);
  }

  /**
   * Replace the entire event log for a branch (used for rollback).
   * Atomically writes a new events.jsonl file and rebuilds the snapshot.
   */
  private async replaceEvents(
    name: string,
    branch: string,
    events: GraphEvent[],
  ): Promise<void> {
    const lines =
      events.map(serializeEvent).join("\n") + (events.length > 0 ? "\n" : "");
    await this.writeAtomic(this.eventsFile(name, branch), lines);
    const meta = await this.loadMetadata(name);
    const initial: LearningGraphMetadata = {
      name: meta.name,
      description: meta.description,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    const state = replay(events, initial);
    await this.writeSnapshotFile(name, branch, state);
  }

  // --- StorageBackend interface ---

  async initialize(): Promise<void> {
    await fs.mkdir(this.graphsDir(), { recursive: true });
  }

  async listOntologies(): Promise<LearningGraphSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.graphsDir());
    } catch {
      return [];
    }

    const summaries: LearningGraphSummary[] = [];
    for (const entry of entries) {
      try {
        const meta = await this.loadMetadata(entry);
        const state = await this.loadBranchSnapshot(entry, meta.defaultBranch);

        const typeCounts = new Map<string, number>();
        for (const node of state.nodes) {
          typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
        }
        summaries.push({
          name: meta.name,
          description: meta.description,
          nodeCount: state.nodes.length,
          edgeCount: state.edges.length,
          nodeTypes: Array.from(typeCounts.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count),
        });
      } catch {
        // Skip malformed graph directories
      }
    }
    return summaries;
  }

  async loadOntology(name: string): Promise<LearningGraphData> {
    const meta = await this.loadMetadata(name);
    return this.loadBranchSnapshot(name, meta.defaultBranch);
  }

  async saveOntology(name: string, data: LearningGraphData): Promise<void> {
    const meta = await this.loadMetadata(name);
    const before = await this.loadBranchSnapshot(name, meta.defaultBranch);
    const events = diffToEvents(before, data, this.author);
    if (events.length === 0) return;
    await this.appendEvents(name, meta.defaultBranch, events);

    if (
      data.metadata.name !== meta.name ||
      data.metadata.description !== meta.description
    ) {
      meta.name = data.metadata.name;
      meta.description = data.metadata.description;
      meta.updatedAt = new Date().toISOString();
      await this.writeMetadata(name, meta);
    }
  }

  async createOntology(
    name: string,
    description: string,
  ): Promise<LearningGraphData> {
    if (await this.ontologyExists(name)) {
      throw new Error(`Learning graph "${name}" already exists`);
    }

    await fs.mkdir(this.branchDir(name, DEFAULT_BRANCH), { recursive: true });

    const now = new Date().toISOString();
    const meta: GraphMetadataFile = {
      name,
      description,
      defaultBranch: DEFAULT_BRANCH,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeMetadata(name, meta);

    const initial = emptyGraphData(name, description);
    await this.writeAtomic(this.eventsFile(name, DEFAULT_BRANCH), "");
    await this.writeSnapshotFile(name, DEFAULT_BRANCH, initial);

    return initial;
  }

  async deleteOntology(name: string): Promise<void> {
    if (!(await this.ontologyExists(name))) {
      throw new Error(`Learning graph "${name}" not found`);
    }
    await fs.rm(this.graphDir(name), { recursive: true, force: true });
  }

  async renameOntology(oldName: string, newName: string): Promise<void> {
    if (await this.ontologyExists(newName)) {
      throw new Error(`Learning graph "${newName}" already exists`);
    }
    await fs.rename(this.graphDir(oldName), this.graphDir(newName));
    const meta = await this.loadMetadata(newName);
    meta.name = newName;
    meta.updatedAt = new Date().toISOString();
    await this.writeMetadata(newName, meta);
  }

  async ontologyExists(name: string): Promise<boolean> {
    try {
      await fs.access(this.metadataFile(name));
      return true;
    } catch {
      return false;
    }
  }

  // --- Branches ---

  async listBranches(name: string): Promise<{
    name: string;
    nodeCount: number;
    edgeCount: number;
    active: boolean;
  }[]> {
    const meta = await this.loadMetadata(name);
    let entries: string[];
    try {
      entries = await fs.readdir(this.branchesDir(name));
    } catch {
      return [];
    }
    const branches: {
      name: string;
      nodeCount: number;
      edgeCount: number;
      active: boolean;
    }[] = [];
    for (const entry of entries) {
      try {
        const state = await this.loadBranchSnapshot(name, entry);
        branches.push({
          name: entry,
          nodeCount: state.nodes.length,
          edgeCount: state.edges.length,
          active: entry === meta.defaultBranch,
        });
      } catch {}
    }
    return branches;
  }

  async createBranch(
    name: string,
    branchName: string,
    fromBranch?: string,
  ): Promise<void> {
    const meta = await this.loadMetadata(name);
    const source = fromBranch ?? meta.defaultBranch;
    const targetDir = this.branchDir(name, branchName);
    try {
      await fs.access(targetDir);
      throw new Error(`Branch "${branchName}" already exists`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await fs.mkdir(targetDir, { recursive: true });
    const sourceEvents = this.eventsFile(name, source);
    const targetEvents = this.eventsFile(name, branchName);
    try {
      await fs.copyFile(sourceEvents, targetEvents);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await this.writeAtomic(targetEvents, "");
    }
    const sourceSnap = this.snapshotFile(name, source);
    const targetSnap = this.snapshotFile(name, branchName);
    try {
      await fs.copyFile(sourceSnap, targetSnap);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await this.rebuildSnapshot(name, branchName);
    }
  }

  async switchBranch(name: string, branchName: string): Promise<void> {
    const branchDir = this.branchDir(name, branchName);
    try {
      await fs.access(branchDir);
    } catch {
      throw new Error(`Branch "${branchName}" does not exist`);
    }
    const meta = await this.loadMetadata(name);
    meta.defaultBranch = branchName;
    meta.updatedAt = new Date().toISOString();
    await this.writeMetadata(name, meta);
  }

  async deleteBranch(name: string, branchName: string): Promise<void> {
    const meta = await this.loadMetadata(name);
    if (branchName === meta.defaultBranch) {
      throw new Error(`Cannot delete the active branch "${branchName}"`);
    }
    if (branchName === DEFAULT_BRANCH) {
      throw new Error(`Cannot delete the "${DEFAULT_BRANCH}" branch`);
    }
    await fs.rm(this.branchDir(name, branchName), { recursive: true, force: true });
  }

  async loadBranch(name: string, branchName: string): Promise<LearningGraphData> {
    return this.loadBranchSnapshot(name, branchName);
  }

  // --- Snapshots (labeled events) ---

  async createSnapshot(name: string, label?: string): Promise<number> {
    const meta = await this.loadMetadata(name);
    const event = makeSnapshotLabelEvent(label, this.author);
    await this.appendEvents(name, meta.defaultBranch, [event]);
    return await this.eventCount(name, meta.defaultBranch);
  }

  async listSnapshots(name: string): Promise<{
    version: number;
    timestamp: string;
    nodeCount: number;
    edgeCount: number;
    label?: string;
  }[]> {
    const meta = await this.loadMetadata(name);
    const events = await this.loadEvents(name, meta.defaultBranch);
    const snapshots: {
      version: number;
      timestamp: string;
      nodeCount: number;
      edgeCount: number;
      label?: string;
    }[] = [];
    let runningState = emptyGraphData(meta.name, meta.description);
    for (let i = 0; i < events.length; i++) {
      runningState = applyEvents(runningState, [events[i]]);
      if (events[i].op === "snapshot.label") {
        const snapEvent = events[i] as SnapshotLabelEvent;
        snapshots.push({
          version: i + 1,
          timestamp: snapEvent.ts,
          nodeCount: runningState.nodes.length,
          edgeCount: runningState.edges.length,
          label: snapEvent.label,
        });
      }
    }
    snapshots.reverse();
    return snapshots;
  }

  /**
   * Load the materialized state at a specific snapshot version. The
   * version is the position in the event log of a snapshot.label event,
   * matching the value returned by createSnapshot and listSnapshots.
   */
  async loadSnapshot(name: string, version: number): Promise<LearningGraphData> {
    const meta = await this.loadMetadata(name);
    const events = await this.loadEvents(name, meta.defaultBranch);
    if (version < 1 || version > events.length) {
      throw new Error(`Snapshot version ${version} not found`);
    }
    const initial: LearningGraphMetadata = {
      name: meta.name,
      description: meta.description,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    return replay(events.slice(0, version), initial);
  }

  async rollback(name: string, version: number): Promise<void> {
    const meta = await this.loadMetadata(name);
    const events = await this.loadEvents(name, meta.defaultBranch);
    if (version < 1 || version > events.length) {
      throw new Error(`Snapshot version ${version} not found`);
    }
    const truncated = events.slice(0, version);
    await this.replaceEvents(name, meta.defaultBranch, truncated);
  }

  async getSnapshotLimit(_name: string): Promise<number> {
    return Number.MAX_SAFE_INTEGER;
  }

  // --- Snippets (orthogonal to events) ---

  async saveSnippet(graphName: string, snippet: {
    label: string;
    description?: string;
    nodeIds: string[];
    edgeIds: string[];
  }): Promise<string> {
    const id =
      snippet.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50) || "snippet";

    const data = await this.loadOntology(graphName);
    const meta = await this.loadMetadata(graphName);

    const nodeSet = new Set(snippet.nodeIds);
    let resolvedEdgeIds = snippet.edgeIds;
    if (!resolvedEdgeIds || resolvedEdgeIds.length === 0) {
      resolvedEdgeIds = data.edges
        .filter((e) => nodeSet.has(e.sourceId) && nodeSet.has(e.targetId))
        .map((e) => e.id);
    }
    const edgeSet = new Set(resolvedEdgeIds);

    const snippetData = {
      id,
      label: snippet.label,
      description: snippet.description ?? "",
      parentGraph: graphName,
      parentBranch: meta.defaultBranch,
      nodeIds: snippet.nodeIds,
      edgeIds: resolvedEdgeIds,
      nodes: data.nodes.filter((n) => nodeSet.has(n.id)),
      edges: data.edges.filter((e) => edgeSet.has(e.id)),
      nodeCount: snippet.nodeIds.length,
      edgeCount: resolvedEdgeIds.length,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(this.snippetsDir(graphName), { recursive: true });
    await this.writeAtomic(
      this.snippetFile(graphName, id),
      JSON.stringify(snippetData, null, 2),
    );

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
    let entries: string[];
    try {
      entries = await fs.readdir(this.snippetsDir(graphName));
    } catch {
      return [];
    }
    const snippets = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(
          path.join(this.snippetsDir(graphName), entry),
          "utf8",
        );
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
    const raw = await fs.readFile(
      this.snippetFile(graphName, snippetId),
      "utf8",
    );
    return JSON.parse(raw);
  }

  async deleteSnippet(graphName: string, snippetId: string): Promise<void> {
    await fs.rm(this.snippetFile(graphName, snippetId));
  }

  // --- Terms (carry-forward from old backend, used by intelligence tools) ---

  async loadTerms(name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.termsFile(name), "utf8");
    } catch {
      return null;
    }
  }
}
