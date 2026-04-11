// ============================================================
// DuplicateDetector processor.
//
// Checks proposed nodes against existing graph nodes for exact
// and fuzzy (type + normalized label) duplicates.
// ============================================================

import type {
  ExtractionProcessor,
  ProcessorContext,
  ProcessorIssue,
  ProposedEdgeInput,
  ProposedNodeInput,
} from "../types.js";
import type { Node } from "../types.js";

function normalizeType(type: string): string {
  return type.toLowerCase().replace(/[-_\s]/g, "");
}

function firstStringValue(properties: Record<string, unknown>): string | null {
  for (const v of Object.values(properties)) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function buildIndex(nodes: Node[]): Map<string, { id: string; label: string }> {
  const idx = new Map<string, { id: string; label: string }>();
  for (const n of nodes) {
    const label = firstStringValue(n.properties);
    if (label === null) continue;
    const key = `${normalizeType(n.type)}::${label.toLowerCase()}`;
    if (!idx.has(key)) idx.set(key, { id: n.id, label });
  }
  return idx;
}

export class DuplicateDetector implements ExtractionProcessor {
  name = "duplicate_detector";
  priority = 40;

  canProcessNode(_node: ProposedNodeInput): boolean {
    return true;
  }

  canProcessEdge(_edge: ProposedEdgeInput): boolean {
    return false;
  }

  processNode(
    node: ProposedNodeInput,
    index: number,
    context: ProcessorContext,
  ): ProcessorIssue[] {
    const idx = buildIndex(context.existingNodes);
    const label = firstStringValue(node.properties);
    if (label === null) return [];

    const key = `${normalizeType(node.type)}::${label.toLowerCase()}`;
    const existing = idx.get(key);
    if (!existing) return [];

    return [
      {
        kind: "duplicate_node",
        severity: "warning",
        targetId: `node[${index}]`,
        detectedBy: this.name,
        message: `node[${index}] (type=${node.type}, label="${label}") matches existing node ${existing.id}`,
        recommendation: `Use backpack_update_node on ${existing.id} instead, or skip this node.`,
      },
    ];
  }

  processEdge(
    _edge: ProposedEdgeInput,
    _index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    return [];
  }
}
