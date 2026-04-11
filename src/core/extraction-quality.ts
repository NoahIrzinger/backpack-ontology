// ============================================================
// ExtractionQualityValidator — orchestrates the processor pipeline.
//
// Built-in processors are registered at construction time.
// Custom processors (Marker, Llama, GPU agents, domain extensions)
// can be registered via register() before calling validate().
// ============================================================

import type {
  ExtractionProcessor,
  ExtractionQualityReport,
  ProposedEdgeInput,
  ProposedNodeInput,
} from "./types.js";
import type { Node, Edge } from "./types.js";
import { ExtractionValidator } from "./processor-pipeline.js";
import { VaguenessFilter } from "./processors/vagueness-filter.js";
import { RelationshipThreshold } from "./processors/relationship-threshold.js";
import { RoleAuditValidator } from "./processors/role-audit-validator.js";
import { DuplicateDetector } from "./processors/duplicate-detector.js";

export class ExtractionQualityValidator {
  private pipeline: ExtractionValidator;

  constructor() {
    this.pipeline = new ExtractionValidator();
    this.pipeline.register(new VaguenessFilter());
    this.pipeline.register(new RelationshipThreshold());
    this.pipeline.register(new RoleAuditValidator());
    this.pipeline.register(new DuplicateDetector());
  }

  /** Register a custom processor (Marker, Llama, GPU, domain extension). */
  register(processor: ExtractionProcessor): void {
    this.pipeline.register(processor);
  }

  validate(
    nodes: ProposedNodeInput[],
    edges: ProposedEdgeInput[],
    existingNodes: Node[],
    existingEdges: Edge[],
  ): ExtractionQualityReport {
    return this.pipeline.validate(nodes, edges, { existingNodes, existingEdges });
  }
}
