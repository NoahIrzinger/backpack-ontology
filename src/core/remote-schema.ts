// ============================================================
// Strict validation for remote learning graphs.
//
// Anything fetched from a third-party URL must pass through this
// validator before any other code touches it. The goal is to:
//   1. Reject malformed input that could crash the parser
//   2. Reject oversized graphs that could exhaust memory
//   3. Reject unknown structures that could carry future exploits
//   4. Coerce property values to a safe primitive subset
//
// This is intentionally STRICTER than the schema used for local
// graphs. Local graphs are trusted (the user wrote them); remote
// graphs are not.
// ============================================================

import type { LearningGraphData, Node, Edge } from "./types.js";

// --- Limits ---

export const REMOTE_GRAPH_LIMITS = {
  maxNodes: 50_000,
  maxEdges: 200_000,
  maxPropertyKeys: 64,
  maxPropertyKeyLength: 128,
  maxPropertyStringLength: 16_384,
  maxArrayLength: 256,
  maxIdLength: 256,
  maxTypeLength: 128,
  maxNameLength: 256,
  maxDescriptionLength: 4_096,
} as const;

// --- Errors ---

export class RemoteSchemaError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "RemoteSchemaError";
  }
}

// --- Validators ---

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateString(
  value: unknown,
  path: string,
  maxLength: number,
  required = true,
): string {
  if (value === undefined || value === null) {
    if (required) {
      throw new RemoteSchemaError("missing required string", path);
    }
    return "";
  }
  if (typeof value !== "string") {
    throw new RemoteSchemaError(`expected string, got ${typeof value}`, path);
  }
  if (value.length > maxLength) {
    throw new RemoteSchemaError(
      `string exceeds max length ${maxLength} (got ${value.length})`,
      path,
    );
  }
  return value;
}

/**
 * Validates a property value. Allowed: string, number (finite), boolean,
 * or array of those primitives. Rejects nested objects, functions, symbols,
 * bigints, and any non-finite numbers.
 */
function validatePropertyValue(value: unknown, path: string): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > REMOTE_GRAPH_LIMITS.maxPropertyStringLength) {
      throw new RemoteSchemaError(
        `property string exceeds max length ${REMOTE_GRAPH_LIMITS.maxPropertyStringLength}`,
        path,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RemoteSchemaError("number must be finite", path);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > REMOTE_GRAPH_LIMITS.maxArrayLength) {
      throw new RemoteSchemaError(
        `array exceeds max length ${REMOTE_GRAPH_LIMITS.maxArrayLength}`,
        path,
      );
    }
    return value.map((item, i) => {
      if (item === null || item === undefined) return item;
      if (typeof item === "string") {
        if (item.length > REMOTE_GRAPH_LIMITS.maxPropertyStringLength) {
          throw new RemoteSchemaError(
            `array item string exceeds max length`,
            `${path}[${i}]`,
          );
        }
        return item;
      }
      if (typeof item === "number") {
        if (!Number.isFinite(item)) {
          throw new RemoteSchemaError("number must be finite", `${path}[${i}]`);
        }
        return item;
      }
      if (typeof item === "boolean") return item;
      throw new RemoteSchemaError(
        `array items must be string, number, or boolean (got ${typeof item})`,
        `${path}[${i}]`,
      );
    });
  }
  throw new RemoteSchemaError(
    `properties must be string, number, boolean, null, or array of those (got ${typeof value})`,
    path,
  );
}

function validateProperties(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new RemoteSchemaError("properties must be a plain object", path);
  }
  const keys = Object.keys(value);
  if (keys.length > REMOTE_GRAPH_LIMITS.maxPropertyKeys) {
    throw new RemoteSchemaError(
      `too many property keys (max ${REMOTE_GRAPH_LIMITS.maxPropertyKeys})`,
      path,
    );
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key.length > REMOTE_GRAPH_LIMITS.maxPropertyKeyLength) {
      throw new RemoteSchemaError(
        `property key exceeds max length`,
        `${path}.${key.slice(0, 32)}...`,
      );
    }
    // Reject prototype-pollution attempts
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new RemoteSchemaError(
        `property key '${key}' is not allowed`,
        path,
      );
    }
    out[key] = validatePropertyValue(value[key], `${path}.${key}`);
  }
  return out;
}

function validateNode(raw: unknown, index: number): Node {
  const path = `nodes[${index}]`;
  if (!isPlainObject(raw)) {
    throw new RemoteSchemaError("node must be a plain object", path);
  }
  const id = validateString(raw.id, `${path}.id`, REMOTE_GRAPH_LIMITS.maxIdLength);
  const type = validateString(
    raw.type,
    `${path}.type`,
    REMOTE_GRAPH_LIMITS.maxTypeLength,
  );
  const properties = validateProperties(raw.properties, `${path}.properties`);
  const createdAt = validateString(
    raw.createdAt,
    `${path}.createdAt`,
    64,
    false,
  );
  const updatedAt = validateString(
    raw.updatedAt,
    `${path}.updatedAt`,
    64,
    false,
  );
  return {
    id,
    type,
    properties,
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

function validateEdge(raw: unknown, index: number): Edge {
  const path = `edges[${index}]`;
  if (!isPlainObject(raw)) {
    throw new RemoteSchemaError("edge must be a plain object", path);
  }
  const id = validateString(raw.id, `${path}.id`, REMOTE_GRAPH_LIMITS.maxIdLength);
  const type = validateString(
    raw.type,
    `${path}.type`,
    REMOTE_GRAPH_LIMITS.maxTypeLength,
  );
  const sourceId = validateString(
    raw.sourceId,
    `${path}.sourceId`,
    REMOTE_GRAPH_LIMITS.maxIdLength,
  );
  const targetId = validateString(
    raw.targetId,
    `${path}.targetId`,
    REMOTE_GRAPH_LIMITS.maxIdLength,
  );
  const properties = validateProperties(raw.properties, `${path}.properties`);
  const createdAt = validateString(
    raw.createdAt,
    `${path}.createdAt`,
    64,
    false,
  );
  const updatedAt = validateString(
    raw.updatedAt,
    `${path}.updatedAt`,
    64,
    false,
  );
  return {
    id,
    type,
    sourceId,
    targetId,
    properties,
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

/**
 * Validates a parsed JSON value against the remote graph schema.
 * Throws RemoteSchemaError on any violation.
 *
 * The returned object is a fresh, type-safe LearningGraphData. Edges
 * that reference node IDs not in the graph are dropped (not an error —
 * remote graphs may legitimately have hanging references after partial
 * exports). Use the `droppedEdges` count from the result if you care.
 */
export function validateRemoteGraph(raw: unknown): {
  data: LearningGraphData;
  droppedEdges: number;
} {
  if (!isPlainObject(raw)) {
    throw new RemoteSchemaError("root must be a plain object", "$");
  }

  // Allowed top-level keys only
  const allowedKeys = new Set(["metadata", "nodes", "edges"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      throw new RemoteSchemaError(`unknown top-level key '${key}'`, "$");
    }
  }

  // metadata
  if (!isPlainObject(raw.metadata)) {
    throw new RemoteSchemaError("metadata must be a plain object", "metadata");
  }
  const metaName = validateString(
    raw.metadata.name,
    "metadata.name",
    REMOTE_GRAPH_LIMITS.maxNameLength,
  );
  const metaDescription = validateString(
    raw.metadata.description,
    "metadata.description",
    REMOTE_GRAPH_LIMITS.maxDescriptionLength,
    false,
  );
  const metaCreatedAt = validateString(
    raw.metadata.createdAt,
    "metadata.createdAt",
    64,
    false,
  );
  const metaUpdatedAt = validateString(
    raw.metadata.updatedAt,
    "metadata.updatedAt",
    64,
    false,
  );

  // nodes
  if (!Array.isArray(raw.nodes)) {
    throw new RemoteSchemaError("nodes must be an array", "nodes");
  }
  if (raw.nodes.length > REMOTE_GRAPH_LIMITS.maxNodes) {
    throw new RemoteSchemaError(
      `node count ${raw.nodes.length} exceeds max ${REMOTE_GRAPH_LIMITS.maxNodes}`,
      "nodes",
    );
  }
  const nodes: Node[] = [];
  const nodeIds = new Set<string>();
  for (let i = 0; i < raw.nodes.length; i++) {
    const node = validateNode(raw.nodes[i], i);
    if (nodeIds.has(node.id)) {
      throw new RemoteSchemaError(`duplicate node id '${node.id}'`, `nodes[${i}]`);
    }
    nodeIds.add(node.id);
    nodes.push(node);
  }

  // edges
  if (!Array.isArray(raw.edges)) {
    throw new RemoteSchemaError("edges must be an array", "edges");
  }
  if (raw.edges.length > REMOTE_GRAPH_LIMITS.maxEdges) {
    throw new RemoteSchemaError(
      `edge count ${raw.edges.length} exceeds max ${REMOTE_GRAPH_LIMITS.maxEdges}`,
      "edges",
    );
  }
  const edges: Edge[] = [];
  let droppedEdges = 0;
  for (let i = 0; i < raw.edges.length; i++) {
    const edge = validateEdge(raw.edges[i], i);
    // Drop edges that reference nodes outside this graph — these are
    // legitimate orphans, not malicious, but they break traversal
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      droppedEdges++;
      continue;
    }
    edges.push(edge);
  }

  const now = new Date().toISOString();
  return {
    data: {
      metadata: {
        name: metaName,
        description: metaDescription,
        createdAt: metaCreatedAt || now,
        updatedAt: metaUpdatedAt || now,
      },
      nodes,
      edges,
    },
    droppedEdges,
  };
}
