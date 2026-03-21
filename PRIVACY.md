# Privacy Policy

**Backpack Ontology**
Last updated: March 20, 2026

## Overview

Backpack Ontology is a local-first knowledge graph engine. All ontology data (nodes, edges, properties, names, descriptions) is stored exclusively on your device and is never transmitted to any external server.

## Data Storage

Ontology data is stored locally at `~/.local/share/backpack/ontologies/` (or a custom path if configured). No data is sent to Backpack Ontology's servers or any third party.

## Telemetry

Backpack Ontology collects anonymous, aggregated usage telemetry to improve the product. This telemetry is entirely optional and can be disabled.

### What is collected

- Tool call counts (which tools are used, not what data is passed)
- Session duration
- Aggregate ontology statistics (total node and edge counts only, not names or content)
- Runtime environment (Node.js version, OS, platform)

### What is never collected

- Ontology names, descriptions, or content
- Node or edge properties, types, or identifiers
- File paths or user identifiers
- Tool arguments or query strings
- Any personally identifiable information (PII)

### How to opt out

Disable telemetry using any of the following methods:

- Set the environment variable `DO_NOT_TRACK=1` (industry standard)
- Set the environment variable `BACKPACK_TELEMETRY_DISABLED=1`
- Add `{"telemetry": false}` to `~/.config/backpack/config.json`

When telemetry is disabled, no data is transmitted.

## Third-Party Services

Backpack Ontology does not integrate with any third-party analytics, advertising, or tracking services. The telemetry endpoint is operated by the Backpack Ontology project.

## Children's Privacy

Backpack Ontology does not knowingly collect any personal information from anyone, including children under 13.

## Changes to This Policy

Updates to this policy will be reflected in this document with an updated revision date. Continued use of the software after changes constitutes acceptance of the revised policy.

## Contact

For privacy-related questions or concerns: support@backpackontology.com
