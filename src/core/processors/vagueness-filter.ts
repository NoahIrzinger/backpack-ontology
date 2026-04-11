// ============================================================
// VaguenessFilter processor.
//
// Catches nodes/edges that are too vague to be useful facts:
//   - Node labels that are bare pronouns or non-specific nouns
//   - Edge types that are generic catch-alls
//   - Property values that are meaningless adjectives
// ============================================================

import type {
  ExtractionProcessor,
  ProcessorContext,
  ProcessorIssue,
  ProposedEdgeInput,
  ProposedNodeInput,
} from "../types.js";

const VAGUE_LABELS = new Set([
  "they",
  "them",
  "it",
  "this",
  "that",
  "something",
  "someone",
  "anyone",
  "everyone",
  "thing",
  "things",
  "item",
  "items",
  "object",
  "entity",
  "element",
  "stuff",
  "data",
  "info",
  "information",
  "content",
  "resource",
  "result",
  "output",
  "input",
  "other",
  "misc",
  "general",
  "unknown",
  "n/a",
  "tbd",
  "todo",
]);

const GENERIC_EDGE_TYPES = new Set([
  "related",
  "related_to",
  "relatedto",
  "relevant",
  "relevant_to",
  "involves",
  "concerns",
  "about",
  "associated",
  "associated_with",
  "associatedwith",
  "connected",
  "connected_to",
  "connectedto",
  "linked",
  "linked_to",
  "linkedto",
  "has",
  "is",
  "has_a",
  "is_a",
]);

const VAGUE_PROPERTY_VALUES = new Set([
  "important",
  "strategic",
  "significant",
  "relevant",
  "key",
  "critical",
  "major",
  "minor",
  "various",
  "several",
  "many",
  "some",
  "certain",
  "general",
  "misc",
  "other",
  "tbd",
  "unknown",
  "n/a",
]);

function firstStringValue(properties: Record<string, unknown>): string {
  for (const v of Object.values(properties)) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

export class VaguenessFilter implements ExtractionProcessor {
  name = "vagueness_filter";
  priority = 10;

  canProcessNode(_node: ProposedNodeInput): boolean {
    return true;
  }

  canProcessEdge(_edge: ProposedEdgeInput): boolean {
    return true;
  }

  processNode(
    node: ProposedNodeInput,
    index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    const issues: ProcessorIssue[] = [];
    const label = firstStringValue(node.properties).toLowerCase();

    if (label.length === 0) {
      issues.push({
        kind: "vague_label",
        severity: "warning",
        targetId: `node[${index}]`,
        detectedBy: this.name,
        message: `node[${index}] (type=${node.type}) has no string label in properties`,
        recommendation:
          "Add a specific label property so the node can be identified.",
      });
    } else if (VAGUE_LABELS.has(label)) {
      issues.push({
        kind: "vague_label",
        severity: "error",
        targetId: `node[${index}]`,
        detectedBy: this.name,
        message: `node[${index}] label "${label}" is too vague to be a useful fact`,
        recommendation:
          "Use a specific, distinguishing label (e.g. a name, ID, or descriptor).",
      });
    }

    // Check for all-vague property values
    const allStringValues = Object.values(node.properties).filter(
      (v): v is string => typeof v === "string",
    );
    const allVague =
      allStringValues.length > 0 &&
      allStringValues.every((v) => VAGUE_PROPERTY_VALUES.has(v.toLowerCase()));
    if (allVague) {
      issues.push({
        kind: "vague_property",
        severity: "warning",
        targetId: `node[${index}]`,
        detectedBy: this.name,
        message: `node[${index}] all property values are vague adjectives (${allStringValues.join(", ")})`,
        recommendation:
          "Replace vague adjectives with specific, measurable facts.",
      });
    }

    return issues;
  }

  processEdge(
    edge: ProposedEdgeInput,
    index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    const issues: ProcessorIssue[] = [];
    const normalized = edge.type.toLowerCase().replace(/[-_\s]/g, "");

    if (GENERIC_EDGE_TYPES.has(normalized)) {
      issues.push({
        kind: "generic_edge_type",
        severity: "error",
        targetId: `edge[${index}]`,
        detectedBy: this.name,
        message: `edge[${index}] type "${edge.type}" is too generic`,
        recommendation:
          'Use a specific relationship type (e.g. "MANAGES", "DEPENDS_ON", "OWNS", "VIOLATES").',
      });
    }

    return issues;
  }
}
