import type { Backpack } from "../../core/backpack.js";

/**
 * Format an error from a write tool into an MCP tool response.
 *
 * Special-cases ConcurrencyError by looking up the current lock holder
 * and surfacing it in the response — so the agent knows who they
 * collided with and what to do next.
 */
export async function formatWriteError(
  backpack: Backpack,
  ontology: string,
  err: unknown,
): Promise<{ content: { type: "text"; text: string }[]; isError: true }> {
  const e = err as Error;
  if (e.name === "ConcurrencyError") {
    let lockNote = "";
    try {
      const lock = await backpack.getLockInfo(ontology);
      if (lock) {
        lockNote = `\n\nMost recent editor: ${JSON.stringify(lock, null, 2)}`;
      }
    } catch {}
    return {
      content: [
        {
          type: "text" as const,
          text: `Conflict: another writer modified "${ontology}" since you last read it. Your change was rejected and nothing was committed.${lockNote}\n\nFix: re-read the graph (e.g. backpack_describe), re-apply your change against the fresh state, and retry.`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: `Error: ${e.message}` }],
    isError: true,
  };
}
