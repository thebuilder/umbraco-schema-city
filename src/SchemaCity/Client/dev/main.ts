// Renders a fixture graph without Umbraco, so the scene can be built against
// known data. M1 replaces the list with the three.js city.
import type { SchemaGraph } from "../src/model/types.ts";

const fixtures = import.meta.glob<SchemaGraph>("./fixtures/*.json", {
  import: "default",
});

const picker = document.querySelector("select")!;
const count = document.querySelector("p")!;
const list = document.querySelector("ul")!;

for (const path of Object.keys(fixtures).sort()) {
  picker.add(new Option(path.slice("./fixtures/".length), path));
}

async function show(path: string) {
  const graph = await fixtures[path]!();

  count.textContent = `${graph.nodes.length} nodes, generated ${graph.generatedAt}`;
  list.replaceChildren(
    ...graph.nodes.map((node) => {
      const badges = [
        node.isElement ? "element" : null,
        node.allowedAsRoot ? "root" : null,
      ].filter(Boolean);

      // Names and aliases come from a host's schema, so they are written as
      // text and never as HTML.
      const row = document.createElement("li");
      row.textContent = `${node.name} (${node.alias})${badges.length ? ` [${badges.join(", ")}]` : ""}`;
      return row;
    }),
  );
}

picker.addEventListener("change", () => void show(picker.value));
void show(picker.value);
