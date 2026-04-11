# Changelog

## 0.6.0 (2026-04-11)

### Extraction processors + quality pipeline
- **New `ProcessorPipeline`** (`src/core/processor-pipeline.ts`) runs extraction proposals through a stack of validators before they're persisted. Each processor returns typed `ProcessorIssue`s with severity, target, and recommendation.
- **Four bundled processors** in `src/core/processors/`:
  - `VaguenessFilter` — flags vague labels, vague properties, and generic edge types.
  - `DuplicateDetector` — catches proposed nodes that collide with existing graph entries.
  - `RelationshipThreshold` — scores proposed edges against a semantic/property/source rubric and rejects weak ones.
  - `RoleAuditValidator` — reuses `auditRoles()` to flag procedural (belongs in a Skill) and briefing (belongs in CLAUDE.md) content.
- **New `ProcessorIssue.kind`**: `"briefing_content"` added so briefing candidates are distinguishable from procedural ones in reports.

### New MCP intelligence tools
- `backpack_validate_extraction` — dry-run proposed nodes/edges through the processor pipeline before import, so callers can surface issues without touching the graph.
- `backpack_analyze_patterns` — frequency, dependency, and cost-driver detection across a graph.
- `backpack_synthesize_structured` — machine-readable synthesis output with degree stats, label extraction, and connection summaries.
- `backpack_priority_briefing` — ranked action surface for the most load-bearing nodes/edges in a graph.
- `backpack_discovery_audit` — coverage-gap analysis with next-step hints tied to expected source types.

### Telemetry
- Intelligence tools now record `responseTokens` so the tool token stats reflect actual output cost, not just input.
- New `toolTokenStats` aggregation exposed via telemetry internals.

### Draft warnings
- Draft phase now emits `missing_summary` and `summary_too_long` warnings so drafts can be iterated before being committed as real nodes.

### Recommendation formatter
- New `src/core/recommendation-formatter.ts` turns pipeline issues into user-facing recommendations with effort hints.

## 0.5.2 (2026-04-10)

### Friendly default author names (no more "unknown")
- **New `src/core/author-name.ts`** module with a docker-style
  deterministic name generator. When `BACKPACK_AUTHOR` is unset, the
  backend falls back to a stable two-word name derived from the
  machine's hostname + platform + arch — e.g. `cosmic-narwhal`,
  `brave-otter`, `zen-glacier`. Same machine always gets the same
  name, so lock heartbeats are consistent across restarts without
  needing a config file.
- `EventSourcedBackend`'s author field is now always a real string,
  never `undefined`. Event author attribution and lock heartbeat
  badges in the viewer now show `editing: cosmic-narwhal` instead of
  `editing: unknown` for users who haven't set `BACKPACK_AUTHOR`.
- Users who set `BACKPACK_AUTHOR` explicitly get that value, same as
  before. The generator is strictly a fallback.
- 2500 possible combinations (50 adjectives × 50 nouns). Word lists
  are SFW, positive, visually distinctive, and avoid naming specific
  real people to sidestep cultural sensitivity.
- New public API exports: `generateAuthorName()` and
  `resolveAuthorName(explicit?)`.
- 9 new tests. Total: **359 tests passing**.

## 0.5.1 (2026-04-10)

### Docs
- **Fixed `npx backpack-viewer` cache trap in the CLI reference.** The
  README instructed users to run `npx backpack-viewer` without the
  `@latest` suffix. Without it, npx silently reuses a cached older
  install of the viewer from `_npx/<hash>/` and users don't see new
  viewer releases until the cache expires. The corrected command is
  `npx backpack-viewer@latest`, which forces npx to re-resolve from
  the npm registry on every invocation. The plugin skill has the
  same fix in `backpack-ontology-plugin@0.4.1`, which is what Claude
  actually reads when asked to open the viewer.
- Users stuck on an old viewer version can unblock themselves
  immediately with `npm cache clean --force && npx backpack-viewer@latest`.

## 0.5.0 (2026-04-10)

**Breaking change to the backpacks registry config format.** Zero-touch
auto-migration from 0.4.0 on first load — users who just installed 0.4.0
and hand-registered backpacks will see their paths carried forward
automatically. No manual steps.

### Simpler backpacks config
- Old format (v1): `{ version: 1, backpacks: [{ name, path, color }] }`
  plus a separate `active.json` file.
- New format (v2): `{ version: 2, paths: [...], active: "path" }` in
  a single file at `~/.config/backpack/backpacks.json`. Display names
  and colors are no longer stored — they're derived from the path on
  every read.
- **Name derivation:** last path segment becomes the display name.
  `/Users/me/OneDrive/work` → `work`. The default personal graphs
  directory is special-cased to show as `personal`. Collisions get
  `-2`, `-3` suffixes in registration order.
- **Color derivation:** stable hash of the path string. Same path
  always gets the same color.
- The file is easier to hand-edit — it's literally just a list of
  paths plus an active pointer.

### Simpler MCP tool signatures
- **`backpack_register`** drops the `name` parameter. Takes only
  `path` (and optional `activate: true`). The display name is
  derived from the path; no manual naming required.
- **`backpack_switch`** and **`backpack_unregister`** now accept
  either the derived display name OR the absolute path.
- **`BACKPACK_ACTIVE`** env var also accepts either a name or a path.

### Auto-migration
- On first load after upgrade, the registry detects the v1 format and
  rewrites it as v2 in place. The old separate `active.json` file is
  read for the active name and then removed. No data loss, no manual
  intervention, no change to graphs or events.
- Migration runs once; subsequent loads see the v2 format and skip.
- Garbage or corrupted config files are replaced with a fresh seeded
  registry (same behavior as first run).

### Public API changes
- `BackpackEntry` shape unchanged — `{ path, name, color }` — but
  `name` and `color` are now computed on the fly from `path`, not
  stored.
- `colorForName(name)` removed; replaced by **`colorForPath(path)`**.
- New export: **`deriveName(path, allPaths)`** — pure function that
  returns the display name a given path would show as in the context
  of the full registry (handles the personal special case and
  collision suffixes).
- `registerBackpack(name, path)` → **`registerBackpack(path)`**
  (breaking signature change).
- `unregisterBackpack(name)` → **`unregisterBackpack(pathOrName)`**
  (accepts either; backward-compatible for callers who pass the name).
- `setActiveBackpack(name)` → **`setActiveBackpack(pathOrName)`**
  (same).
- `getBackpack(name)` → **`getBackpack(pathOrName)`**.

### Tests
- Registry test suite rewritten for the new format. 38 tests covering
  derivation, collision suffixes, seeding, registration idempotency,
  path vs name lookup, env var override by path AND name, tilde
  expansion, v1 → v2 migration with and without legacy active.json,
  garbage file handling, Backpack class switching by name and path.
- Total: **350 tests passing** (up from 337).

## 0.4.0 (2026-04-10)

This release adds **multiple backpacks** — a meta-layer on top of
learning graphs that lets a user register several graph directories
(personal, a shared OneDrive folder, a project-specific folder, etc)
and switch between them. Only one backpack is active at a time; all
reads and writes go to the active one.

### Multiple backpacks
- **Register a directory as a named backpack**, keep per-user config
  (machine ID, telemetry, remote cache) separate from graphs. The
  common use case: share a graphs folder with a colleague via OneDrive
  without sharing anything else.
- **First-run seeding.** The registry automatically seeds a
  `personal` backpack on first load, pointing at the user's existing
  graphs directory. Users upgrading from 0.3.x see no change — their
  graphs are wrapped in the new `personal` entry and life continues.
- **Auto-generated colors.** Each backpack gets a deterministic color
  derived from its name (no UI burden for color picking). The viewer
  uses the color for the active indicator.
- **Env var override.** `BACKPACK_ACTIVE=<name>` overrides the
  persisted active backpack for a single session — useful for running
  two Claude Code windows against different backpacks from different
  shells.

### New MCP tools
- `backpack_register <name> <path>` — register a pointer to a graphs
  directory (creates the directory if it doesn't exist). Optional
  `activate: true` switches immediately.
- `backpack_switch <name>` — make a registered backpack active. Tears
  down the in-memory cache and rebuilds the storage backend at the new
  path, running auto-migration on legacy-format graphs found there.
- `backpack_active` — returns the currently active backpack.
- `backpack_registered` — lists every registered backpack, marking the
  active one.
- `backpack_unregister <name>` — removes a pointer. Refuses to unregister
  the last remaining backpack. If the removed backpack was active, falls
  back to the first remaining.

### Surface in responses
- `backpack_list` and `backpack_describe` responses now include an
  `activeBackpack` field at the top of the payload (name + path) so
  the agent sees the current context on every call. The skill guide
  teaches the agent to name the backpack when reporting actions
  ("Added X to the **work** backpack's Y graph").

### New public API
- `loadRegistry`, `listBackpacks`, `getBackpack`, `registerBackpack`,
  `unregisterBackpack`, `getActiveBackpack`, `setActiveBackpack`,
  `colorForName`, `BackpackRegistryError`, type `BackpackEntry`.
- `Backpack.fromActiveBackpack()` — factory that constructs a Backpack
  instance from the current active registry entry, the recommended
  entry point for new local-mode integrations.
- `Backpack.switchBackpack(name)` — instance method that swaps the
  underlying storage backend and clears caches.
- `Backpack.getActiveBackpackEntry()` — introspection.
- `EventSourcedBackendOptions.graphsDirOverride` — constructor option
  for pointing the backend at an arbitrary graphs directory (used by
  the registry to wire each backpack to its own path).

### Backend wiring
- Local-mode MCP server now uses `Backpack.fromActiveBackpack()` on
  startup instead of constructing a default backend, so the active
  registry state drives the session from the first call.
- Cloud-mode (`backpack-app` via SSE) is unchanged — the registry is
  a local-only concept for now.

### Tests
- **25 new registry tests:** color determinism, seeding, registration
  validation, duplicate rejection, active persistence, env var
  override, unregistration (including last-remaining guard and
  auto-switch), Backpack class switching, cross-backpack isolation.
- Total: **337 tests passing**.

## 0.3.2 (2026-04-10)

### Docs
- **Fixed plugin install command in README.** The 0.3.1 README told Claude
  Code users to run `/plugin install backpack-ontology-plugin@...` which
  would fail because the plugin's name (from `plugin.json`) is
  `backpack-ontology`, not `backpack-ontology-plugin`. Corrected to
  `/plugin install backpack-ontology@NoahIrzinger-backpack-ontology-plugin`.

## 0.3.1 (2026-04-10)

### Docs
- **README now recommends the Claude Code plugin** as the primary install
  path for Claude Code users. The plugin bundles this MCP server with two
  skills (`backpack-guide` and `backpack-mine`) — without it, Claude Code
  users get the tools but not the guidance on how to use them.
- Manual `claude mcp add backpack-local` install is still documented for
  advanced users and other MCP clients (Cursor, Zed, Continue, etc).
- Fixed stale storage path in the data & privacy section
  (`~/.local/share/backpack/ontologies/` → current event-sourced layout).
- Tools reference table updated with audit, normalize, health, snapshot,
  rollback, branch, and lock-status tool categories that landed in 0.3.0.

## 0.3.0 (2026-04-10)

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
