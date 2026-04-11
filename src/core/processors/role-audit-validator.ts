// ============================================================
// RoleAuditValidator processor.
//
// Reuses the existing auditRoles() function from role-audit.ts
// and converts its findings into ProcessorIssues.
//
// Procedural content (belongs in Skills) → error
// Briefing content (belongs in CLAUDE.md) → warning
// ============================================================

import type {
  ExtractionProcessor,
  ProcessorContext,
  ProcessorIssue,
  ProposedEdgeInput,
  ProposedNodeInput,
} from "../types.js";
import type { Node } from "../types.js";
import { auditRoles } from "../role-audit.js";

export class RoleAuditValidator implements ExtractionProcessor {
  name = "role_audit_validator";
  priority = 30;

  canProcessNode(_node: ProposedNodeInput): boolean {
    return true;
  }

  canProcessEdge(_edge: ProposedEdgeInput): boolean {
    return false;
  }

  processNode(
    node: ProposedNodeInput,
    index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    const fakeNode: Node = {
      id: `proposed-${index}`,
      type: node.type,
      properties: node.properties,
      createdAt: "",
      updatedAt: "",
    };

    const result = auditRoles([fakeNode]);
    const issues: ProcessorIssue[] = [];

    for (const candidate of result.proceduralCandidates) {
      issues.push({
        kind: "procedural_content",
        severity: "error",
        targetId: `node[${index}]`,
        detectedBy: this.name,
        message: `node[${index}] (type=${node.type}) looks procedural: ${candidate.reason}`,
        recommendation: candidate.suggestion,
      });
    }

    for (const candidate of result.briefingCandidates) {
      issues.push({
        kind: "briefing_content",
        severity: "warning",
        targetId: `node[${index}]`,
        detectedBy: this.name,
        message: `node[${index}] (type=${node.type}) looks briefing-like: ${candidate.reason}`,
        recommendation: candidate.suggestion,
      });
    }

    return issues;
  }

  processEdge(
    _edge: ProposedEdgeInput,
    _index: number,
    _context: ProcessorContext,
  ): ProcessorIssue[] {
    return [];
  }
}
