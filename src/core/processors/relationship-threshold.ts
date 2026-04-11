// ============================================================
// RelationshipThreshold processor.
//
// Scores edges by how relational they actually are.
// Edges that are just "mentioned together" with no explicit
// relationship claim are flagged as insufficient.
//
// Scoring:
//   +2  Explicit relationship claim in source_context
//   +1  Relationship type is domain-semantic (well-known verb)
//   +1  Edge has non-empty properties (additional context)
//
// Threshold: require >= 2 points. Error if < 2.
// ============================================================

import type {
  ExtractionProcessor,
  ProcessorContext,
  ProcessorIssue,
  ProposedEdgeInput,
  ProposedNodeInput,
} from "../types.js";

// Edge types that carry domain semantic weight — specific, meaningful verbs
const SEMANTIC_EDGE_TYPES = new Set([
  "manages",
  "owns",
  "depends_on",
  "dependson",
  "contains",
  "belongs_to",
  "belongsto",
  "reports_to",
  "reportsto",
  "violates",
  "contracts_with",
  "contractswith",
  "employs",
  "serves",
  "pays",
  "invoices",
  "audits",
  "monitors",
  "maintains",
  "operates",
  "supplies",
  "integrates_with",
  "integrateswith",
  "authorizes",
  "blocks",
  "supersedes",
  "replaces",
  "requires",
  "provides",
  "implements",
  "inherits_from",
  "inheritsfrom",
  "parent_of",
  "parentof",
  "child_of",
  "childof",
  "peer_of",
  "peerof",
  "works_with",
  "workswith",
  "collaborates_with",
  "collaborateswith",
  "competes_with",
  "competeswith",
  "mitigates",
  "escalates_to",
  "escalatesto",
  "overrides",
  "reviews",
  "approves",
  "rejects",
  "schedules",
  "assigns",
  "delegates_to",
  "delegatesto",
  "hosts",
  "deploys",
  "configures",
  "governs",
  "enforces",
  "tracks",
  "logs",
  "triggers",
  "notifies",
  "subscribes_to",
  "subscribesto",
  "publishes_to",
  "publishesto",
  "reads_from",
  "readsfrom",
  "writes_to",
  "writesto",
  "created_by",
  "createdby",
  "updated_by",
  "updatedby",
  "owned_by",
  "ownedby",
  "managed_by",
  "managedby",
  "funded_by",
  "fundedby",
  "represented_by",
  "representedby",
  "regulated_by",
  "regulatedby",
  "acquired_by",
  "acquiredby",
  "sold_to",
  "soldto",
  "bought_from",
  "boughtfrom",
  "member_of",
  "memberof",
  "part_of",
  "partof",
  "leads",
  "supports",
  "influences",
  "generates",
  "reduces",
  "increases",
  "causes",
  "prevents",
]);

export class RelationshipThreshold implements ExtractionProcessor {
  name = "relationship_threshold";
  priority = 20;

  canProcessNode(_node: ProposedNodeInput): boolean {
    return false;
  }

  canProcessEdge(_edge: ProposedEdgeInput): boolean {
    return true;
  }

  processNode(
    _node: ProposedNodeInput,
    _index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    return [];
  }

  processEdge(
    edge: ProposedEdgeInput,
    index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    let score = 0;

    const normalized = edge.type.toLowerCase().replace(/[-_\s]/g, "");
    if (SEMANTIC_EDGE_TYPES.has(normalized)) {
      score += 1;
    }

    if (edge.properties && Object.keys(edge.properties).length > 0) {
      const hasNonEmpty = Object.values(edge.properties).some(
        (v) => v !== null && v !== "" && v !== undefined,
      );
      if (hasNonEmpty) score += 1;
    }

    // source property on the edge counts as explicit relationship evidence
    const sourcePointer =
      edge.properties?.source || edge.properties?.source_pointer;
    if (sourcePointer && typeof sourcePointer === "string" && sourcePointer.length > 0) {
      score += 2;
    }

    if (score < 2) {
      return [
        {
          kind: "low_relationship_score",
          severity: "warning",
          targetId: `edge[${index}]`,
          detectedBy: this.name,
          message: `edge[${index}] (type=${edge.type}) has low relationship score (${score}/4) — weak evidence for this connection`,
          recommendation:
            "Strengthen by: using a semantic edge type, adding a source pointer, or adding properties that describe the relationship.",
        },
      ];
    }

    return [];
  }
}
