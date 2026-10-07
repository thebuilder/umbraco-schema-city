// Renders the same React app as the workspace element, against a fixture graph and
// with no Umbraco in the page. The stylesheet is adopted on the document because
// there is no shadow root here.
import { createRoot } from "react-dom/client";
import { App } from "../src/app/App.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/app/components/ui/select.tsx";
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

const root = createRoot(document.querySelector("#app") as HTMLElement);

const fixtureLabel = (path: string) => {
  const name = path
    .slice("./fixtures/".length)
    .replace(JSON_SUFFIX, "")
    .replace(/-/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} schema`;
};

const samples = Object.keys(fixtures)
  .sort()
  .filter(
    (path) => !(path.endsWith("-usage.json") || path.endsWith("-planted.json"))
  );

/**
 * The sample picker, in the app's own footer rather than a second bar under it.
 * The app remounts on a new sample, and the picker with it, so it takes focus back
 * when it was the control that changed.
 */
function SamplePicker({ path, refocus }: { path: string; refocus: boolean }) {
  const items = samples.map((sample) => ({
    value: sample,
    label: fixtureLabel(sample),
  }));
  return (
    // The same Select the footer's Group and Lens use, so the demo's own control
    // looks like the rest of the bar. `.demo-picker` keeps it out of the shots.
    // biome-ignore lint/a11y/noLabelWithoutControl: the Select this label names is its child, one JSX level below what the rule reads.
    <label className="demo-picker flex shrink-0 items-center gap-1.5 font-bold text-2xs text-phosphor-dim uppercase tracking-terminal">
      Sample schema
      <Select
        items={items}
        onValueChange={(value) => void show(value as string, true)}
        value={path}
      >
        <SelectTrigger
          aria-label="Sample schema"
          autoFocus={refocus}
          className="text-2xs uppercase tracking-terminal"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(({ value, label }) => (
            <SelectItem
              className="text-2xs uppercase tracking-terminal"
              key={value}
              value={value}
            >
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

async function show(path: string, refocus = false) {
  const load = fixtures[path] as () => Promise<unknown>;
  const graph = (await load()) as SchemaGraph;
  const usage = usageOf(path);
  root.render(
    <App
      decisions={demoDecisions}
      footer={<SamplePicker path={path} refocus={refocus} />}
      graph={graph}
      icons={icons}
      key={path}
      onOpenDataType={(id) => console.log("schema-city: open Data Type", id)}
      onOpenType={(id) => console.log("schema-city: open type", id)}
      usage={usage ? ((await usage()) as UsageReport) : undefined}
    />
  );
}

void show(samples[0]);
