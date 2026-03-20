# Development Guide

## Prerequisites

- Node.js >= 18
- npm

## Setup

```bash
git clone https://github.com/noahirzinger/backpack-ontology.git
cd backpack-ontology
npm install
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run dev` | Start MCP server in dev mode (via tsx) |

## Project Structure

```
src/
├── core/                        # Pure engine — no MCP dependency
│   ├── types.ts                 # All interfaces (Node, Edge, StorageBackend, etc.)
│   ├── graph.ts                 # In-memory graph operations
│   ├── backpack.ts              # Public API — composes Graph + StorageBackend
│   ├── paths.ts                 # XDG directory resolution
│   ├── config.ts                # Configuration loading
│   └── ids.ts                   # Prefixed nanoid generation (n_ for nodes, e_ for edges)
├── storage/
│   └── json-file-backend.ts     # Default storage: JSON files on disk
├── mcp/
│   ├── server.ts                # MCP server factory
│   └── tools/                   # Tool registrations
│       ├── ontology-tools.ts    # Ontology lifecycle (create, list, delete, describe)
│       ├── node-tools.ts        # Node operations (add, get, search, update, remove)
│       ├── edge-tools.ts        # Edge operations (add, remove, get neighbors)
│       └── bulk-tools.ts        # Bulk operations (import nodes)
├── index.ts                     # Public library exports
└── bin/
    └── backpack.ts              # CLI entry point
```

## Architecture

The codebase has three layers:

1. **Core engine** (`src/core/`) — Pure data structures and graph operations. Zero knowledge of MCP. Fully testable in isolation.

2. **Storage** (`src/storage/`) — Pluggable persistence via the `StorageBackend` interface. The default `JsonFileBackend` writes human-readable JSON to disk following XDG conventions.

3. **MCP layer** (`src/mcp/`) — Thin adapter that registers 16 tools and delegates every call to the `Backpack` API. No business logic lives here.

## Testing

Tests are in `tests/` and use vitest. They cover the core engine, graph operations, and storage:

```bash
npm test                    # Run once
npm run test:watch          # Watch mode
```

Tests create temporary directories for storage and clean up after themselves.

## Releasing

```bash
# Bump version, create tag, push
npm run release:patch       # 0.1.3 → 0.1.4
npm run release:minor       # 0.1.3 → 0.2.0
npm run release:major       # 0.1.3 → 1.0.0
```

The `v*` tag triggers the GitHub Actions publish workflow, which validates the tag against `package.json`, runs the test matrix (Node 18/20/22), and publishes to npm.

## Telemetry

The MCP server includes anonymous usage telemetry (`src/core/telemetry.ts`). Key design decisions:

- **Self-contained module** — every function is wrapped in try/catch. Telemetry can never crash the server.
- **`trackEvent()` is synchronous** — just pushes to an in-memory queue. Never throws, never blocks.
- **Flush timer is `.unref()`'d** — won't keep the process alive.
- **Opt-out** is checked lazily on first init: `DO_NOT_TRACK=1`, `BACKPACK_TELEMETRY_DISABLED=1`, or `{"telemetry": false}` in config.
- **Machine ID** is a SHA-256 hash of hostname+platform, stored in `~/.config/backpack/machine-id`.
- **Endpoint** defaults to `localhost:3001` for dev. Set `BACKPACK_TELEMETRY_URL` for production.
- **VERSION constant** in `telemetry.ts` must be updated to match `package.json` on each release.

To test telemetry locally, run the diagnostics server from `../backpack-diagnostics`:

```bash
cd ../backpack-diagnostics && make dev
```

## Key Conventions

- ES modules throughout (`"type": "module"`)
- Strict TypeScript (`"strict": true`)
- Node types and properties are freeform — no schema enforcement
- Label extraction: first string value in `Object.values(node.properties)`, fallback to `node.id`
- All IDs are prefixed nanoids (`n_` for nodes, `e_` for edges)
