# Backpack

A persistent ontology engine for Claude Code. Gives your AI a structured, searchable knowledge graph it can build up over time — via MCP.

The key design principle is **progressive discovery**: Backpack never dumps an entire knowledge graph into your context window. Instead, Claude browses the graph layer by layer — listing ontologies, inspecting node types, drilling into specific nodes, and traversing relationships — only pulling in what it needs.

## Quick Start

### Install

```bash
npm install -g backpack-ontology
```

### Connect to Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "backpack": {
      "command": "npx",
      "args": ["backpack-ontology"]
    }
  }
}
```

Or add globally:

```bash
claude mcp add backpack -- npx backpack-ontology
```

Restart Claude Code. That's it.

### Use It

Tell Claude to put something in the backpack:

> "Create an ontology about our codebase architecture"

> "Put a cooking ontology in the backpack with recipes and ingredients"

> "Search the backpack for anything related to authentication"

Claude will use the backpack tools to create ontologies, add nodes and edges, search, and traverse the knowledge graph — all without flooding your context window.

## How It Works

Backpack stores knowledge as **typed graphs**: nodes (entities) connected by edges (relationships).

```
[Ingredient: garlic] --USED_IN--> [Recipe: Aglio e Olio]
[Ingredient: olive oil] --USED_IN--> [Recipe: Aglio e Olio]
[Recipe: Aglio e Olio] --CUISINE--> [Cuisine: Italian]
```

There are no enforced schemas. Node types and property keys are freeform — the LLM decides what structure makes sense for the domain. Progressive discovery derives structure from actual data: "what types exist?" scans real nodes, not a predefined schema.

### Progressive Discovery

Tools are organized in layers, from broad to specific:

| Layer | Tools | What You Get |
|-------|-------|-------------|
| **Discover** | `backpack_list`, `backpack_create`, `backpack_describe` | Ontology names, descriptions, type counts |
| **Browse** | `backpack_list_nodes`, `backpack_node_types`, `backpack_search` | Paginated node summaries (id, type, label) |
| **Inspect** | `backpack_get_node`, `backpack_get_neighbors` | Full node data, graph traversal |
| **Mutate** | `backpack_add_node`, `backpack_update_node`, `backpack_add_edge`, ... | Create and modify data |

Claude starts at the top and drills down. A `backpack_list` call returns a few lines. A `backpack_get_node` returns one node. The context window stays clean.

## Tools Reference

### Discovery

| Tool | Description |
|------|-------------|
| `backpack_list` | List all ontologies with names, descriptions, and summary counts |
| `backpack_create` | Create a new empty ontology |
| `backpack_delete` | Permanently delete an ontology and all its data |
| `backpack_describe` | Get ontology structure: node types, edge types, counts (no instance data) |

### Browsing

| Tool | Description |
|------|-------------|
| `backpack_node_types` | List distinct node types with counts |
| `backpack_list_nodes` | Paginated node summaries, optionally filtered by type |
| `backpack_search` | Case-insensitive text search across all node properties |

### Inspection

| Tool | Description |
|------|-------------|
| `backpack_get_node` | Full node with all properties + connected edge summaries |
| `backpack_get_neighbors` | BFS graph traversal from a node (max depth 3) |

### Mutation

| Tool | Description |
|------|-------------|
| `backpack_add_node` | Add a node with freeform type and properties |
| `backpack_update_node` | Merge new properties into an existing node |
| `backpack_remove_node` | Remove a node and cascade-delete its edges |
| `backpack_add_edge` | Create a typed relationship between two nodes |
| `backpack_remove_edge` | Remove a relationship |
| `backpack_import_nodes` | Bulk-add multiple nodes at once |

## Data Storage

Backpack follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/):

```
~/.config/backpack/              # Configuration
└── config.json                  # Optional config overrides

~/.local/share/backpack/         # Data
└── ontologies/
    ├── cooking/
    │   └── ontology.json        # One file per ontology
    └── codebase-arch/
        └── ontology.json
```

Ontology files are human-readable JSON. You can inspect, edit, back up, or version-control them directly.

### Environment Variables

| Variable | Effect |
|----------|--------|
| `XDG_CONFIG_HOME` | Override config location (default: `~/.config`) |
| `XDG_DATA_HOME` | Override data location (default: `~/.local/share`) |
| `BACKPACK_DIR` | Override everything — config goes to `$BACKPACK_DIR/config`, data to `$BACKPACK_DIR/data` |

### Config File

`~/.config/backpack/config.json` (optional):

```json
{
  "dataDir": "/custom/path/to/ontologies"
}
```

## Architecture

Backpack has clean separation of concerns:

```
┌─────────────────────────────────────────┐
│  MCP Layer (src/mcp/)                   │  Thin adapter — registers tools,
│  16 tools organized by discovery layer  │  delegates to Backpack API
├─────────────────────────────────────────┤
│  Backpack API (src/core/backpack.ts)    │  Business logic — composes
│  The single entry point for all ops     │  Graph + StorageBackend
├─────────────┬───────────────────────────┤
│  Graph      │  StorageBackend           │
│  In-memory  │  (pluggable interface)    │
│  operations │       │                   │
│             │  JsonFileBackend          │  Default: JSON on disk
│             │  (future: SQLite)         │
│             │  (future: Remote API)     │
└─────────────┴───────────────────────────┘
```

The core engine (`src/core/`) has zero knowledge of MCP. You can use it programmatically:

```typescript
import { Backpack, JsonFileBackend } from "backpack-ontology";

const backpack = new Backpack(new JsonFileBackend());
await backpack.initialize();

await backpack.createOntology("my-graph", "A knowledge graph");
await backpack.addNode("my-graph", "Person", { name: "Alice" });
```

### Pluggable Storage

The `StorageBackend` interface lets you swap storage without touching any other code:

```typescript
import { Backpack, StorageBackend } from "backpack-ontology";

class MyCustomBackend implements StorageBackend {
  // Implement: initialize, listOntologies, loadOntology,
  // saveOntology, createOntology, deleteOntology, ontologyExists
}

const backpack = new Backpack(new MyCustomBackend());
```

## Development

```bash
git clone https://github.com/noahirzinger/backpack.git
cd backpack
npm install
npm run build        # Compile TypeScript
npm test             # Run all tests (40 tests)
npm run dev          # Run MCP server in dev mode (via tsx)
```

### Project Structure

```
src/
├── core/                        # Pure engine — no MCP
│   ├── types.ts                 # All interfaces (Node, Edge, StorageBackend, etc.)
│   ├── graph.ts                 # In-memory graph operations
│   ├── backpack.ts              # Public API composing Graph + Storage
│   ├── paths.ts                 # XDG directory resolution
│   ├── config.ts                # Config loading
│   └── ids.ts                   # Prefixed nanoid generation
├── storage/
│   └── json-file-backend.ts     # Default storage: JSON files on disk
├── mcp/
│   ├── server.ts                # MCP server factory
│   └── tools/                   # Tool registrations (ontology, node, edge, bulk)
├── index.ts                     # Library exports
└── bin/
    └── backpack.ts              # CLI entry point
```

## License

[Apache 2.0](./LICENSE) — use it freely, build on it, contribute back.

## Contributing

Issues and PRs welcome. If you build something cool with Backpack, let us know.
