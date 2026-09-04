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
const usageOf = (path: string) =>
  fixtures[path.replace(/\.json$/, "-usage.json")];

// Two hand-drawn stand-ins for the backoffice icon registry, which is where the
// wrappers read the real ones. Two is enough to see roof icons work: the seeded
// schema's brick and globe cover 22 of its 78 types, and every other type has no
// entry here, which is the missing-icon case.
const icons = {
  "icon-brick":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<path fill="currentColor" d="M2 5h12v6H2zM17 5h13v6H17zM2 13h18v6H2zM23 13h7v6h-7z' +
    'M2 21h9v6H2zM14 21h16v6H14z"/></svg>',
  "icon-globe":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4">' +
    '<circle cx="16" cy="16" r="13"/><ellipse cx="16" cy="16" rx="6.5" ry="13"/>' +
    '<path d="M3.6 11h24.8M3.6 21h24.8"/></svg>',
};

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
      icons={icons}
      onOpenType={(id) => console.log("schema-city: open type", id)}
      usage={usage ? ((await usage()) as UsageReport) : undefined}
    />
  );
}

picker.addEventListener("change", () => void show(picker.value));
void show(picker.value);
