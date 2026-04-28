# Backpack

**Carry your knowledge forward.**

LLMs are incredible at reasoning but have zero memory of your world. Every new conversation starts from scratch — you repeat clients, projects, decisions, and preferences over and over.

Backpack fixes that. It gives your AI a persistent, structured knowledge base that carries forward across every session.

![Backpack graph viewer demo](docs/assets/demo.gif)

## What it does

Tell your AI something once, and it remembers — next conversation, next week, next month.

```
You: "We just signed Acme Corp, they're on the Enterprise tier, main contact is Sarah Chen"

Claude: [saves to backpack → clients learning graph]

--- weeks later, different conversation ---

You: "What do we know about Acme Corp?"

Claude: "Acme Corp is on the Enterprise tier, main contact is Sarah Chen..."
```

No copy-pasting. No re-explaining. Your knowledge carries forward.

## The graph viewer

An interactive canvas where you can actually see and explore your knowledge base.

![Backpack explore demo](docs/assets/explore.gif)

- Force-directed layout with live updates as you add knowledge
- Click nodes to explore relationships, properties, and connections
- Focus mode to zoom into a subgraph, walk mode to trace paths between ideas
- Type hulls group related things visually
- Vim-style keyboard navigation, undo/redo, search

This is where human understanding meets AI-generated knowledge — turning structured data into something you can see, navigate, and build on.

[Backpack Viewer repo](https://github.com/NoahIrzinger/backpack-viewer)

## Get started

### Recommended: Backpack App (free cloud account)

Sign up for a free account at [app.backpackontology.com](https://app.backpackontology.com), then add Backpack to Claude Code:

```bash
claude mcp add backpack-app -s user --transport sse https://app.backpackontology.com/mcp/sse
```

Your knowledge syncs across devices, you can share with your team, and you get access to the web-based graph visualizer. On first run, a browser window opens for sign-in. After that, it's automatic.

### Backpack Local (offline, private)

Prefer to keep everything on your machine? No account needed.

**If you're using Claude Code, install the plugin** — it bundles this MCP server together with two usage skills that teach Claude how to build and query learning graphs, including an autonomous mining loop for growing a graph from web sources:

```
/plugin marketplace add NoahIrzinger/backpack-ontology-plugin
/plugin install backpack-ontology@NoahIrzinger-backpack-ontology-plugin
```

Restart Claude Code (or run `/reload-plugins`) and you're ready. Plugin repo: [backpack-ontology-plugin](https://github.com/NoahIrzinger/backpack-ontology-plugin).

**Without the plugin (advanced, or other MCP clients):**

```bash
claude mcp add backpack-local -s user -- npx backpack-ontology@latest
```

This installs the MCP server directly but without the skills. You'll have the tools but not the guidance on how Claude should use them — the plugin is recommended unless you have a specific reason to skip it.

You can always move to Backpack App later by telling Claude "sync my backpack to the cloud".

### Works with other AI tools

Backpack works with any tool that supports MCP. Here's how to set it up:

<details>
<summary><strong>Cursor</strong></summary>

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "backpack": {
      "command": "npx",
      "args": ["backpack-ontology@latest"]
    }
  }
}
```

Or configure through Cursor Settings > MCP.
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "backpack": {
      "command": "npx",
      "args": ["backpack-ontology@latest"]
    }
  }
}
```
</details>

<details>
<summary><strong>OpenAI Codex CLI</strong></summary>

```bash
codex mcp add backpack -- npx backpack-ontology@latest
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.backpack]
command = "npx"
args = ["backpack-ontology@latest"]
```
</details>

<details>
<summary><strong>Cline (VS Code)</strong></summary>

Click the MCP Servers icon in Cline's top bar, then add:

```json
{
  "mcpServers": {
    "backpack": {
      "command": "npx",
      "args": ["backpack-ontology@latest"]
    }
  }
}
```
</details>

<details>
<summary><strong>Continue.dev</strong></summary>

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: backpack
    command: npx
    args:
      - "backpack-ontology@latest"
```
</details>

<details>
<summary><strong>Zed</strong></summary>

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "backpack": {
      "command": "npx",
      "args": ["backpack-ontology@latest"]
    }
  }
}
```

Note: Zed uses `context_servers`, not `mcpServers`.
</details>

### Switching from Backpack Local to Backpack App

Already using Backpack Local and want to move to the cloud? One command uploads everything:

> "Sync my backpack to the cloud"

Then add the cloud MCP server and you're done.

## What to say to Claude

No commands to learn. Just talk naturally.

### Remember something

> "Remember that Acme Corp is on the Enterprise tier, main contact is Sarah Chen"

> "Add our new vendor agreement details to backpack"

> "Start a learning graph for our hiring process"

### Find something

> "What's in my backpack about Acme Corp?"

> "Search backpack for anything related to compliance"

> "What do we know about the deployment process?"

### See the big picture

> "Show me my learning graph"

> "What's in my backpack?"

> "Describe the clients graph"

Claude will open the graph visualizer so you can explore your knowledge visually.

## Knowledge base

Each backpack includes a document-oriented knowledge base alongside its learning graphs. KB documents are markdown files stored per-mount, with support for multiple mount points (local directories, cloud, or extension-provided).

- **KB mounts** — register directories as document sources (`backpack_kb_mount`), list active mounts (`backpack_kb_mounts`)
- **Document management** — save, list, read, delete, and search documents across mounts (`backpack_kb_save`, `backpack_kb_list`, `backpack_kb_read`, `backpack_kb_delete`, `backpack_kb_search`)
- **Graph-to-KB ingest** — synthesize graph knowledge into KB documents (`backpack_kb_ingest`)

Say to Claude:

> "Save a document about our deployment process to the knowledge base"

> "Search the KB for anything about compliance"

## Cloud sync

Connect your local backpack to BackpackApp cloud for cross-device access and sharing.

- **CloudCacheBackend** — write-through cache that stores graphs locally and syncs to the cloud. Used by the viewer for seamless switching between local and cloud backpacks.
- **Cloud tools** — sign in (`backpack_cloud_login`), list cloud graphs (`backpack_cloud_list`), search across them (`backpack_cloud_search`), and import to local (`backpack_cloud_import`)

Say to Claude:

> "Sign in to Backpack cloud"

> "What graphs do I have in the cloud?"

> "Import the clients graph from cloud"

## What people use it for

- **Client management**: keep track of accounts, contacts, contract details, and conversations across sessions
- **Process documentation**: capture how things are done so Claude can help consistently every time
- **Project knowledge**: architecture decisions, vendor relationships, compliance requirements
- **Domain expertise**: industry terminology, regulatory frameworks, best practices
- **Team onboarding**: new team members get Claude with your organization's context already loaded

## How it works

You have one backpack. It goes everywhere with you. Inside it, you organize knowledge into **learning graphs**, each covering a different topic (clients, processes, compliance, etc.). Within each graph, information is stored as things connected by relationships. You don't need to think about the structure. Claude handles it automatically.

## Token efficiency

Backpack uses progressive disclosure — it never loads the full graph into context. Each tool returns only what's needed.

Here's what a typical interaction looks like against a real 81-node graph (~12,000 tokens if loaded raw):

| What the AI does | Tokens returned | % of full graph |
|---|---|---|
| Describe structure | ~2,478 | 20% |
| Search for a topic (17 results) | ~429 | 3% |
| Get one node's full details | ~154 | 1% |

A describe → search → get_node interaction uses **~3,000 tokens** instead of ~12,000. For smaller graphs (13 nodes, ~1,700 tokens), the savings are smaller because the metadata is a larger fraction of total data.

Results vary by graph size and operation. Node lookups and searches consistently use under 5% of the full graph. Describe uses 20–67% depending on graph size. Run the benchmark on your own graphs:

```bash
npx -p backpack-ontology@latest backpack-benchmark
```

Across sessions, the real value is that the graph exists at all. It's built once and queried forever — every future conversation uses structured lookups instead of re-explaining context from scratch.

## Source metadata (automatic)

Every node extracted from an external source — email, JIRA, web page, document — automatically carries metadata that points back to where it came from. This enables traceability and staleness detection.

When Claude mines or extracts data, it attaches four properties to every node:

```json
{
  "id": "n_vendor_abc",
  "type": "Vendor",
  "properties": {
    "name": "ABC Maintenance",
    
    // Automatic source metadata
    "source": "email:outlook/thread-xyz789",
    "source_type": "email",
    "source_date": "2026-04-10T14:22:00Z",
    "source_reference": "Subject: Vendor consolidation plan"
  }
}
```

| Field | What it is | Example |
|---|---|---|
| `source` | Pointer to original data | `https://example.com/team`, `email:outlook/thread-123`, `jira:myproject/ISSUE-42` |
| `source_type` | System that owns this data | `web`, `email`, `jira`, `slack`, `document` |
| `source_date` | When the data was created/modified | ISO 8601 timestamp |
| `source_reference` | Human-readable context | `"Team page"`, `"Subject: Q2 planning"`, `"ISSUE-42: Pricing"` |

**Why this matters:**

- **Traceability** — You (or Claude) can always click back to the original source
- **Staleness detection** — Queries can see how fresh extracted data is and when to re-fetch
- **No lock-in** — Source pointers mean Backpack is an index layer, not a data warehouse. Original data stays where it is.
- **Trust** — You can show exactly where insights and recommendations come from

Claude always adds this metadata automatically. You never need to think about it — just let your AI mine data naturally.

## Data and privacy

**Backpack Local**: your data is stored at `~/.local/share/backpack/graphs/<graph-name>/` as an append-only event log per branch (`branches/<branch>/events.jsonl`) plus a materialized snapshot cache (`branches/<branch>/snapshot.json`). Both are human-readable, backupable, and version-controlable. Graphs from earlier versions are migrated to this format automatically on first start — nothing to do.

**Backpack App**: your data is stored securely in our cloud infrastructure. See our [privacy policy](https://backpackontology.com/privacy) for details.

**Telemetry**: Backpack collects anonymous usage statistics (tool counts, session duration) to improve the product. No content, names, or personal data is ever collected. Opt out with `DO_NOT_TRACK=1`.

## Reference

### CLI commands

| Command | What it does |
|---|---|
| `npx backpack-ontology@latest` | Start the Backpack Local MCP server |
| `claude mcp add backpack-app ... --transport sse` | Connect to Backpack App cloud MCP |
| `npx -p backpack-ontology@latest backpack-sync` | Upload local learning graphs to Backpack App |
| `npx backpack-viewer@latest` | Open the graph visualizer (http://localhost:5173). Always include `@latest` — `npx backpack-viewer` without the version suffix reuses a cached older version. |
| `npx -p backpack-ontology@latest backpack-init` | Remove any leftover Backpack hooks from `.claude/settings.json` |
| `bp` | The standalone `bp` CLI — see below |

### The `bp` CLI

`bp` is a standalone command-line interface for Backpack — the same kind of tool you reach for when you want to script against your knowledge graph, run a quick query, or pipe graph data into `jq`. Style is deliberately Unix-flavored (`bp ls`, `bp cat`, `bp rm`, `bp mv`) with a `gh`/`kubectl`-style canonical form for power users (`bp graphs list`, `bp containers create`).

Install (it ships in the same package as the MCP server):

```bash
npm install -g backpack-ontology
bp                       # prints a hint card with the most-used commands
bp help                  # full reference
bp completion zsh        # tab completion for your shell (also: bash, fish)
```

#### Quick tour

```bash
# Where am I? Who am I?
bp where                                  # current scope (local backpack or cloud container + identity)
bp whoami                                  # signed-in email
bp doctor                                  # auth, connectivity, version skew checks

# Sign in to Backpack App (shares the token with the viewer)
bp login

# Switch contexts — fuzzy matched, did-you-mean on typos
bp use                                    # list available contexts
bp use cloud:my-container                     # switch to a cloud container
bp use local:work                         # switch to a local backpack

# List graphs in the active scope
bp ls                                     # default tabular
bp ls --json | jq '.graphs[] | .name'     # machine-readable
bp ls --names                             # names only, one per line
bp ls containers                          # cloud sync_backpacks
bp ls kbs                                 # knowledge-base docs

# Read graph data
bp cat agent-capabilities > graph.json  # JSON to stdout
bp cat agent-capabilities | jq '.nodes | length'
bp show agent-capabilities              # human-friendly summary + type histogram
bp open agent-capabilities              # launch the viewer

# Search across visible graphs
bp search "transformer"
bp search "Sarah Chen" --names
bp search "pgx" --max-graphs 100          # raise the fan-out cap

# Mutations — graphs
bp graphs create my-new-graph --description "scratchpad"
bp graphs apply -f exported.json          # idempotent upsert from a file
bp graphs edit my-new-graph               # opens in $EDITOR; structural-no-op detected
bp graphs rename old new                  # or: bp mv old new
bp graphs delete old                      # or: bp rm old   (asks for confirmation)
bp rm old --yes                           # skip the confirm

# KB documents
bp kbs list
bp kbs get my-doc      # body to stdout
bp kbs create -f notes.md --tags=alpha,beta
bp kbs edit my-doc
bp kbs delete my-doc

# Cloud admin (containers / sync_backpacks)
bp containers list
bp containers create client-acme --color "#7c3aed" --tags=client
bp containers rename client-acme client-acme-renamed
bp containers delete client-acme-renamed   # refuses if non-empty
bp graphs move some-graph --to client-acme
bp kbs move doc-id --to client-acme

# Initialize a new local backpack root
mkdir -p ~/work-backpack && cd ~/work-backpack
bp init                                   # registers and switches to it
```

#### Output formats

Pick one:

| Flag | Output | Stable contract? |
|---|---|---|
| (default) | human-friendly table with colors, narrows on small terminals | no — free to evolve |
| `--json` | full JSON | **yes** — script against this |
| `--yaml` | YAML | yes |
| `--names` | one name per line | yes |
| `--wide` | every column (still human) | no |
| `--no-color` | strip ANSI codes (also honors `NO_COLOR=1`) | n/a |

Scripts should always pipe `--json` to `jq` or use `--names`. The default human view is allowed to change between releases.

#### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | failure (any kind — auth, validation, network, server error) |
| 130 | user-interrupted ($EDITOR session aborted with Ctrl-C) |

Destructive verbs (`rm`, `mv`, `containers delete`, `kbs delete`) prompt for confirmation in a TTY and refuse in non-TTY contexts unless you pass `-y` / `--yes`.

#### Context model

A `bp` "context" is one of:

* `local:<backpack-name>` — a directory of learning graphs on your machine
* `cloud:<container-name>` — a cloud sync_backpack on Backpack App

`bp where` shows your current context. `bp use <name>` switches it (fuzzy-matched against the suffix; `bp use projects` works as long as it's unambiguous, otherwise the CLI tells you the candidates and asks you to pick the full `local:foo` or `cloud:foo`).

#### Auth

`bp login` runs the OAuth flow against Backpack App. The token is stored in `~/.config/backpack/extensions/share/settings.json` — the same file the viewer's Sign In button writes to, so signing in once works for both the CLI and the viewer. `bp logout` clears every known token location and is loud if any clear fails (so you don't think you're signed out when you aren't).

#### Configuration

| Variable | Effect |
|---|---|
| `BACKPACK_APP_URL` | Override the relay endpoint (default: `https://app.backpackontology.com`) |
| `BACKPACK_INSECURE_RELAY=1` | Allow plaintext HTTP for the relay (only for local dev — non-localhost HTTP is refused by default) |
| `EDITOR` / `VISUAL` | Used by `bp graphs edit` / `bp kbs edit`. Multi-arg values like `code --wait` work. |
| `NO_COLOR=1` | Disable ANSI colors |

### Multiple backpacks

A **backpack** is a directory of learning graphs. Most users start with one (`personal`, auto-created at `~/.local/share/backpack/graphs/`) and never touch the registry. But you can register additional backpacks — a shared OneDrive folder, a project-specific directory, a network-mounted share — and **switch between them** with a single command. Only one backpack is active at a time; all reads and writes go to the active one.

Backpacks are stored as a list of paths in `~/.config/backpack/backpacks.json`:

```json
{
  "version": 2,
  "paths": [
    "/Users/me/.local/share/backpack/graphs",
    "/Users/me/OneDrive/work",
    "/Users/me/Dropbox/family-backpack"
  ],
  "active": "/Users/me/OneDrive/work"
}
```

The file is hand-editable — you can add paths directly if you prefer. Display names are derived from the last segment of each path (`work`, `family-backpack`), and colors are hashed from the path. No manual naming or coloring required.

Say to Claude:

> "Register a backpack at /Users/me/OneDrive/work and switch to it."

> "Which backpack am I in?"

> "Switch to personal."

The viewer shows the active backpack in the sidebar header with a colored indicator — click it to switch. Per-user state (machine ID, telemetry, remote cache) stays at the default config location; only the graphs directory is shared.

### Tools

Claude uses these automatically. You don't need to call them directly.

| What Claude does | How |
|---|---|
| Manage backpacks | `backpack_register`, `backpack_switch`, `backpack_active`, `backpack_registered`, `backpack_unregister` |
| See what's in the backpack | `backpack_list`, `backpack_describe` |
| Add a new learning graph | `backpack_create` |
| Find something | `backpack_search`, `backpack_list_nodes` |
| Get full details on an item | `backpack_get_node`, `backpack_get_neighbors` |
| Add or update knowledge | `backpack_import_nodes` (preferred, with always-on validation), `backpack_add_node`, `backpack_update_node`, `backpack_add_edge` |
| Audit and clean up drift | `backpack_audit`, `backpack_audit_roles`, `backpack_normalize`, `backpack_health` |
| Snapshot and revert | `backpack_snapshot`, `backpack_versions`, `backpack_rollback`, `backpack_diff` |
| Branches | `backpack_branch_create`, `backpack_branch_switch`, `backpack_branch_list` |
| Collaboration awareness | `backpack_lock_status` (reads the current edit heartbeat on shared graphs) |
| Knowledge base | `backpack_kb_save`, `backpack_kb_list`, `backpack_kb_read`, `backpack_kb_delete`, `backpack_kb_search`, `backpack_kb_ingest`, `backpack_kb_mounts`, `backpack_kb_mount` |
| Cloud sync | `backpack_cloud_login`, `backpack_cloud_list`, `backpack_cloud_search`, `backpack_cloud_import` |
| Delete | `backpack_remove_node`, `backpack_remove_edge`, `backpack_delete` |

**Autonomous mining** (plugin-only): the `backpack-mine` skill in the [Claude Code plugin](https://github.com/NoahIrzinger/backpack-ontology-plugin) drives an iteration loop that finds sources on the web, extracts entities and relationships, validates each batch, and stops on convergence. Say "mine &lt;topic&gt; into a learning graph" and the skill takes over.

### Configuration

| Variable | Effect |
|---|---|
| `XDG_DATA_HOME` | Change local data location (default: `~/.local/share`) |
| `BACKPACK_DIR` | Override all Backpack directories |
| `DO_NOT_TRACK` | Disable anonymous telemetry |

## Support

Questions, feedback, or partnership inquiries: **support@backpackontology.com**

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/noahirzinger/backpack-ontology).
