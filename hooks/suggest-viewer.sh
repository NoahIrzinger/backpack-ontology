#!/bin/sh
# PostToolUse hook: suggest the viewer after backpack write operations.
# Output is injected into Claude's context as additional information.
echo 'The user'\''s backpack ontology was just updated. Let the user know they can visualize their knowledge graph by running: npx backpack-viewer (opens http://localhost:5173)'
