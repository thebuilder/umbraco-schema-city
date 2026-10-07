// Renders the same React app as the workspace element, against a fixture graph and
// with no Umbraco in the page. The stylesheet is adopted on the document because
// there is no shadow root here.
import { createRoot } from "react-dom/client";
import { App } from "../src/app/App.tsx";
import appStyles from "../src/app/styles.css?inline";
import type { Decision, DecisionStore } from "../src/model/review.ts";
import type { SchemaGraph, UsageReport } from "../src/model/types.ts";

const sheet = new CSSStyleSheet();
sheet.replaceSync(appStyles);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

// Both fixture kinds in one glob: `<name>.json` is the graph and the
// `<name>-usage.json` next to it, when the site has exported one, is its usage
// report. The endpoints arrive separately in the backoffice too. `medium-planted.json`
// is the seeder's planted findings list for the tests, not a graph.
const fixtures = import.meta.glob<unknown>("./fixtures/*.json", {
  import: "default",
});
const JSON_SUFFIX = /\.json$/;
const usageOf = (path: string) =>
  fixtures[path.replace(JSON_SUFFIX, "-usage.json")];

// Two hand-drawn stand-ins for the backoffice icon registry, which is where the
// wrappers read the real ones. Two is enough to see roof icons work: the seeded
// schema's brick and globe cover 24 of its 86 types, and every other type has no
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

// LOCAL TO THIS DEMO PAGE. The harness has no server, so review decisions live in
// memory under a made-up user and are gone on reload. In the backoffice they are
// kept in Umbraco's key-value table through the decisions endpoint.
const saved = new Map<string, Decision>();
const demoDecisions: DecisionStore = {
  load: () => Promise.resolve([...saved.values()]),
  save: (findingId, reason, fingerprint) => {
    const decision: Decision = {
      findingId,
      status: "intentional",
      reason,
      decidedBy: "Demo user",
      decidedByKey: "00000000-0000-0000-0000-000000000000",
      decidedAt: new Date().toISOString(),
      fingerprint,
    };
    saved.set(findingId, decision);
    return Promise.resolve(decision);
  },
  remove: (findingId) => {
    saved.delete(findingId);
    return Promise.resolve();
  },
};

const picker = document.querySelector("select") as HTMLSelectElement;
const root = createRoot(document.querySelector("#app") as HTMLElement);

const fixtureLabel = (path: string) => {
  const name = path
    .slice("./fixtures/".length)
    .replace(JSON_SUFFIX, "")
    .replace(/-/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} schema`;
};

for (const path of Object.keys(fixtures).sort()) {
  if (path.endsWith("-usage.json") || path.endsWith("-planted.json")) continue;
  picker.add(new Option(fixtureLabel(path), path));
}

async function show(path: string) {
  const load = fixtures[path] as () => Promise<unknown>;
  const graph = (await load()) as SchemaGraph;
  const usage = usageOf(path);
  root.render(
    <App
      decisions={demoDecisions}
      graph={graph}
      icons={icons}
      key={path}
      onOpenDataType={(id) => console.log("schema-city: open Data Type", id)}
      onOpenType={(id) => console.log("schema-city: open type", id)}
      usage={usage ? ((await usage()) as UsageReport) : undefined}
    />
  );
}

picker.addEventListener("change", () => void show(picker.value));
void show(picker.value);
