import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Backpack } from "../src/core/backpack.js";
import { JsonFileBackend } from "../src/storage/json-file-backend.js";

describe("Backpack (end-to-end)", () => {
  let tmpDir: string;
  let backpack: Backpack;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "backpack-e2e-"));
    const backend = new JsonFileBackend(tmpDir);
    backpack = new Backpack(backend);
    await backpack.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true });
  });

  it("full lifecycle: create ontology, add nodes and edges, query, delete", async () => {
    // Create
    const meta = await backpack.createOntology("cooking", "Recipes and such");
    expect(meta.name).toBe("cooking");

    // List ontologies
    const list = await backpack.listOntologies();
    expect(list.length).toBe(1);
    expect(list[0].nodeCount).toBe(0);

    // Add nodes
    const garlic = await backpack.addNode("cooking", "Ingredient", {
      name: "garlic",
      category: "aromatic",
    });
    const pasta = await backpack.addNode("cooking", "Recipe", {
      name: "Aglio e Olio",
      servings: 2,
    });
    const oil = await backpack.addNode("cooking", "Ingredient", {
      name: "olive oil",
      category: "fat",
    });

    expect(garlic.id).toMatch(/^n_/);
    expect(pasta.type).toBe("Recipe");

    // Add edges
    const edge1 = await backpack.addEdge(
      "cooking",
      "USED_IN",
      garlic.id,
      pasta.id,
      { amount: "4 cloves" }
    );
    const edge2 = await backpack.addEdge(
      "cooking",
      "USED_IN",
      oil.id,
      pasta.id,
      { amount: "1/3 cup" }
    );

    expect(edge1.id).toMatch(/^e_/);

    // List node types
    const types = await backpack.getNodeTypes("cooking");
    expect(types.length).toBe(2);
    expect(types.find((t) => t.type === "Ingredient")?.count).toBe(2);

    // List nodes (summaries only)
    const allNodes = await backpack.listNodes("cooking");
    expect(allNodes.total).toBe(3);
    expect(allNodes.nodes.every((n) => "label" in n && !("properties" in n))).toBe(
      true
    );

    // Filter by type
    const ingredients = await backpack.listNodes("cooking", "Ingredient");
    expect(ingredients.total).toBe(2);

    // Get full node with edges
    const fullGarlic = await backpack.getNode("cooking", garlic.id);
    expect(fullGarlic.node.properties.name).toBe("garlic");
    expect(fullGarlic.edges.length).toBe(1);

    // Search
    const searchResults = await backpack.searchNodes("cooking", "garlic");
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].id).toBe(garlic.id);

    // Get neighbors
    const neighbors = await backpack.getNeighbors("cooking", pasta.id);
    expect(neighbors.neighbors.length).toBe(2); // garlic + oil

    // Update node
    const updated = await backpack.updateNode("cooking", garlic.id, {
      organic: true,
    });
    expect(updated.properties.organic).toBe(true);
    expect(updated.properties.name).toBe("garlic"); // Original props kept

    // Remove edge
    await backpack.removeEdge("cooking", edge1.id);
    const afterRemoveEdge = await backpack.getNode("cooking", garlic.id);
    expect(afterRemoveEdge.edges.length).toBe(0);

    // Remove node (should cascade remaining edge)
    const { removedEdges } = await backpack.removeNode("cooking", oil.id);
    expect(removedEdges).toBe(1); // edge2 was connected

    // Verify persistence — data survives reload
    const freshBackend = new JsonFileBackend(tmpDir);
    const freshBackpack = new Backpack(freshBackend);
    await freshBackpack.initialize();

    const reloadedList = await freshBackpack.listOntologies();
    expect(reloadedList[0].nodeCount).toBe(2); // garlic + pasta remain, oil was removed

    const reloadedNodes = await freshBackpack.listNodes("cooking");
    expect(reloadedNodes.total).toBe(2);

    // Delete ontology
    await backpack.deleteOntology("cooking");
    const afterDelete = await backpack.listOntologies();
    expect(afterDelete.length).toBe(0);
  });

  it("bulk import nodes", async () => {
    await backpack.createOntology("test", "Test");

    const result = await backpack.importNodes("test", [
      { type: "Person", properties: { name: "Alice" } },
      { type: "Person", properties: { name: "Bob" } },
      { type: "City", properties: { name: "Berlin" } },
    ]);

    expect(result.count).toBe(3);
    expect(result.ids.length).toBe(3);
    expect(result.ids.every((id) => id.startsWith("n_"))).toBe(true);

    const list = await backpack.listNodes("test");
    expect(list.total).toBe(3);
  });

  it("describe ontology returns structure without instance data", async () => {
    await backpack.createOntology("test", "Test");
    await backpack.addNode("test", "Person", { name: "Alice" });
    await backpack.addNode("test", "Person", { name: "Bob" });
    await backpack.addNode("test", "City", { name: "Berlin" });

    const desc = await backpack.describeOntology("test");
    expect(desc.nodeCount).toBe(3);
    expect(desc.nodeTypes.length).toBe(2);
    expect(desc.metadata.name).toBe("test");
    // No node instances in the response
    expect("nodes" in desc).toBe(false);
  });
});
