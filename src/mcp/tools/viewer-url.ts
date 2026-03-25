/**
 * Generate a viewer deep link URL for specific nodes in a graph.
 * Local viewer runs on localhost:5173 with hash-based routing.
 */
export function viewerUrl(graphName: string, nodeIds: string[]): string {
  const base = "http://localhost:5173";
  const hash = encodeURIComponent(graphName);
  if (nodeIds.length === 0) return `${base}#${hash}`;
  return `${base}#${hash}?node=${nodeIds.map(encodeURIComponent).join(",")}`;
}
