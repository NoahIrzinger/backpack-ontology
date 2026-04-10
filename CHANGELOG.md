# Changelog

## Unreleased

### Three-Role Rule (core design principle)
- **`backpack_audit_roles`** MCP tool — scans a learning graph for nodes that
  violate the three-role rule. Flags procedural content (should be a skill)
  and briefing content (should be in CLAUDE.md). Heuristic-based and
  intentionally conservative — false positives erode user trust faster than
  false negatives erode the rule.
- New `Backpack.auditRoles(name)` method.
- New `src/core/role-audit.ts` module with detection heuristics for
  procedural content (type names, sequential property keys, "first ... then"
  phrasing, multiple imperative sentence starts) and briefing content (type
  names, "this project uses" phrases, absolute "always/never" rules, "we use"
  team conventions).
- 26 tests covering clean cases, procedural detection, briefing detection,
  summary counts, and false positive guards.

### Remote Graph Registry
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
