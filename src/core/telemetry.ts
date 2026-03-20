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
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const VERSION = "0.1.3";

interface TelemetryEvent {
  event: string;
  machineId: string;
  sessionId: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

// Module-level state
const sessionId = crypto.randomUUID();
const sessionStartTime = Date.now();
let machineId: string | null = null;
let eventQueue: TelemetryEvent[] = [];
let toolCallCount = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let disabled: boolean | null = null;
let backpackRef: Backpack | null = null;
let initialized = false;

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

function enqueue(event: string, properties: Record<string, unknown>): void {
  if (!machineId) return;

  eventQueue.push({
    event,
    machineId,
    sessionId,
    timestamp: new Date().toISOString(),
    properties,
  });
}

/** Initialize telemetry. Call once at server startup. */
export async function initTelemetry(backpack?: Backpack): Promise<void> {
  try {
    if (await isDisabled()) return;

    backpackRef = backpack ?? null;
    await getMachineId();
    initialized = true;

    enqueue("session_start", {
      nodeVersion: process.version,
      os: os.platform(),
      arch: os.arch(),
      backpackVersion: VERSION,
    });

    // Flush immediately so session_start is sent right away
    flush().catch(() => {});

    flushTimer = setInterval(() => {
      flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref();

    process.on("beforeExit", () => {
      shutdown().catch(() => {});
    });
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
    if (event === "tool_call") toolCallCount++;
    enqueue(event, properties);
  } catch {
    // Silently ignore
  }
}

/** Flush the event queue to the ingest endpoint. */
export async function flush(): Promise<void> {
  try {
    if (eventQueue.length === 0) return;

    const batch = eventQueue;
    eventQueue = [];

    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Failed to send — drop the batch
  }
}

/** Gather final stats and flush. Call on server shutdown. */
export async function shutdown(): Promise<void> {
  try {
    if (disabled || !initialized) return;

    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    // Gather aggregate ontology stats
    if (backpackRef) {
      try {
        const ontologies = await backpackRef.listOntologies();
        let totalNodes = 0;
        let totalEdges = 0;
        for (const o of ontologies) {
          totalNodes += o.nodeCount;
          totalEdges += o.edgeCount;
        }
        enqueue("ontology_stats", {
          ontologyCount: ontologies.length,
          totalNodes,
          totalEdges,
        });
      } catch {
        // Can't gather stats — skip
      }
    }

    enqueue("session_end", {
      durationMs: Date.now() - sessionStartTime,
      toolCalls: toolCallCount,
    });

    await flush();
  } catch {
    // Silently ignore
  }
}
