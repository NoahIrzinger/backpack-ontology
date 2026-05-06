import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Backpack } from "../core/backpack.js";
import { RemoteRegistry } from "../core/remote-registry.js";
import { JsonFileBackend } from "../storage/json-file-backend.js";
import { BackpackAppBackend } from "../storage/backpack-app-backend.js";
import { initTelemetry } from "../core/telemetry.js";
import { PACKAGE_VERSION } from "../core/version.js";
import { registerOntologyTools, registerDiscoveryAuditTool } from "./tools/ontology-tools.js";
import { registerNodeTools } from "./tools/node-tools.js";
import { registerEdgeTools } from "./tools/edge-tools.js";
import { registerBulkTools } from "./tools/bulk-tools.js";
import { registerVersionTools } from "./tools/version-tools.js";
import { registerIntelligenceTools } from "./tools/intelligence-tools.js";
import { registerRemoteTools } from "./tools/remote-tools.js";
import { registerBackpackTools } from "./tools/backpack-tools.js";
import { registerKBTools } from "./tools/kb-tools.js";
import { registerSignalTools } from "./tools/signal-tools.js";
import { registerMoveTools } from "./tools/move-tools.js";
import { registerServerInfoTools } from "./tools/server-info-tools.js";
import { registerViewerStateResource } from "./viewer-state-resource.js";

/** Configuration for local file-based storage. */
export interface BackpackLocalConfig {
  mode: "local";
  dataDir?: string;
}

/** Configuration for Backpack App via static bearer token. */
export interface BackpackAppConfig {
  mode: "app";
  url: string;
  token: string;
}

export type BackpackServerConfig = BackpackLocalConfig | BackpackAppConfig;

/**
 * Create and configure the MCP server.
 *
 * Supports two modes:
 *   - "local" (default): JSON files on disk
 *   - "app": thin client for Backpack App via static bearer token
 */
export async function createMcpServer(
  config?: BackpackServerConfig
): Promise<McpServer> {
  let backpack: Backpack;

  if (!config || config.mode === "local") {
    // Local mode resolves the active backpack from the registry. First
    // run seeds a default "personal" entry pointing at the user's
    // existing graphs directory, so upgrades from 0.3.x are transparent.
    // A custom `config.dataDir` is honored only when explicitly passed,
    // mostly used by tests. Normal users go through the registry.
    if (config?.dataDir) {
      backpack = new Backpack(new JsonFileBackend(config.dataDir));
    } else {
      backpack = await Backpack.fromActiveBackpack();
    }
  } else {
    backpack = new Backpack(new BackpackAppBackend(config.url, config.token));
  }

  await backpack.initialize();

  // Initialize telemetry (non-blocking, fails silently)
  try {
    await initTelemetry(backpack);
  } catch {
    /* noop */
  }

  const server = new McpServer(
    {
      name: "backpack",
      version: PACKAGE_VERSION,
    },
    {
      instructions: `Backpack is the user's persistent knowledge base that carries what matters across conversations. Think of it as a single backpack the user carries everywhere — inside it are learning graphs, each one about a different topic (clients, processes, architecture, etc.).

There is one backpack. Inside it are learning graphs. Each learning graph contains nodes (things) connected by edges (relationships). Use backpack_list to see what's in the backpack, and backpack_describe to understand a graph's structure before adding to it. Create a new learning graph when the topic is distinct from existing ones.

Viewer links: when the user asks to see a graph, show a graph, or wants a link, construct a clickable URL.
- Graph link: http://localhost:5173#graph-name
- Graph with focused nodes: http://localhost:5173#graph-name?node=nodeId1,nodeId2
Always provide these as clickable markdown links, e.g. [View graph](http://localhost:5173#my-graph)
If the viewer isn't running, tell the user to start it with: npx backpack-viewer

After updating a learning graph, include a link to view it.

Be selective — not every conversation needs to be captured. Focus on knowledge with lasting value: relationships, decisions, architecture, processes, domain concepts, conventions.

Signals: after running backpack_signal_detect, automatically enrich the HIGH and MEDIUM signals by rewriting their descriptions with contextual intelligence. Use the evidence node labels, properties, and your knowledge of the graphs/KBs to explain WHY each signal matters and what the user should consider doing. Then call backpack_signal_enrich with the enriched descriptions to persist them. This makes signals actionable instead of diagnostic.`,
    }
  );

  const remoteRegistry = new RemoteRegistry(
    config && config.mode === "local" ? config.dataDir : undefined,
  );
  await remoteRegistry.initialize();

  // Register all tool groups
  registerServerInfoTools(server, { mode: config?.mode ?? "local" });
  registerOntologyTools(server, backpack);
  registerDiscoveryAuditTool(server);
  registerNodeTools(server, backpack);
  registerEdgeTools(server, backpack);
  registerBulkTools(server, backpack);
  registerVersionTools(server, backpack);
  registerIntelligenceTools(server, backpack);
  registerRemoteTools(server, backpack, remoteRegistry);
  if (!config || config.mode === "local") {
    registerBackpackTools(server, backpack);
    registerKBTools(server, backpack);
    registerSignalTools(server, backpack);
    registerMoveTools(server, backpack);
  }

  // Viewer-state bridge exposes the local viewer's current selection,
  // focus, and active graph as an MCP resource so any MCP client can ask
  // "what is the user looking at?" without re-typing context. Local mode
  // only; app mode has no local viewer process.
  if (!config || config.mode === "local") {
    registerViewerStateResource(server);
  }

  return server;
}
