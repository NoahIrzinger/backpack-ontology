import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { dataDir } from "../../core/paths.js";

export function registerSignalTools(
  server: McpServer,
  backpack: Backpack,
): void {

  server.registerTool(
    "backpack_signal_list",
    {
      title: "List Signals",
      description:
        "List active signals for the current backpack. Signals are derived insights — concentration risks, bridge nodes, orphan clusters, cross-graph entities — computed from graph structure and KB content. Filter by graph, kind, severity, or text search. Search 'my-graph' to find signals touching Chester across all graphs.",
      inputSchema: {
        graph: z.string().optional().describe("Filter to signals involving this graph"),
        kind: z.string().optional().describe("Filter by signal kind (e.g. 'concentration_risk', 'bridge_node', 'cross_graph_entity')"),
        severity: z.string().optional().describe("Filter by severity: 'critical', 'high', 'medium', 'low'"),
        query: z.string().optional().describe("Text search across signal titles, descriptions, and graph names"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ graph, kind, severity, query }) => {
      try {
        const store = await backpack.signals();
        const result = await store.list({
          graph,
          kind: kind as any,
          severity,
          query,
        });
        trackEvent("tool_call", { tool: "backpack_signal_list" });

        if (result.signals.length === 0) {
          const msg = result.computedAt
            ? `No active signals${graph ? ` for "${graph}"` : ""}${query ? ` matching "${query}"` : ""}. ${result.dismissed} dismissed. Last detected: ${result.computedAt}`
            : "No signals detected yet. Run backpack_signal_detect to scan the backpack.";
          return { content: [{ type: "text" as const, text: msg }] };
        }

        const lines = result.signals.map((s) => {
          const graphs = s.graphNames.join(", ");
          return `[${s.severity.toUpperCase()}] ${s.title}\n  Kind: ${s.kind} | Graphs: ${graphs} | Score: ${s.score.toFixed(1)}\n  Evidence nodes: ${s.evidenceNodeIds.slice(0, 5).join(", ")}${s.evidenceNodeIds.length > 5 ? "…" : ""}\n  ID: ${s.id}`;
        });

        const header = `${result.signals.length} active signal${result.signals.length > 1 ? "s" : ""}${result.dismissed ? ` (${result.dismissed} dismissed)` : ""} — last detected ${result.computedAt}`;
        return {
          content: [{ type: "text" as const, text: `${header}\n\n${lines.join("\n\n")}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "backpack_signal_detect",
    {
      title: "Detect Signals",
      description:
        "Scan ALL graphs and KB documents in the active backpack to detect signals. Runs structural detectors (concentration risk, bridge nodes, orphan clusters, stale clusters, sparse types) and cross-cutting detectors (cross-graph entities, type overlap). Results are persisted to signals.json. Run this after mining, adding nodes, or writing KB docs.",
      inputSchema: {},
    },
    async () => {
      try {
        const store = await backpack.signals();

        // Load all graphs
        const summaries = await backpack.listOntologies();
        const graphs: { name: string; data: any }[] = [];
        for (const s of summaries) {
          try {
            const data = await backpack.loadOntology(s.name);
            graphs.push({ name: s.name, data });
          } catch {
            // skip graphs that fail to load
          }
        }

        // Load KB doc metadata
        let docs: any[] = [];
        try {
          const docStore = await backpack.documents();
          const result = await docStore.list({ limit: 500 });
          docs = result.documents;
        } catch {
          // KB might not be configured
        }

        const result = await store.detect(graphs, docs);
        trackEvent("tool_call", { tool: "backpack_signal_detect" });

        if (result.signals.length === 0) {
          return {
            content: [{ type: "text" as const, text: `Detection complete. No signals found across ${graphs.length} graph${graphs.length !== 1 ? "s" : ""} and ${docs.length} KB doc${docs.length !== 1 ? "s" : ""}. ${result.dismissed} previously dismissed.` }],
          };
        }

        const bySeverity: Record<string, number> = {};
        for (const s of result.signals) bySeverity[s.severity] = (bySeverity[s.severity] ?? 0) + 1;

        const summary = Object.entries(bySeverity)
          .filter(([, count]) => count > 0)
          .map(([sev, count]) => `${count} ${sev}`)
          .join(", ");

        // Build node label lookup for evidence context
        const nodeLabels = new Map<string, { label: string; type: string; props: string }>();
        for (const { data } of graphs) {
          for (const node of data.nodes) {
            const label = Object.values(node.properties).find((v): v is string => typeof v === "string" && v.length > 0) ?? node.id;
            const propSummary = Object.entries(node.properties)
              .filter(([, v]) => v !== undefined && v !== null && String(v).length < 80)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            nodeLabels.set(node.id, { label, type: node.type, props: propSummary });
          }
        }

        // Output top signals with full evidence context for LLM enrichment
        const topSignals = result.signals.slice(0, 15);
        const signalBlocks = topSignals.map((s, i) => {
          const evidenceContext = s.evidenceNodeIds.slice(0, 5).map((nid) => {
            const info = nodeLabels.get(nid);
            return info ? `  - "${info.label}" (${info.type}${info.props ? `: ${info.props}` : ""})` : `  - ${nid}`;
          }).join("\n");

          return `${i + 1}. [${s.severity.toUpperCase()}] ${s.title}\n   Kind: ${s.kind} | Graphs: ${s.graphNames.join(", ")}\n   Description: ${s.description}\n   Evidence nodes:\n${evidenceContext || "   (none)"}`;
        });
        const more = result.signals.length > 15
          ? `\n\n… and ${result.signals.length - 15} more (use backpack_signal_list to see all)`
          : "";

        const enrichmentPrompt = `\n\n---\nYou now have ${result.signals.length} signals with evidence context. For the HIGH and MEDIUM signals above, write a brief enrichment — 1-2 sentences explaining WHY this signal matters in the context of this specific backpack and what the user should consider doing about it. Use the evidence node labels and properties to make it specific, not generic. Then save the enriched descriptions back to the signals using backpack_signal_list to review.`;

        return {
          content: [{
            type: "text" as const,
            text: `Detected ${result.signals.length} signal${result.signals.length > 1 ? "s" : ""} across ${graphs.length} graph${graphs.length !== 1 ? "s" : ""} (${summary})${result.dismissed ? ` — ${result.dismissed} dismissed` : ""}:\n\n${signalBlocks.join("\n\n")}${more}${enrichmentPrompt}`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "backpack_signal_dismiss",
    {
      title: "Dismiss Signal",
      description:
        "Dismiss a signal by ID. Dismissed signals won't appear in signal_list until the backpack state changes enough to produce a different signal at that location. Use this to acknowledge a signal you've seen and don't need surfaced anymore.",
      inputSchema: {
        signalId: z.string().describe("ID of the signal to dismiss"),
      },
    },
    async ({ signalId }) => {
      try {
        const store = await backpack.signals();
        await store.dismiss(signalId);
        trackEvent("tool_call", { tool: "backpack_signal_dismiss" });
        return {
          content: [{ type: "text" as const, text: `Signal "${signalId}" dismissed.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "backpack_signal_configure",
    {
      title: "Configure Signals",
      description:
        "Adjust signal detection sensitivity and enable/disable specific detector kinds. Sensitivity is 0.0–1.0: lower values surface fewer, higher-confidence signals; higher values surface more signals including lower-confidence ones. Default is 0.5.",
      inputSchema: {
        sensitivity: z.number().min(0).max(1).optional().describe("Detection sensitivity (0.0 = only critical, 1.0 = everything). Default 0.5."),
        disabledKinds: z.array(z.string()).optional().describe("Signal kinds to disable (e.g. ['sparse_type', 'stale_cluster'])"),
      },
    },
    async ({ sensitivity, disabledKinds }) => {
      try {
        const store = await backpack.signals();
        const config = await store.configure({
          sensitivity,
          disabledKinds: disabledKinds as any,
        });
        trackEvent("tool_call", { tool: "backpack_signal_configure" });
        return {
          content: [{
            type: "text" as const,
            text: `Signal config updated:\n  Sensitivity: ${config.sensitivity}\n  Disabled kinds: ${config.disabledKinds.length > 0 ? config.disabledKinds.join(", ") : "(none)"}`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "backpack_signal_enrich",
    {
      title: "Enrich Signal Descriptions",
      description:
        "Update signal descriptions with LLM-enriched contextual explanations. After running signal_detect, use this to rewrite signal descriptions with richer context that explains WHY the signal matters and what to do about it. Pass an array of {id, description} pairs.",
      inputSchema: {
        enrichments: z.array(z.object({
          id: z.string().describe("Signal ID"),
          description: z.string().describe("Enriched description with contextual explanation"),
        })).describe("Array of signal ID + enriched description pairs"),
      },
    },
    async ({ enrichments }) => {
      try {
        const store = await backpack.signals();
        const file = await store.load();
        let updated = 0;

        for (const { id, description } of enrichments) {
          const signal = file.signals.find((s) => s.id === id);
          if (signal) {
            signal.description = description;
            updated++;
          }
        }

        if (updated > 0) {
          await store.save(file);
        }

        trackEvent("tool_call", { tool: "backpack_signal_enrich" });
        return {
          content: [{ type: "text" as const, text: `Enriched ${updated} signal description${updated !== 1 ? "s" : ""}.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "backpack_signal_selected",
    {
      title: "Get Selected Signals",
      description:
        "Read the signals the user has selected in the viewer. Returns the full signal data with evidence context for each checked signal. Use this when the user says 'look at my selected signals', 'enrich these', 'mine these signals', or 'write a KB for these signals'.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        // Read viewer state to get selected signal IDs
        const statePath = path.join(dataDir(), "viewer-state.json");
        let selectedIds: string[] = [];
        try {
          const raw = await fs.readFile(statePath, "utf8");
          const state = JSON.parse(raw);
          selectedIds = state.selectedSignalIds ?? [];
        } catch {
          return {
            content: [{ type: "text" as const, text: "No viewer state available — the viewer may not be running, or no signals are selected." }],
          };
        }

        if (selectedIds.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No signals selected. Check signals in the viewer's Signals tab, then try again." }],
          };
        }

        // Load full signal data
        const store = await backpack.signals();
        const file = await store.load();
        const selectedSet = new Set(selectedIds);
        const selected = file.signals.filter((s) => selectedSet.has(s.id));

        if (selected.length === 0) {
          return {
            content: [{ type: "text" as const, text: `${selectedIds.length} signal ID(s) selected in viewer but none match current signals.json. Try re-detecting signals.` }],
          };
        }

        // Load node labels for evidence context
        const summaries = await backpack.listOntologies();
        const nodeLabels = new Map<string, { label: string; type: string; props: string }>();
        for (const s of summaries) {
          try {
            const data = await backpack.loadOntology(s.name);
            for (const node of data.nodes) {
              const label = Object.values(node.properties).find((v): v is string => typeof v === "string" && v.length > 0) ?? node.id;
              const propSummary = Object.entries(node.properties)
                .filter(([, v]) => v !== undefined && v !== null && String(v).length < 80)
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ");
              nodeLabels.set(node.id, { label, type: node.type, props: propSummary });
            }
          } catch { /* skip */ }
        }

        const blocks = selected.map((s, i) => {
          const evidence = s.evidenceNodeIds.slice(0, 6).map((nid) => {
            const info = nodeLabels.get(nid);
            return info ? `  - "${info.label}" (${info.type}${info.props ? `: ${info.props}` : ""})` : `  - ${nid}`;
          }).join("\n");

          return `${i + 1}. [${s.severity.toUpperCase()}] ${s.title}\n   Kind: ${s.kind} | Graphs: ${s.graphNames.join(", ")}${s.tags.length > 0 ? ` | Tags: ${s.tags.join(", ")}` : ""}\n   ${s.description}\n   Evidence:\n${evidence || "   (none)"}`;
        });

        trackEvent("tool_call", { tool: "backpack_signal_selected" });
        return {
          content: [{
            type: "text" as const,
            text: `${selected.length} signal${selected.length > 1 ? "s" : ""} selected:\n\n${blocks.join("\n\n")}`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
