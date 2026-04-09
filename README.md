# Backpack

**Carry your knowledge forward.** Backpack lets Claude remember what matters: your clients, your processes, your decisions. Knowledge that travels with you.

## What it does

When you're working with Claude and something worth remembering comes up, Backpack saves it as a structured learning graph. Next time you ask, Claude already knows.

```
You: "We just signed Acme Corp, they're on the Enterprise tier, main contact is Sarah Chen"

Claude: [saves to backpack → clients learning graph]

--- weeks later, different conversation ---

You: "What do we know about Acme Corp?"

Claude: "Acme Corp is on the Enterprise tier, main contact is Sarah Chen..."
```

No copy-pasting. No re-explaining. Your knowledge carries forward.

## Get started

### Recommended: Backpack App (free cloud account)

Sign up for a free account at [app.backpackontology.com](https://app.backpackontology.com), then add Backpack to Claude Code:

```bash
claude mcp add backpack-app -s user --transport sse https://app.backpackontology.com/mcp/sse
```

Your knowledge syncs across devices, you can share with your team, and you get access to the web-based graph visualizer. On first run, a browser window opens for sign-in. After that, it's automatic.

### Backpack Local (offline, private)

Prefer to keep everything on your machine? No account needed:

```bash
claude mcp add backpack-local -s user -- npx backpack-ontology@latest
```

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

## Data and privacy

**Backpack Local**: your data is stored as readable JSON files on your computer at `~/.local/share/backpack/ontologies/`. You can inspect, edit, back up, or version-control these files directly.

**Backpack App**: your data is stored securely in our cloud infrastructure. See our [privacy policy](https://backpackontology.com/privacy) for details.

**Telemetry**: Backpack collects anonymous usage statistics (tool counts, session duration) to improve the product. No content, names, or personal data is ever collected. Opt out with `DO_NOT_TRACK=1`.

## Reference

### CLI commands

| Command | What it does |
|---|---|
| `npx backpack-ontology@latest` | Start the Backpack Local MCP server |
| `claude mcp add backpack-app ... --transport sse` | Connect to Backpack App cloud MCP |
| `npx -p backpack-ontology@latest backpack-sync` | Upload local learning graphs to Backpack App |
| `npx backpack-viewer` | Open the graph visualizer (http://localhost:5173) |
| `npx -p backpack-ontology@latest backpack-init` | Reinstall auto-capture hooks if removed |

### Tools

Claude uses these automatically. You don't need to call them directly.

| What Claude does | How |
|---|---|
| See what's in the backpack | `backpack_list`, `backpack_describe` |
| Add a new learning graph | `backpack_create` |
| Find something | `backpack_search`, `backpack_list_nodes` |
| Get full details on an item | `backpack_get_node`, `backpack_get_neighbors` |
| Add or update knowledge | `backpack_add_node`, `backpack_update_node`, `backpack_add_edge` |
| Bulk import | `backpack_import_nodes` |
| Clean up | `backpack_remove_node`, `backpack_remove_edge`, `backpack_delete` |

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
