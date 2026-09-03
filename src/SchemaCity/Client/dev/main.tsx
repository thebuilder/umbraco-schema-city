// Renders the same React app as the workspace element, against a fixture graph and
// with no Umbraco in the page. The stylesheet is adopted on the document because
// there is no shadow root here.
import { createRoot } from "react-dom/client";
import { App } from "../src/app/App.tsx";
import appStyles from "../src/app/styles.css?inline";
import type { SchemaGraph } from "../src/model/types.ts";

const sheet = new CSSStyleSheet();
sheet.replaceSync(appStyles);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

const fixtures = import.meta.glob<SchemaGraph>("./fixtures/*.json", {
  import: "default",
});

const picker = document.querySelector("select") as HTMLSelectElement;
const root = createRoot(document.querySelector("#app") as HTMLElement);

for (const path of Object.keys(fixtures).sort()) {
  picker.add(new Option(path.slice("./fixtures/".length), path));
}

async function show(path: string) {
  const graph = await fixtures[path]!();
  root.render(
    <App
      graph={graph}
      onOpenType={(id) => console.log("schema-city: open type", id)}
    />,
  );
}

picker.addEventListener("change", () => void show(picker.value));
void show(picker.value);
