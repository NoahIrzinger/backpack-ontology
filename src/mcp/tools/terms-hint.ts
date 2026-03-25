/**
 * Format raw terms.json content into a concise hint for the LLM.
 * Appended to tool responses so Claude conforms to existing terms.
 */
export function formatTermsHint(termsJson: string): string {
  try {
    const terms = JSON.parse(termsJson) as {
      types?: { name: string; count: number }[];
      edgeTypes?: { name: string; count: number }[];
      entities?: { name: string; type: string }[];
    };

    const parts: string[] = ["[Term Registry — match these exactly when possible]"];

    if (terms.types?.length) {
      parts.push(
        "Node types: " +
          terms.types.map((t) => `${t.name} (${t.count})`).join(", ")
      );
    }

    if (terms.edgeTypes?.length) {
      parts.push(
        "Edge types: " +
          terms.edgeTypes.map((t) => `${t.name} (${t.count})`).join(", ")
      );
    }

    if (terms.entities?.length) {
      const MAX = 50;
      const shown = terms.entities.slice(0, MAX);
      const line =
        "Entities: " +
        shown.map((e) => `${e.name} (${e.type})`).join(", ");
      parts.push(
        terms.entities.length > MAX
          ? line + `, ... and ${terms.entities.length - MAX} more`
          : line
      );
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}
