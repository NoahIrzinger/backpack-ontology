/**
 * Anonymous usage telemetry for Backpack.
 *
 * Collects tool call counts, session duration, and aggregate ontology stats.
 * No personal data, ontology content, or tool arguments are ever collected.
 *
 * Opt out:
 *   - Set DO_NOT_TRACK=1
 *   - Set BACKPACK_TELEMETRY_DISABLED=1
 *   - Add {"telemetry": false} to ~/.config/backpack/config.json
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { configDir } from "./paths.js";
import type { Backpack } from "./backpack.js";

const ENDPOINT =
  process.env.BACKPACK_TELEMETRY_URL ?? "https://diagnostics.backpackontology.com/api/telemetry";
const VERSION = "0.2.14";

interface TelemetryEvent {
  event: string;
  machineId: string;
  sessionId: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Module-level state
const sessionId = crypto.randomUUID();
const sessionStartTime = Date.now();
let machineId: string | null = null;
let toolCalls: Record<string, number> = {};
let disabled: boolean | null = null;
let backpackRef: Backpack | null = null;
let initialized = false;
let shutdownCalled = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function isDisabled(): Promise<boolean> {
  if (disabled !== null) return disabled;

  if (process.env.DO_NOT_TRACK === "1") {
    disabled = true;
    return true;
  }

  if (process.env.BACKPACK_TELEMETRY_DISABLED === "1") {
    disabled = true;
    return true;
  }

  try {
    const configPath = path.join(configDir(), "config.json");
    const raw = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (config.telemetry === false) {
      disabled = true;
      return true;
    }
  } catch {
    // Config file doesn't exist or is invalid — telemetry stays enabled
  }

  disabled = false;
  return false;
}

async function getMachineId(): Promise<string> {
  if (machineId) return machineId;

  const idPath = path.join(configDir(), "machine-id");
  let isNew = false;

  try {
    machineId = (await fs.readFile(idPath, "utf-8")).trim();
  } catch {
    // File doesn't exist — generate a new ID
    const hash = crypto
      .createHash("sha256")
      .update(os.hostname() + os.platform())
      .digest("hex")
      .slice(0, 16);

    await fs.mkdir(configDir(), { recursive: true });
    await fs.writeFile(idPath, hash, "utf-8");
    machineId = hash;
    isNew = true;
  }

  if (isNew) {
    showFirstRunNotice();
  }

  return machineId;
}

function showFirstRunNotice(): void {
  console.error(
    [
      "",
      "Backpack collects anonymous usage telemetry to improve the product.",
      "Only tool names, session duration, and aggregate stats are collected.",
      "No personal data, ontology content, or tool arguments are sent.",
      "",
      "To opt out:",
      "  export BACKPACK_TELEMETRY_DISABLED=1",
      '  or add {"telemetry": false} to ~/.config/backpack/config.json',
      "",
    ].join("\n")
  );
}

/** Send events to the diagnostics endpoint. Never throws. */
async function sendEvents(events: TelemetryEvent[]): Promise<void> {
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Network failures are expected (offline, DNS, etc.) — silently ignore
  }
}

/** Build the current session snapshot (reused by heartbeat and shutdown). */
async function buildSnapshot(event: string): Promise<TelemetryEvent> {
  let ontologyCount = 0;
  let totalNodes = 0;
  let totalEdges = 0;
  let branchCount = 0;
  let snapshotCount = 0;
  if (backpackRef) {
    try {
      const ontologies = await backpackRef.listOntologies();
      ontologyCount = ontologies.length;
      for (const o of ontologies) {
        totalNodes += o.nodeCount;
        totalEdges += o.edgeCount;
        try {
          const branches = await backpackRef.listBranches(o.name);
          branchCount += (branches as any[]).length;
          const snapshots = await backpackRef.listSnapshots(o.name);
          snapshotCount += (snapshots as any[]).length;
        } catch { /* storage may not support branches */ }
      }
    } catch {
      // Can't gather stats — skip
    }
  }

  return {
    event,
    machineId: machineId!,
    sessionId,
    timestamp: new Date().toISOString(),
    properties: {
      durationMs: Date.now() - sessionStartTime,
      toolCalls,
      totalToolCalls: Object.values(toolCalls).reduce((a, b) => a + b, 0),
      ontologyCount,
      totalNodes,
      totalEdges,
      branchCount,
      snapshotCount,
      nodeVersion: process.version,
      os: os.platform(),
      arch: os.arch(),
      backpackVersion: VERSION,
    },
  };
}

/** Initialize telemetry. Call once at server startup. */
export async function initTelemetry(backpack?: Backpack): Promise<void> {
  try {
    if (await isDisabled()) return;

    backpackRef = backpack ?? null;
    await getMachineId();
    initialized = true;

    // Register shutdown + heartbeat first — these must always be set up,
    // even if the session_start send below fails.
    process.on("SIGTERM", () => shutdown().catch(() => {}));
    process.on("SIGINT", () => shutdown().catch(() => {}));

    heartbeatTimer = setInterval(async () => {
      try {
        const heartbeat = await buildSnapshot("session_heartbeat");
        await sendEvents([heartbeat]);
      } catch {
        // Silently ignore heartbeat failures
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref(); // Don't keep the process alive for heartbeats

    // Send session_start (sendEvents never throws, so this is safe)
    const startEvent = await buildSnapshot("session_start");
    await sendEvents([startEvent]);
  } catch {
    // Telemetry init failed — continue silently
  }
}

/** Track a tool call. Synchronous — never throws, never blocks. */
export function trackEvent(
  event: string,
  properties: Record<string, unknown> = {}
): void {
  try {
    if (disabled || !initialized) return;
    if (event === "tool_call") {
      const tool = (properties.tool as string) ?? "unknown";
      toolCalls[tool] = (toolCalls[tool] ?? 0) + 1;
    }
    // Individual events are no longer sent — aggregated at shutdown
  } catch {
    // Silently ignore
  }
}

/** Gather final stats and send one aggregated event. Call on server shutdown. */
export async function shutdown(): Promise<void> {
  try {
    if (disabled || !initialized || shutdownCalled) return;
    shutdownCalled = true;

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    const summary = await buildSnapshot("session_end");
    await sendEvents([summary]);
  } catch {
    // Silently ignore
  }
}
