# Backpack

**Carry your knowledge forward.** Backpack lets Claude remember what matters: your clients, your processes, your decisions. Knowledge that travels with you.

## What it does

When you're working with Claude and something worth remembering comes up, Backpack saves it as a structured knowledge graph. Next time you ask, Claude already knows.

```
You: "We just signed Acme Corp, they're on the Enterprise tier, main contact is Sarah Chen"

Claude: [saves to backpack → clients ontology]

--- weeks later, different conversation ---

You: "What do we know about Acme Corp?"

Claude: "Acme Corp is on the Enterprise tier, main contact is Sarah Chen..."
```

No copy-pasting. No re-explaining. Your knowledge carries forward.

## Get started

### Recommended: Backpack App (free cloud account)

Sign up for a free account at [app.backpackontology.com](https://app.backpackontology.com), then add Backpack to Claude Code:

```bash
claude mcp add backpack-app -s user -- npx backpack-app
```

Your knowledge syncs across devices, you can share with your team, and you get access to the web-based graph visualizer. On first run, a browser window opens for sign-in. After that, it's automatic.

### Backpack Local (offline, private)

Prefer to keep everything on your machine? No account needed:

```bash
claude mcp add backpack-local -s user -- npx backpack-local
```

You can always move to Backpack App later by telling Claude "sync my backpack to the cloud".

### Switching from Backpack Local to Backpack App

Already using Backpack Local and want to move to the cloud? One command uploads everything:

> "Sync my backpack to the cloud"

Then swap your MCP config from `backpack` to `backpack-app` and you're done.

## What to say to Claude

No commands to learn. Just talk naturally.

### Remember something

> "Remember that Acme Corp is on the Enterprise tier, main contact is Sarah Chen"

> "Add our new vendor agreement details to backpack"

> "Start an ontology for our hiring process"

### Find something

> "What's in my backpack about Acme Corp?"

> "Search backpack for anything related to compliance"

> "What do we know about the deployment process?"

### See the big picture

> "Show me my knowledge graph"

> "What's in my backpack?"

> "Describe the clients ontology"

Claude will open the graph visualizer so you can explore your knowledge visually.

## What people use it for

- **Client management**: keep track of accounts, contacts, contract details, and conversations across sessions
- **Process documentation**: capture how things are done so Claude can help consistently every time
- **Project knowledge**: architecture decisions, vendor relationships, compliance requirements
- **Domain expertise**: industry terminology, regulatory frameworks, best practices
- **Team onboarding**: new team members get Claude with your organization's context already loaded

## How it works

You have one backpack. It goes everywhere with you. Inside it, you organize knowledge into **ontologies**, each covering a different topic (clients, processes, compliance, etc.). Within each ontology, information is stored as things connected by relationships. You don't need to think about the structure. Claude handles it automatically.

## Data and privacy

**Backpack Local**: your data is stored as readable JSON files on your computer at `~/.local/share/backpack/ontologies/`. You can inspect, edit, back up, or version-control these files directly.

**Backpack App**: your data is stored securely in our cloud infrastructure. See our [privacy policy](https://backpackontology.com/privacy) for details.

**Telemetry**: Backpack collects anonymous usage statistics (tool counts, session duration) to improve the product. No content, names, or personal data is ever collected. Opt out with `DO_NOT_TRACK=1`.

## Reference

### CLI commands

| Command | What it does |
|---|---|
| `npx backpack-local` | Start the Backpack Local MCP server |
| `npx backpack-app` | Start the Backpack App MCP server |
| `npx backpack-sync` | Upload local ontologies to Backpack App |
| `npx backpack-viewer` | Open the graph visualizer (http://localhost:5173) |
| `npx backpack-init` | Reinstall auto-capture hooks if removed |

### Tools

Claude uses these automatically. You don't need to call them directly.

| What Claude does | How |
|---|---|
| See what's in the backpack | `backpack_list`, `backpack_describe` |
| Add a new ontology | `backpack_create` |
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
