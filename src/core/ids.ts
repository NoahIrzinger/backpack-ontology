import { nanoid } from "nanoid";

// Prefixed IDs make it obvious whether you're looking at a node or an edge
// when debugging JSON files or reading tool output.

export function generateNodeId(): string {
  return "n_" + nanoid(12);
}

export function generateEdgeId(): string {
  return "e_" + nanoid(12);
}
