# Changelog

## 0.3.0 (unreleased)

This release is a substantial overhaul of the storage layer, the write
path, and the design center of Backpack. Existing 0.2.x graphs are
**migrated automatically on first start** — no manual command, no data
loss, no friction.

### Auto-migration
- The new event-sourced backend detects 0.2.x format graphs on
  `initialize()` and converts them in place: `meta.json` +
  `branches/<b>.json` → `metadata.json` + `branches/<b>/{events.jsonl,
  snapshot.json}`. Idempotent across restarts. Best-effort: if a graph
  fails to convert, the original files are left untouched.

### The three-role rule (design center)
There are three places an LLM can read knowledge from, and they should
never overlap:
- **CLAUDE.md** — environmental briefing, every session
- **Skills** — playbooks, loaded on demand
- **Backpack learning graphs** — discovered relational knowledge,
  queried as needed

This release leans into that rule everywhere:
- New `backpack_audit_roles` tool flags graph nodes that look procedural
  (should be a skill) or briefing-like (should be in CLAUDE.md).
- The skill guide opens with the rule and concrete examples.
- The new draft validator (see below) catches role-rule violations on
  write so they never get committed silently.

### Storage rebuilt as event-sourced
Graphs are now append-only event logs per branch with a materialized
snapshot cache. Branches, snapshots, and rollback are unified —
they're all views of the same event log:
- A branch is a fork of the event log.
- A snapshot is a labeled event in the log; its version is its position.
- Rollback truncates the log at a snapshot position and rebuilds the
  cache.
- Optimistic concurrency is built in (see "collaboration" below).
- Snapshot cache is regenerated automatically if missing or corrupt.
- The legacy 656-line monolithic backend is gone.

### Always-on draft validation
`backpack_import_nodes` now validates every batch before committing:
- **Errors block the commit:** broken edges, self-loops, invalid
  property shapes (nested objects, etc.).
- **Warnings come back in the response:** type drift (case- /
  separator-insensitive near-misses against existing types), duplicate
  nodes (same type + same label), three-role rule violations.
- **New `dryRun` parameter** runs the validator and returns the result
  without writing anything. Recommended for any batch over ~5 nodes.

`backpack_import_nodes` is now the preferred entry point for bulk
writes; single-node `backpack_add_node` is marked "avoid in normal
flows" in the skill guide.

### Type drift normalization
- New `backpack_normalize` MCP tool — detects clusters of equivalent
  type variants ("service" / "Service" / "SERVICE") and renames the
  non-canonical ones to the dominant variant. Works for both node types
  and edge types.
- **Defaults to dry-run** for safety. Pass `dryRun: false` explicitly
  to apply.
- Type renames preserve node IDs and all edges — safe to run on a
  connected graph. Backed by new `node.retype` and `edge.retype` event
  ops.

### Collaboration: optimistic concurrency + lock heartbeat
Two collaborators sharing a graph (via OneDrive, Dropbox, or any
network filesystem) no longer silently clobber each other:
- **Optimistic concurrency** — every read records the current event
  count; every write must match it. If someone else wrote in between,
  the second writer gets a `ConcurrencyError` and **no partial state is
  committed**. The cache is auto-invalidated, so the next read pulls
  fresh state.
- **Lock heartbeat** — every successful write touches a `.lock` file
  with the author and timestamp. New `backpack_lock_status` tool reads
  the current heartbeat. The viewer's sidebar shows an "editing:
  <author>" badge per graph when activity is fresh (within 5 minutes).
- **Friendly conflict messages** — when a write tool throws
  `ConcurrencyError`, the response surfaces the lock holder so the
  agent knows who they collided with, plus a clear "re-read, re-apply,
  retry" instruction.

### Health and visibility
- New `backpack_health` MCP tool — single call that runs connectivity
  audit, three-role audit, type drift detection, token count, and lock
  status in parallel. The "tell me how this graph is doing" tool.
- `backpack_describe` now includes `totalTokens` as a structured field
  so agents can react to graph size without an extra call.

### Bug fixes
- `backpack_extract` (subgraph extraction) was broken against the new
  backend — `saveOntology` requires the graph to exist first. Fixed via
  the existing `createOntologyFromData` two-step path.
- `listOntologies` returned `metadata.name` instead of the directory
  name, which broke `loadOntology` for any graph whose dir name had
  drifted from its metadata name (legacy rename inconsistency). Now
  uses the directory name as the canonical identifier.
- `Backpack.diffWithSnapshot` would have failed against the new backend
  due to a method name collision; the legacy `loadSnapshot(name,
  version)` signature is restored.

### Public API additions
- `EventSourcedBackend`, `ConcurrencyError`, `LOCK_FRESH_MS`, type
  `LockInfo`
- `Backpack.validateImport`, `planNormalization`, `applyNormalization`,
  `auditRoles`, `getLockInfo`
- New event types: `node.retype`, `edge.retype`

### Remote Graph Registry (carried over from previous unreleased work)
- New module: `RemoteRegistry` for subscribing to learning graphs hosted at
  HTTPS URLs. Stores subscriptions in `~/.local/share/backpack/remotes.json`
  with cached graph data in `~/.local/share/backpack/remote-cache/`.
- New module: `remoteFetch` — hardened HTTPS client with SSRF blocklist
  (IPv4 + IPv6 private ranges, AWS metadata, link-local, etc.), 10 MB size
  cap, 15 s total timeout, max 3 redirects with re-validation, DNS-rebinding
  resistant via single-resolution + IP-direct dispatch.
- New module: `validateRemoteGraph` — strict graph validator with size
  limits (50k nodes, 200k edges), prototype pollution defense, type-checked
  property values, drops orphan edges.
- New MCP tools: `backpack_remote_register`, `backpack_remote_list`,
  `backpack_remote_unregister`, `backpack_remote_refresh`,
  `backpack_remote_import`, `backpack_export`.
- New `Backpack.createOntologyFromData(name, data)` method for importing
  full graph payloads while preserving node and edge IDs.
- New `Backpack.ontologyExists(name)` and `Backpack.loadOntology(name)`
  passthrough methods.
- 83 tests covering schema validation, fetch hardening, registry CRUD,
  path traversal defense, and corrupted-registry recovery.
- Public API exports: `RemoteRegistry`, `remoteFetch`, `validateRemoteGraph`,
  associated error classes and types.

## 0.2.26 (2026-04-10)

### Hook cleanup
- Removed all hook auto-installation. Older versions auto-installed a Stop hook
  that ran a long-running agent on every conversation Stop event, causing
  multi-minute pauses for users. Orphaned entries lingered in `.claude/settings.json`
  even after the install code was removed.
- The MCP server now runs a silent cleanup pass on startup that removes any
  Backpack-originated hook entries (Stop and PostToolUse) from
  `.claude/settings.json`. Unrelated user hooks are left alone.
- `backpack-init` is now a cleanup command (was: installer). Run it explicitly
  if you don't want to wait for the next MCP startup.
- Removed `hooks/` directory from the npm package.

## 0.2.25 (2026-03-30)

### Intelligence Tools
- **`backpack_expand`** — expand a node with related entities in a direction
- **`backpack_explain_path`** — find shortest path between two nodes, returns context for semantic explanation
- **`backpack_enrich`** — deepen a node with additional properties and connections
- **`backpack_synthesize`** — build a graph from multiple sources in one workflow

### Graph Snippets
- **`backpack_save_snippet`** — save a named subgraph as a reusable snippet
- **`backpack_list_snippets`** — list saved snippets for a graph
- **`backpack_load_snippet`** — load a snippet's full data
- **`backpack_delete_snippet`** — remove a snippet
- Auto-detects edges between snippet nodes when edgeIds not specified

### Telemetry
- Branch and snapshot counts now included in heartbeat telemetry

## 0.2.21 (2026-03-27)

### Graph Versioning
- **Branches**: named variants of a learning graph — fork, switch, delete via MCP tools (`backpack_branch_create`, `backpack_branch_switch`, `backpack_branch_list`, `backpack_branch_delete`)
- **Snapshots**: save and restore graph state within a branch (`backpack_snapshot`, `backpack_versions`, `backpack_rollback`)
- **Diff**: compare current state with a snapshot (`backpack_diff`)
- **Directory restructure**: `ontologies/{name}/ontology.json` → `graphs/{name}/branches/main.json` with auto-migration on first startup

### Graph Intelligence
- **Enhanced `backpack_describe`**: now includes `stats` with orphan count, most/least connected nodes, avg connections, graph density, and type-pair connection counts
- **`backpack_connect`**: bulk-create edges between existing nodes in a single call
- **`backpack_audit`**: analyze a graph for quality issues — orphans, weak nodes, sparse types, disconnected type pairs, and actionable text suggestions

### Import Improvements
- **`backpack_import_nodes` now accepts edges**: import nodes and edges together atomically. Reference new nodes by array index (0, 1, 2...) or existing nodes by ID string.

### CI/CD
- Fixed npm publish to use OIDC Trusted Publishers instead of NPM_TOKEN

## 0.2.18 (2026-03-26)

- Initial public release with MCP server, 16 tools, JSON file storage, telemetry
