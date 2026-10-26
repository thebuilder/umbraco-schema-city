// Renders a variant's app against a fixture graph with no Umbraco in the page, through
// the same mount() the backoffice element calls. Each variant's dev/main.tsx starts it.
import type { Decision, DecisionStore } from "@schema-city/core/model/review";
import type { SchemaGraph, UsageReport } from "@schema-city/core/model/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/components/ui/select.tsx";
import type { MountedApp, VariantModule } from "../src/mount.tsx";

// Both fixture kinds in one glob: `<name>.json` is the graph and the
// `<name>-usage.json` next to it, when the site has exported one, is its usage
// report. The endpoints arrive separately in the backoffice too. `medium-planted.json`
// is the seeder's planted findings list for the tests, not a graph.
const fixtures = import.meta.glob<unknown>("../../core/fixtures/*.json", {
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

const fixtureLabel = (path: string) => {
  const name = path
    .slice("../../core/fixtures/".length)
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

/**
 * DEV ONLY. The sample in the path (`/worst-case`), which the app's own URL writes
 * leave alone, so a reload keeps the data under test. The public demo is a
 * production build of this page and does not: a static host has no page at
 * `/worst-case` to reload.
 */
const pathOf = (name: string) => `../../core/fixtures/${name}.json`;
const nameOf = (path: string) =>
  path.slice("../../core/fixtures/".length).replace(JSON_SUFFIX, "");

/** Which look this page is, so the demo can link to the other. */
type Look = "clean" | "city";

/**
 * DEMO ONLY. A link to the same sample and view in the other look: the city plan
 * at the demo's root, the 3D city under /city/. The extension has no such switch,
 * since a site picks one look in appsettings; the link is for visitors to the demo
 * page, so it shows in its build only. The dev server runs each look on its own
 * port, where a relative link would land nowhere. The app's own state is in the
 * query string, which both looks read; the sample goes along as `sample`.
 */
function LookLink({ look, path }: { look: Look; path: string }) {
  const base = import.meta.env.BASE_URL;
  const target = () => {
    const params = new URLSearchParams(location.search);
    params.set("sample", nameOf(path));
    const to = look === "clean" ? `${base}city/` : base.replace(CITY_BASE, "");
    return `${to}?${params}`;
  };
  return (
    <a
      className="demo-picker shrink-0 text-2xs text-phosphor hover:underline"
      href={target()}
      onClick={(event) => {
        event.preventDefault();
        location.assign(target());
      }}
      title="The extension shows one look per site, which SchemaCity:Variant in appsettings picks."
    >
      {look === "clean" ? "View in 3D" : "View the city plan"}
    </a>
  );
}

const CITY_BASE = /city\/$/;

/** The sample another look's link sent, read once and taken off the query string. */
function sentSample() {
  const params = new URLSearchParams(location.search);
  const sample = params.get("sample");
  if (sample === null) return;
  params.delete("sample");
  const query = params.size > 0 ? `?${params}` : "";
  history.replaceState(
    null,
    "",
    `${location.pathname}${query}${location.hash}`
  );
  return sample;
}

/** What the demo page puts in the app's footer: the sample, and the other look. */
function DemoFooter({ path, refocus }: { path: string; refocus: boolean }) {
  return (
    <>
      <SamplePicker path={path} refocus={refocus} />
      {import.meta.env.DEV ? null : <LookLink look={pageLook} path={path} />}
    </>
  );
}

const container = document.querySelector("#app") as HTMLElement;
let mounted: MountedApp | undefined;
let mount: VariantModule["mount"];
let pageLook: Look = "clean";

let latest = "";

// The app reads its opening state once, so a new sample gets a fresh mount. Both
// files load before anything is torn down, and a sample picked meanwhile wins.
async function show(path: string, refocus = false) {
  latest = path;
  const load = fixtures[path] as () => Promise<unknown>;
  const graph = (await load()) as SchemaGraph;
  const usage = usageOf(path);
  const report = usage ? ((await usage()) as UsageReport) : undefined;
  if (latest !== path) return;
  // The app mounts on the path it finds, so the dataset goes there first.
  if (import.meta.env.DEV) {
    const at = `${import.meta.env.BASE_URL}${nameOf(path)}${location.search}`;
    history.replaceState(null, "", at);
  }
  mounted?.unmount();
  mounted = mount(container);
  mounted.render({
    decisions: demoDecisions,
    footer: <DemoFooter path={path} refocus={refocus} />,
    graph,
    icons,
    onOpenDataType: (id) => console.log("schema-city: open Data Type", id),
    onOpenType: (id) => console.log("schema-city: open type", id),
    usage: report,
  });
}

export function startHarness(variant: VariantModule, which: Look) {
  ({ mount } = variant);
  pageLook = which;
  const sent = sentSample();
  const inPath = location.pathname.split("/").filter(Boolean).pop();
  const known = (name: string | undefined) =>
    samples.some((sample) => nameOf(sample) === name);
  const asked = [sent, inPath].find(known);
  void show(pathOf(asked ?? "medium"));
}
