// ============================================================
// SignalStore — manages backpack-level signals.json.
//
// Persists detected signals to disk alongside graphs and KBs.
// Detection scans all graphs + KBs in the active backpack.
// Signals are regenerable — can always be recomputed from
// current graph/KB state.
// ============================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LearningGraphData } from "./types.js";
import type { KBDocumentMeta } from "./document-store.js";
import type {
  Signal,
  SignalFile,
  SignalConfig,
  SignalResult,
  SignalKind,
  GraphDetectorInput,
  CrossCuttingDetectorInput,
} from "./signal-types.js";
import { DEFAULT_SIGNAL_CONFIG } from "./signal-types.js";
import { GRAPH_DETECTORS, CROSS_CUTTING_DETECTORS } from "./signal-detectors.js";

export class SignalStore {
  private filePath: string;

  constructor(backpackPath: string) {
    this.filePath = path.join(backpackPath, "signals.json");
  }

  // --- Read ---

  async load(): Promise<SignalFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as SignalFile;
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return {
          signals: [],
          dismissed: [],
          config: { ...DEFAULT_SIGNAL_CONFIG },
          computedAt: "",
        };
      }
      throw err;
    }
  }

  async list(opts?: {
    graph?: string;
    kind?: SignalKind;
    severity?: string;
    query?: string;
  }): Promise<SignalResult> {
    const file = await this.load();
    const dismissedSet = new Set(file.dismissed);
    let signals = file.signals.filter((s) => !dismissedSet.has(s.id));
    const dismissedCount = file.signals.length - signals.length;

    if (opts?.graph) {
      signals = signals.filter((s) => s.graphNames.includes(opts.graph!));
    }
    if (opts?.kind) {
      signals = signals.filter((s) => s.kind === opts.kind);
    }
    if (opts?.severity) {
      signals = signals.filter((s) => s.severity === opts.severity);
    }
    if (opts?.query) {
      const q = opts.query.toLowerCase();
      signals = signals.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.graphNames.some((g) => g.toLowerCase().includes(q)) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return {
      signals: signals.sort((a, b) => b.score - a.score),
      dismissed: dismissedCount,
      computedAt: file.computedAt,
    };
  }

  // --- Detect ---

  async detect(
    graphs: { name: string; data: LearningGraphData }[],
    docs: KBDocumentMeta[],
  ): Promise<SignalResult> {
    const file = await this.load();
    const config = file.config ?? { ...DEFAULT_SIGNAL_CONFIG };
    const { sensitivity, disabledKinds } = config;

    const allSignals: Signal[] = [];

    // Per-graph detectors
    for (const { name, data } of graphs) {
      const input: GraphDetectorInput = { data, graphName: name };
      for (const detector of GRAPH_DETECTORS) {
        if (disabledKinds.includes(detector.kind)) continue;
        allSignals.push(...detector.detect(input, sensitivity));
      }
    }

    // Cross-cutting detectors
    const crossInput: CrossCuttingDetectorInput = {
      graphs: graphs.map(({ name, data }) => ({ data, graphName: name })),
      docs,
    };
    for (const detector of CROSS_CUTTING_DETECTORS) {
      if (disabledKinds.includes(detector.kind)) continue;
      allSignals.push(...detector.detect(crossInput, sensitivity));
    }

    // Enrich signals with tags derived from graph nodes and KB docs
    this.enrichTags(allSignals, graphs, docs);

    // Preserve dismissed list, write new signals
    const newFile: SignalFile = {
      signals: allSignals,
      dismissed: file.dismissed,
      config,
      computedAt: new Date().toISOString(),
    };

    await this.save(newFile);

    const dismissedSet = new Set(file.dismissed);
    const active = allSignals.filter((s) => !dismissedSet.has(s.id));

    return {
      signals: active.sort((a, b) => b.score - a.score),
      dismissed: allSignals.length - active.length,
      computedAt: newFile.computedAt,
    };
  }

  // --- Dismiss ---

  async dismiss(signalId: string): Promise<void> {
    const file = await this.load();
    if (!file.dismissed.includes(signalId)) {
      file.dismissed.push(signalId);
    }
    await this.save(file);
  }

  // --- Configure ---

  async configure(update: Partial<SignalConfig>): Promise<SignalConfig> {
    const file = await this.load();
    if (update.sensitivity !== undefined) {
      file.config.sensitivity = Math.max(0, Math.min(1, update.sensitivity));
    }
    if (update.disabledKinds !== undefined) {
      file.config.disabledKinds = update.disabledKinds;
    }
    await this.save(file);
    return file.config;
  }

  // --- Tag enrichment ---

  private enrichTags(
    signals: Signal[],
    graphs: { name: string; data: LearningGraphData }[],
    docs: KBDocumentMeta[],
  ): void {
    // Build lookup: nodeId → { types, graphName }
    const nodeInfo = new Map<string, { type: string; graphName: string }>();
    for (const { name, data } of graphs) {
      for (const node of data.nodes) {
        nodeInfo.set(node.id, { type: node.type, graphName: name });
      }
    }

    // Build lookup: graph name → KB tags associated with that graph
    const graphKBTags = new Map<string, Set<string>>();
    for (const doc of docs) {
      const docTags = doc.tags ?? [];
      const sourceGraphs = doc.sourceGraphs ?? [];
      for (const g of sourceGraphs) {
        if (!graphKBTags.has(g)) graphKBTags.set(g, new Set());
        for (const t of docTags) graphKBTags.get(g)!.add(t);
      }
    }

    for (const signal of signals) {
      const tags = new Set<string>();

      // Graph names as tags
      for (const g of signal.graphNames) tags.add(g);

      // Node types from evidence
      for (const nid of signal.evidenceNodeIds) {
        const info = nodeInfo.get(nid);
        if (info) tags.add(info.type.toLowerCase());
      }

      // KB tags from source graphs
      for (const g of signal.graphNames) {
        const kbTags = graphKBTags.get(g);
        if (kbTags) for (const t of kbTags) tags.add(t);
      }

      // Signal kind as a tag
      tags.add(signal.kind.replace(/_/g, "-"));

      signal.tags = [...tags];
    }
  }

  // --- Persistence ---

  async save(file: SignalFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
