// ============================================================
// Three-role-rule auditor.
//
// The three-role rule says:
//   - CLAUDE.md holds the LLM's briefing (environmental facts)
//   - Skills hold the LLM's playbook (procedural workflows)
//   - Backpack learning graphs hold the LLM's discovered knowledge
//     (typed entities + relationships)
//
// This auditor scans a graph for nodes that look like they belong in
// CLAUDE.md or in a skill rather than in the graph. It is heuristic
// and deliberately conservative — false positives erode user trust
// faster than false negatives erode the rule.
// ============================================================

import type { Node } from "./types.js";

export interface RoleAuditCandidate {
  nodeId: string;
  type: string;
  label: string;
  reason: string;
  suggestion: string;
}

export interface RoleAuditResult {
  proceduralCandidates: RoleAuditCandidate[];
  briefingCandidates: RoleAuditCandidate[];
  summary: {
    nodesScanned: number;
    proceduralCount: number;
    briefingCount: number;
    cleanCount: number;
  };
}

// --- Type-name vocabularies ---
//
// Types whose name strongly suggests procedural content. Singular and
// plural forms accepted.

const PROCEDURAL_TYPE_NAMES = new Set([
  "step",
  "steps",
  "procedure",
  "procedures",
  "workflow",
  "workflows",
  "process",
  "processes",
  "task",
  "tasks",
  "action",
  "actions",
  "playbook",
  "playbooks",
  "runbook",
  "runbooks",
  "checklist",
  "checklists",
  "howto",
  "tutorial",
  "tutorials",
  "guide",
  "guides",
]);

const BRIEFING_TYPE_NAMES = new Set([
  "convention",
  "conventions",
  "setting",
  "settings",
  "config",
  "configs",
  "configuration",
  "configurations",
  "preference",
  "preferences",
  "rule",
  "rules",
  "standard",
  "standards",
  "policy",
  "policies",
  "guideline",
  "guidelines",
  "envvar",
  "environmentvariable",
  "environment",
]);

// --- Helpers ---

function nodeLabel(node: Node): string {
  for (const value of Object.values(node.properties)) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return node.id;
}

function propertyText(node: Node): string {
  return Object.entries(node.properties)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ")
    .toLowerCase();
}

function normalizeType(type: string): string {
  return type.toLowerCase().replace(/[-_\s]/g, "");
}

// --- Detectors ---

function detectProcedural(node: Node): { is: boolean; reason: string } {
  const norm = normalizeType(node.type);
  if (PROCEDURAL_TYPE_NAMES.has(norm)) {
    return {
      is: true,
      reason: `type "${node.type}" suggests procedural content`,
    };
  }

  // Multiple sequential property keys (step1, step2, action_a, action_b, ...)
  const sequenceKeys = Object.keys(node.properties).filter((k) =>
    /^(step|stage|action|phase)[\s_-]*\d+$/i.test(k),
  );
  if (sequenceKeys.length >= 2) {
    return {
      is: true,
      reason: `multiple sequential property keys (${sequenceKeys.join(", ")})`,
    };
  }

  const text = propertyText(node);

  // "first ... then ..." pattern
  if (/\bfirst\b[^.]{0,80}\bthen\b/.test(text)) {
    return {
      is: true,
      reason: 'contains "first ... then ..." sequence',
    };
  }

  // "step N" or "stage N" markers in property values
  if (/\bstep\s*\d|\bstage\s*\d/.test(text)) {
    return {
      is: true,
      reason: 'contains "step N" or "stage N" markers',
    };
  }

  // Multiple imperative-verb sentence starts. Single imperative is fine
  // (could be a fact); two or more inside one node looks like a recipe.
  const imperativeStarts =
    text.match(
      /(?:^|[.!?]\s+)(run|check|click|open|navigate|configure|install|create|delete|update|push|pull|commit|deploy|kill|stop|start|restart|invoke|execute|launch|enable|disable)\b/gi,
    ) || [];
  if (imperativeStarts.length >= 2) {
    return {
      is: true,
      reason: `${imperativeStarts.length} imperative-verb sentence starts (looks like a procedure)`,
    };
  }

  return { is: false, reason: "" };
}

function detectBriefing(node: Node): { is: boolean; reason: string } {
  const norm = normalizeType(node.type);
  if (BRIEFING_TYPE_NAMES.has(norm)) {
    return {
      is: true,
      reason: `type "${node.type}" suggests briefing content`,
    };
  }

  const text = propertyText(node);

  // "this project/codebase/repo uses X" — environmental briefing
  if (/\bthis (project|codebase|repo|repository|app|service) uses\b/.test(text)) {
    return {
      is: true,
      reason: '"this project/codebase uses…" is environmental context',
    };
  }

  // Absolute rules — "always" / "never" — are conventions, not facts
  if (/\b(always|never)\s+(use|do|run|commit|prefer|avoid)\b/.test(text)) {
    return {
      is: true,
      reason: 'absolute rule ("always/never use…") is a convention',
    };
  }

  // "we use X" / "we always Y" — tribal/team conventions
  if (/\bwe (always|never|prefer|use|run|deploy|build)\b/.test(text)) {
    return {
      is: true,
      reason: '"we use/prefer/avoid…" is a team convention',
    };
  }

  return { is: false, reason: "" };
}

// --- Main entry ---

export function auditRoles(nodes: Node[]): RoleAuditResult {
  const procedural: RoleAuditCandidate[] = [];
  const briefing: RoleAuditCandidate[] = [];

  for (const node of nodes) {
    const proc = detectProcedural(node);
    if (proc.is) {
      procedural.push({
        nodeId: node.id,
        type: node.type,
        label: nodeLabel(node),
        reason: proc.reason,
        suggestion:
          "Move this content into a skill (procedural knowledge), then remove the node from the graph.",
      });
      continue;
    }
    const brief = detectBriefing(node);
    if (brief.is) {
      briefing.push({
        nodeId: node.id,
        type: node.type,
        label: nodeLabel(node),
        reason: brief.reason,
        suggestion:
          "Move this content into the project's CLAUDE.md (environmental briefing), then remove the node from the graph.",
      });
    }
  }

  return {
    proceduralCandidates: procedural,
    briefingCandidates: briefing,
    summary: {
      nodesScanned: nodes.length,
      proceduralCount: procedural.length,
      briefingCount: briefing.length,
      cleanCount: nodes.length - procedural.length - briefing.length,
    },
  };
}
