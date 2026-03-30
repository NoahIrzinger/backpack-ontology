# Changelog

## 0.2.25 (2026-03-30)

### Curiosity Engine
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
