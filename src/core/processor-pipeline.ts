// ============================================================
// Extensible processor pipeline for extraction quality validation.
//
// Built-in processors run in priority order (lower = first).
// Custom processors (Marker, Llama, GPU agents, domain extensions)
// can be registered at runtime via register().
//
// Pure: no I/O. Takes proposed nodes/edges + existing graph state,
// returns issues per processor.
// ============================================================

import type {
  ExtractionProcessor,
  ExtractionQualityReport,
  ProcessorContext,
  ProcessorIssue,
  ProposedEdgeInput,
  ProposedNodeInput,
} from "./types.js";

export class ExtractionValidator {
  private processors: ExtractionProcessor[] = [];

  register(processor: ExtractionProcessor): void {
    this.processors.push(processor);
    this.processors.sort((a, b) => a.priority - b.priority);
  }

  validate(
    nodes: ProposedNodeInput[],
    edges: ProposedEdgeInput[],
    context: ProcessorContext,
  ): ExtractionQualityReport {
    const allIssues: ProcessorIssue[] = [];
    const processorsRun: string[] = [];

    for (const proc of this.processors) {
      processorsRun.push(proc.name);

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (proc.canProcessNode(node)) {
          const issues = proc.processNode(node, i, context);
          allIssues.push(...issues);
        }
      }

      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (proc.canProcessEdge(edge)) {
          const issues = proc.processEdge(edge, i, context);
          allIssues.push(...issues);
        }
      }
    }

    const errors = allIssues.filter((i) => i.severity === "error");
    const warnings = allIssues.filter((i) => i.severity === "warning");
    const recommendedRemovals = [
      ...new Set(errors.map((i) => i.targetId)),
    ];

    return {
      ok: errors.length === 0,
      issues: allIssues,
      summary: {
        totalChecked: nodes.length + edges.length,
        errors: errors.length,
        warnings: warnings.length,
        processorsRun,
        recommendedRemovals,
      },
    };
  }
}
