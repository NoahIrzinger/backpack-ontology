import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backpack } from "../../core/backpack.js";
import { trackEvent } from "../../core/telemetry.js";
import { formatTermsHint } from "./terms-hint.js";
import { formatWriteError } from "./error-helpers.js";

export function registerBulkTools(
  server: McpServer,
  backpack: Backpack
): void {
  server.registerTool(
    "backpack_import_nodes",
    {
      title: "Import Nodes",
      description:
        "Add multiple items and their relationships to a learning graph in one call. The batch is validated first: errors block the commit, warnings (type drift, duplicates, three-role rule violations) are surfaced in the response. Pass dryRun=true to get the validation result without committing. Edges reference new nodes by array index (0-based) or existing nodes by ID string.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        nodes: z
          .array(
            z.object({
              type: z.string().describe("Node type"),
              properties: z
                .record(z.string(), z.unknown())
                .describe("Key-value pairs for the node"),
              source: z
                .string()
                .optional()
                .describe(
                  "Optional pointer to original data (URL, file path, system:resource). Automatically attached as source metadata."
                ),
              sourceType: z
                .string()
                .optional()
                .describe(
                  "Optional system that owns this data (e.g. 'web', 'email', 'jira', 'slack', 'document')"
                ),
              sourceReference: z
                .string()
                .optional()
                .describe(
                  "Optional human-readable context from the source (e.g. 'Team page', 'Subject: Q2 planning')"
                ),
            })
          )
          .describe("Array of nodes to import"),
        edges: z
          .array(
            z.object({
              type: z
                .string()
                .describe("Edge type (e.g. 'DEPENDS_ON', 'CONTAINS')"),
              source: z
                .union([z.number().int().nonnegative(), z.string()])
                .describe(
                  "Source: integer index into the nodes array (0-based) for a new node, or a string node ID for an existing node"
                ),
              target: z
                .union([z.number().int().nonnegative(), z.string()])
                .describe(
                  "Target: integer index into the nodes array (0-based) for a new node, or a string node ID for an existing node"
                ),
              properties: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Optional key-value pairs for this edge"),
              sourcePointer: z
                .string()
                .optional()
                .describe(
                  "Optional pointer to original data source for this relationship"
                ),
            })
          )
          .optional()
          .describe(
            "Optional array of edges to create between imported and/or existing nodes"
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "If true, validate and return warnings/errors without committing. Use this to review a batch before writing."
          ),
      },
    },
    async ({ ontology, nodes, edges, dryRun }) => {
      try {
        // Attach source metadata to nodes if provided
        const proposedNodes = (nodes as Array<{
          type: string;
          properties: Record<string, unknown>;
          source?: string;
          sourceType?: string;
          sourceReference?: string;
        }>).map((node) => {
          const props = { ...node.properties };
          if (node.source) {
            props.source = node.source;
            if (node.sourceType) props.source_type = node.sourceType;
            if (node.sourceReference) props.source_reference = node.sourceReference;
            // Add ISO timestamp for source_date
            props.source_date = new Date().toISOString();
          }
          return { type: node.type, properties: props };
        });

        const proposedEdges = edges as
          | Array<{
              type: string;
              source: number | string;
              target: number | string;
              properties?: Record<string, unknown>;
              sourcePointer?: string;
            }>
          | undefined;

        // Attach source metadata to edges if provided
        const edgesWithSource = proposedEdges?.map((edge) => {
          const props = { ...edge.properties };
          if (edge.sourcePointer) {
            props.source = edge.sourcePointer;
          }
          return { ...edge, properties: props };
        });

        // Always validate the batch before any write
        const validation = await backpack.validateImport(
          ontology,
          proposedNodes,
          edgesWithSource ?? [],
        );

        // Errors block the commit regardless of dryRun
        if (!validation.ok) {
          trackEvent("tool_call", {
            tool: "backpack_import_nodes",
            outcome: "validation_error",
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Import refused: ${validation.errors.length} error(s).\n${JSON.stringify(
                  { errors: validation.errors, warnings: validation.warnings },
                  null,
                  2,
                )}\n\nFix the errors and retry.`,
              },
            ],
            isError: true,
          };
        }

        // Dry run — return validation result without writing
        if (dryRun) {
          trackEvent("tool_call", {
            tool: "backpack_import_nodes",
            outcome: "dry_run",
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Dry run OK. Would import ${validation.newNodeCount} node(s) and ${validation.newEdgeCount} edge(s).${
                  validation.warnings.length > 0
                    ? `\n\n${validation.warnings.length} warning(s):\n${JSON.stringify(validation.warnings, null, 2)}\n\nReview the warnings, then call again with dryRun=false (or omit) to commit.`
                    : "\n\nNo warnings — safe to commit."
                }`,
              },
            ],
          };
        }

        // Commit
        const result = await backpack.importNodes(
          ontology,
          proposedNodes,
          edgesWithSource,
        );
        trackEvent("tool_call", { tool: "backpack_import_nodes" });
        const terms = await backpack.getTermsContext(ontology);
        const summary = `Imported ${result.count} node(s) and ${result.edgeCount} edge(s).\nNode IDs: ${JSON.stringify(result.ids)}\nEdge IDs: ${JSON.stringify(result.edgeIds)}`;
        const warningsSection =
          validation.warnings.length > 0
            ? `\n\n${validation.warnings.length} warning(s) to review (committed anyway):\n${JSON.stringify(validation.warnings, null, 2)}`
            : "";
        const content: { type: "text"; text: string }[] = [
          {
            type: "text" as const,
            text: summary + warningsSection,
          },
        ];
        if (terms) {
          content.push({ type: "text" as const, text: formatTermsHint(terms) });
        }
        return { content };
      } catch (err) {
        return formatWriteError(backpack, ontology, err);
      }
    }
  );

  server.registerTool(
    "backpack_connect",
    {
      title: "Connect Nodes",
      description:
        "Add multiple edges between existing nodes in a single call. Use this to bulk-add relationships — all source and target node IDs must already exist.",
      inputSchema: {
        ontology: z.string().describe("Name of the learning graph"),
        edges: z
          .array(
            z.object({
              type: z.string().describe("Edge type (e.g. 'DEPENDS_ON', 'SERVES_ON')"),
              sourceId: z.string().describe("ID of the source node"),
              targetId: z.string().describe("ID of the target node"),
              properties: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Optional key-value pairs for this edge"),
            })
          )
          .describe("Array of edges to create between existing nodes"),
      },
    },
    async ({ ontology, edges }) => {
      try {
        const result = await backpack.connectEdges(
          ontology,
          edges as Array<{
            type: string;
            sourceId: string;
            targetId: string;
            properties?: Record<string, unknown>;
          }>
        );
        trackEvent("tool_call", { tool: "backpack_connect" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created ${result.count} edge(s).\nIDs: ${JSON.stringify(result.ids)}`,
            },
          ],
        };
      } catch (err) {
        return formatWriteError(backpack, ontology, err);
      }
    }
  );

  server.registerTool(
    "backpack_extract",
    {
      title: "Extract Subgraph",
      description:
        "Extract a subgraph (selected nodes + auto-detected edges) into a new learning graph. Node IDs are preserved.",
      inputSchema: {
        ontology: z.string().describe("Source learning graph"),
        nodeIds: z
          .array(z.string())
          .describe("Node IDs to extract"),
        newName: z.string().describe("Name for the new learning graph"),
        description: z
          .string()
          .optional()
          .describe("Description for the new graph"),
      },
    },
    async ({ ontology, nodeIds, newName, description }) => {
      try {
        const result = await backpack.extractSubgraph(
          ontology,
          nodeIds as string[],
          newName,
          description
        );
        trackEvent("tool_call", { tool: "backpack_extract" });
        return {
          content: [
            {
              type: "text" as const,
              text: `Created learning graph "${newName}" with ${result.nodeCount} node(s) and ${result.edgeCount} edge(s).`,
            },
          ],
        };
      } catch (err) {
        return formatWriteError(backpack, ontology, err);
      }
    }
  );
}
