// Renders the same React app as the workspace element, against a fixture graph and
// with no Umbraco in the page. The stylesheet is adopted on the document because
// there is no shadow root here.
import { createRoot } from "react-dom/client";
import { App } from "../src/app/App.tsx";
import appStyles from "../src/app/styles.css?inline";
import type { SchemaGraph, UsageReport } from "../src/model/types.ts";

const sheet = new CSSStyleSheet();
sheet.replaceSync(appStyles);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

// Both fixture kinds in one glob: `<name>.json` is the graph and the
// `<name>-usage.json` next to it, when the site has exported one, is its usage
// report. The endpoints arrive separately in the backoffice too.
const fixtures = import.meta.glob<unknown>("./fixtures/*.json", {
  import: "default",
});
const usageOf = (path: string) => fixtures[path.replace(/\.json$/, "-usage.json")];

const picker = document.querySelector("select") as HTMLSelectElement;
const root = createRoot(document.querySelector("#app") as HTMLElement);

for (const path of Object.keys(fixtures).sort()) {
  if (path.endsWith("-usage.json")) continue;
  picker.add(new Option(path.slice("./fixtures/".length), path));
}

async function show(path: string) {
  const graph = (await fixtures[path]!()) as SchemaGraph;
  const usage = usageOf(path);
  root.render(
    <App
      graph={graph}
      onOpenType={(id) => console.log("schema-city: open type", id)}
      usage={usage ? ((await usage()) as UsageReport) : undefined}
    />,
  );
}

picker.addEventListener("change", () => void show(picker.value));
void show(picker.value);
