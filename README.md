# Backpack Ontology

A persistent knowledge graph engine for Claude Code, delivered as an MCP server. Backpack gives AI agents structured, searchable memory that persists across sessions.

## Installation

```bash
npm install -g backpack-ontology
```

## Setup

Add Backpack to your Claude Code project (`.mcp.json`):

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

Or register it globally:

```bash
claude mcp add backpack -- npx backpack-ontology
```

Restart Claude Code to activate.

## Usage

Backpack organizes knowledge as typed graphs — nodes (entities) connected by edges (relationships). There are no enforced schemas. The LLM decides what structure fits the domain.

```
[Ingredient: garlic] --USED_IN--> [Recipe: Aglio e Olio]
[Module: auth]       --DEPENDS_ON--> [Module: database]
```

Tell Claude what to store:

> "Create an ontology about our codebase architecture"

> "Search the backpack for anything related to authentication"

> "Add the deployment pipeline to the infrastructure ontology"

### Progressive Discovery

Tools are organized in layers so the context window stays clean. Claude starts broad and drills down — only pulling in what it needs.

| Layer | Tools | Returns |
|-------|-------|---------|
| **Discover** | `backpack_list`, `backpack_create`, `backpack_describe` | Ontology names, descriptions, type counts |
| **Browse** | `backpack_list_nodes`, `backpack_node_types`, `backpack_search` | Paginated node summaries (id, type, label) |
| **Inspect** | `backpack_get_node`, `backpack_get_neighbors` | Full node data, graph traversal |
| **Mutate** | `backpack_add_node`, `backpack_update_node`, `backpack_add_edge`, ... | Create and modify data |

## Tools Reference

### Discovery

| Tool | Description |
|------|-------------|
| `backpack_list` | List all ontologies with names, descriptions, and summary counts |
| `backpack_create` | Create a new empty ontology |
| `backpack_delete` | Permanently delete an ontology and all its data |
| `backpack_describe` | Inspect ontology structure: node types, edge types, counts |

### Browsing

| Tool | Description |
|------|-------------|
| `backpack_node_types` | List distinct node types with counts |
| `backpack_list_nodes` | Paginated node summaries, optionally filtered by type |
| `backpack_search` | Case-insensitive text search across all node properties |

### Inspection

| Tool | Description |
|------|-------------|
| `backpack_get_node` | Full node with all properties and connected edge summaries |
| `backpack_get_neighbors` | BFS graph traversal from a node (max depth 3) |

### Mutation

| Tool | Description |
|------|-------------|
| `backpack_add_node` | Add a node with a freeform type and properties |
| `backpack_update_node` | Merge new properties into an existing node |
| `backpack_remove_node` | Remove a node and cascade-delete its edges |
| `backpack_add_edge` | Create a typed relationship between two nodes |
| `backpack_remove_edge` | Remove a relationship |
| `backpack_import_nodes` | Bulk-add multiple nodes in a single operation |

## Programmatic API

The core engine has no MCP dependency and can be used as a library:

```typescript
import { Backpack, JsonFileBackend } from "backpack-ontology";

const backpack = new Backpack(new JsonFileBackend());
await backpack.initialize();

await backpack.createOntology("my-graph", "A knowledge graph");
const node = await backpack.addNode("my-graph", "Person", { name: "Alice" });
await backpack.addEdge("my-graph", "KNOWS", node.id, otherNodeId);
```

### Pluggable Storage

The `StorageBackend` interface allows custom persistence implementations:

```typescript
import { Backpack, StorageBackend } from "backpack-ontology";

class SqliteBackend implements StorageBackend {
  // initialize, listOntologies, loadOntology, saveOntology,
  // createOntology, deleteOntology, ontologyExists
}

const backpack = new Backpack(new SqliteBackend());
```

## Data Storage

Backpack follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/):

```
~/.local/share/backpack/ontologies/
├── cooking/
│   └── ontology.json
└── codebase-arch/
    └── ontology.json
```

Ontology files are human-readable JSON. They can be inspected, edited, backed up, or version-controlled directly.

| Variable | Effect |
|----------|--------|
| `XDG_DATA_HOME` | Override data location (default: `~/.local/share`) |
| `XDG_CONFIG_HOME` | Override config location (default: `~/.config`) |
| `BACKPACK_DIR` | Override both — config at `$BACKPACK_DIR/config`, data at `$BACKPACK_DIR/data` |

## Telemetry

Backpack collects anonymous usage telemetry to improve the product. No personal data, ontology content, or tool arguments are ever collected.

**What is collected:**
- Tool call counts (which tools are used, not what data is passed)
- Session duration
- Aggregate ontology statistics (total node/edge counts, not names or content)
- Runtime environment (Node.js version, OS, platform)

**What is never collected:**
- Ontology names, descriptions, or content
- Node or edge properties
- File paths or user identifiers
- Tool arguments or query strings

**To opt out**, use any of the following:

```bash
# Environment variable (standard)
export DO_NOT_TRACK=1

# Backpack-specific environment variable
export BACKPACK_TELEMETRY_DISABLED=1
```

Or add to `~/.config/backpack/config.json`:

```json
{
  "telemetry": false
}
```

## Visualization

Use [backpack-viewer](https://www.npmjs.com/package/backpack-viewer) to visualize ontologies in a web-based graph explorer with force-directed layout and live reload.

## Support

For questions, feedback, or sponsorship inquiries: **support@backpackontology.com**

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/noahirzinger/backpack-ontology).
