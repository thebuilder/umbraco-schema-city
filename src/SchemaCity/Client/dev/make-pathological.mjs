// Writes dev/fixtures/pathological.json and pathological-usage.json, the stress
// fixture PLAN section 5 has owed since M0: about 300 types carrying every shape the
// city has to survive at once. Run it with `node dev/make-pathological.mjs` from
// Client/; it rewrites both files byte for byte, so a clean tree stays clean unless
// the plan below changed.
//
// Deterministic the same two ways the seeder's medium.json export is: ids are
// name-based guids over the alias, and both timestamps are pinned to the epoch. The
// only pseudo-randomness is one LCG, seeded, used for usage counts where a flat
// number would make the usage lens useless.
//
// What it plants, and what the tests assert:
//   6 top-level folders, 120 / 80 / 45 / 40 / 12 / 3
//   300 types, 40 of them Element Types, 6 roots, 15 with no edge at all
//   two allowedChild cycles: one self-loop and one three-type ring
//   8 rank-skipping allowedChild edges
//   one hub with 60 children, one child with 12 parents
//   10 compositions used by 100 types, 2 used by nothing
//   5 types with no properties, 20 with 30 properties across 6 groups
//   block editors covering every Element Type from 30 hosts, plus 3 broken ones
//   4 types with a property alias arriving from two compositions
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EPOCH = "1970-01-01T00:00:00+00:00";
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * A name-based guid (v5 shape, sha1 over the alias). Umbraco keys are guids and the
 * contract says so, so the fixture cannot use readable ids; deriving them from the
 * alias keeps the file regenerable and every id greppable back to its type.
 */
function guid(name) {
  const bytes = createHash("sha1").update(`schema-city/${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Numeric Recipes' LCG. Seeded, so the usage counts are the same on every run. */
let seed = 20260903;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const between = (low, high) => low + Math.floor(random() * (high - low + 1));

const titleOf = (alias) =>
  alias.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const pad = (n, width = 2) => String(n).padStart(width, "0");
const range = (count, from = 0) => Array.from({ length: count }, (_, i) => i + from);

const ICONS = [
  "icon-document",
  "icon-brick",
  "icon-globe",
  "icon-newspaper",
  "icon-folder",
  "icon-store",
  "icon-users",
  "icon-calendar",
];
const COLORS = [null, "color-blue", null, "color-green", null, "color-orange", null];
const EDITORS = [
  ["Umbraco.TextBox", "Umb.PropertyEditorUi.TextBox"],
  ["Umbraco.TextArea", "Umb.PropertyEditorUi.TextArea"],
  ["Umbraco.TrueFalse", "Umb.PropertyEditorUi.Toggle"],
  ["Umbraco.MediaPicker3", "Umb.PropertyEditorUi.MediaPicker"],
  ["Umbraco.DateTime", "Umb.PropertyEditorUi.DatePicker"],
];

// ------------------------------------------------------------------ folders

const FOLDERS = [
  ["Pages", 120],
  ["Editorial", 80],
  ["Archive", 45],
  ["Elements", 40],
  ["Compositions", 12],
  ["Legacy", 3],
];
const folders = FOLDERS.map(([name]) => ({
  id: guid(`folder/${name}`),
  name,
  parentId: null,
}));
const folderId = Object.fromEntries(folders.map((folder) => [folder.name, folder.id]));

// ------------------------------------------------------------------ types

const nodes = [];
const byAlias = new Map();

function add(alias, folder, extra = {}) {
  const i = nodes.length;
  const node = {
    id: guid(`type/${alias}`),
    alias,
    name: titleOf(alias),
    icon: ICONS[i % ICONS.length],
    iconColor: COLORS[i % COLORS.length],
    folderId: folderId[folder],
    isElement: false,
    allowedAsRoot: false,
    variesByCulture: false,
    variesBySegment: false,
    description: null,
    groups: [],
    ownPropertyCount: 0,
    composedPropertyCount: 0,
    templates: [],
    ...extra,
  };
  nodes.push(node);
  byAlias.set(alias, node);
  return node;
}

const id = (alias) => byAlias.get(alias).id;

// Pages, the huge district: the roots, the hub and its 60 children, the two cycles,
// the deep chain the rank-skipping edges jump over, and a broad tree.
const roots = range(6).map((i) => `root${i}`);
const hubChildren = range(60).map((i) => `hubChild${pad(i)}`);
const pages = range(48).map((i) => `page${pad(i)}`);
for (const alias of roots) add(alias, "Pages", { allowedAsRoot: true });
add("hubPage", "Pages");
for (const alias of hubChildren) add(alias, "Pages");
add("crowdedChild", "Pages");
for (const alias of ["ringA", "ringB", "ringC"]) add(alias, "Pages");
add("selfNesting", "Pages");
for (const alias of pages) add(alias, "Pages");

// Editorial: block hosts, reference hosts and the twenty property-heavy types, on a
// tree of their own that hangs off root0, so the district reads as structure.
const editorial = range(80).map((i) => `editorial${pad(i)}`);
for (const alias of editorial) add(alias, "Editorial");

// Archive: a small tree no root reaches, plus twelve of the fifteen orphans.
const archive = range(33).map((i) => `archive${pad(i)}`);
for (const alias of archive) add(alias, "Archive");
const orphans = range(15).map((i) => `orphan${pad(i)}`);
for (const alias of orphans.slice(0, 12)) add(alias, "Archive");

// Elements: every Element Type, all of them reached by a block editor.
const elements = range(40).map((i) => `block${pad(i)}`);
for (const alias of elements) add(alias, "Elements", { isElement: true });

// Compositions: ten that are used and two that are not.
const mixins = range(10).map((i) => `mixin${pad(i)}`);
const unusedMixins = ["mixinUnusedLegacy", "mixinUnusedDraft"];
for (const alias of [...mixins, ...unusedMixins]) add(alias, "Compositions");

// Legacy, the three-type district.
for (const alias of orphans.slice(12)) add(alias, "Legacy");

// ------------------------------------------------------------------ edges

const edges = [];
const road = (from, to) => edges.push({ kind: "allowedChild", from: id(from), to: id(to) });

road("root0", "hubPage");
for (const child of hubChildren) road("hubPage", child);
// One child with twelve parents, which is what the road layer's three-parent fan
// limit and its "+N parents" marker exist for. The twelfth is root0, below, which
// makes one of them rank-skipping as well.
for (const parent of hubChildren.slice(0, 11)) road(parent, "crowdedChild");

// Cycle one: a three-type ring. Cycle two: a type that allows itself.
road("root1", "ringA");
road("ringA", "ringB");
road("ringB", "ringC");
road("ringC", "ringA");
road("root2", "selfNesting");
road("selfNesting", "selfNesting");

// A chain eleven deep, so a rank-skipping edge has ranks to skip.
road("root3", "page00");
for (let i = 1; i < 12; i++) road(`page${pad(i - 1)}`, `page${pad(i)}`);

// A broad tree over the rest of the pages, reached by the last two roots.
road("root4", "page12");
road("root5", "page24");
for (let i = 13; i < 48; i++) road(`page${pad(12 + Math.floor((i - 13) / 3))}`, `page${pad(i)}`);

// The eight rank-skipping edges, each landing at least two ranks below its parent.
const SKIPS = [
  ["root3", "page02"],
  ["root3", "page04"],
  ["root3", "page06"],
  ["root3", "page08"],
  ["root3", "page10"],
  ["root0", "crowdedChild"],
  ["root0", "hubChild00"],
  ["root1", "ringC"],
];
for (const [from, to] of SKIPS) road(from, to);

// Editorial hangs off root0, so its 80 types rank as structure rather than piling
// into one grid, and the middle band has two districts to order by size.
road("root0", "editorial00");
for (let i = 1; i < 80; i++) road(`editorial${pad(Math.floor((i - 1) / 4))}`, `editorial${pad(i)}`);

// Archive is reachable from nothing, which is the district-with-no-roots case.
for (let i = 1; i < 33; i++) road(`archive${pad(Math.floor((i - 1) / 4))}`, `archive${pad(i)}`);

// Compositions: 100 types use the ten mixins, and four of them use two mixins that
// both contribute the same property alias.
const DUPLICATE_ALIAS = "sharedHeadline";
const dupTypes = ["page00", "page01", "editorial00", "editorial01"];
const composers = [...pages, ...editorial.slice(0, 50), "archive00", "archive01"];
const usedMixins = new Map(
  composers.map((alias, i) => [
    alias,
    dupTypes.includes(alias) ? [mixins[0], mixins[1]] : [mixins[i % 10]],
  ]),
);
for (const [alias, used] of usedMixins)
  for (const mixin of used)
    edges.push({ kind: "composition", from: id(alias), to: id(mixin) });

// The two unused compositions use one themselves, so nothing composes them while the
// only types with no edge at all stay the fifteen orphans.
for (const alias of unusedMixins)
  edges.push({ kind: "composition", from: id(alias), to: id(mixins[0]) });

// inherits, drawn as its own kind and present as a composition too, as the contract says.
const inheritors = range(5, 20).map((i) => `page${pad(i)}`);
for (const alias of inheritors) {
  edges.push({ kind: "inherits", from: id(alias), to: id("page12") });
  edges.push({ kind: "composition", from: id(alias), to: id("page12") });
}

// Block editors: 30 hosts between them reach all 40 Element Types, five of the hosts
// carry a settings block as well, and three point at keys no type has.
const blockHosts = editorial.slice(0, 30);
const blocksOf = new Map(blockHosts.map((alias) => [alias, []]));
elements.forEach((element, i) => {
  blocksOf.get(blockHosts[i % 30]).push({ nodeId: id(element), role: "content" });
});
const settingsHosts = blockHosts.slice(0, 5);
settingsHosts.forEach((alias, i) => {
  blocksOf.get(alias).push({ nodeId: id(elements[i]), role: "settings" });
});
const brokenHosts = blockHosts.slice(27);
const brokenTargets = new Map(
  brokenHosts.map((alias, i) => [alias, guid(`deleted-element/${i}`)]),
);
for (const [alias, targets] of blocksOf)
  for (const target of targets)
    edges.push({
      kind: "block",
      from: id(alias),
      to: target.nodeId,
      propertyAlias: "blocks",
      role: target.role,
    });
for (const [alias, target] of brokenTargets)
  edges.push({
    kind: "block",
    from: id(alias),
    to: target,
    propertyAlias: "legacyBlocks",
    role: "content",
  });

// References: six pickers, two targets each.
const referenceHosts = editorial.slice(30, 36);
const referencesOf = new Map(
  referenceHosts.map((alias, i) => [alias, [pages[i], pages[i + 6]]]),
);
for (const [alias, targets] of referencesOf)
  for (const target of targets)
    edges.push({
      kind: "reference",
      from: id(alias),
      to: id(target),
      propertyAlias: "relatedPages",
    });

// Three cultures on five types, and those five are the ones that vary by culture, so
// the property rows they carry vary too.
const MULTILINGUAL = ["root0", "root1", "hubPage", "page00", "editorial00"];
for (const alias of MULTILINGUAL) byAlias.get(alias).variesByCulture = true;

// ------------------------------------------------------------------ properties

let propertyIndex = 0;
function property(owner, alias, extra = {}) {
  const [editorAlias, editorUiAlias] = EDITORS[propertyIndex++ % EDITORS.length];
  return {
    alias,
    name: titleOf(alias),
    dataTypeId: guid(`datatype/${editorAlias}`),
    editorAlias,
    editorUiAlias,
    mandatory: propertyIndex % 5 === 0,
    variesByCulture: owner.variesByCulture,
    fromCompositionId: null,
    targets: [],
    ...extra,
  };
}

function group(owner, alias, type, properties) {
  return {
    id: guid(`group/${owner.alias}/${alias}`),
    alias,
    name: titleOf(alias),
    type,
    parentAlias: null,
    fromCompositionId: null,
    properties,
  };
}

/** Own aliases are prefixed by the type, so only the planted four ever collide. */
const own = (owner, n) =>
  range(n).map((i) => property(owner, `${owner.alias}Field${pad(i)}`));

// The twenty heavy types: 30 properties over six groups, two of them Tabs.
const heavy = new Set([...hubChildren.slice(0, 10), ...editorial.slice(50, 60)]);
// The five with nothing at all, spread over an orphan district and a reached one.
const empty = new Set(["orphan13", "orphan14", "archive30", "archive31", "archive32"]);

nodes.forEach((node, index) => {
  if (empty.has(node.alias)) return;

  if (heavy.has(node.alias)) {
    node.groups = range(6).map((g) =>
      group(
        node,
        `section${g}`,
        g < 2 ? "Tab" : "Group",
        range(5).map((i) => property(node, `${node.alias}Field${pad(g * 5 + i)}`)),
      ),
    );
    return;
  }

  const properties = own(node, node.isElement ? 2 : 2 + (index % 3));
  if (blocksOf.has(node.alias))
    properties.push(
      property(node, "blocks", { targets: blocksOf.get(node.alias) }),
    );
  if (brokenTargets.has(node.alias))
    properties.push(
      property(node, "legacyBlocks", {
        targets: [{ nodeId: brokenTargets.get(node.alias), role: "content" }],
      }),
    );
  if (referencesOf.has(node.alias))
    properties.push(
      property(node, "relatedPages", {
        targets: referencesOf
          .get(node.alias)
          .map((alias) => ({ nodeId: id(alias), role: "picker" })),
      }),
    );
  node.groups = [group(node, "content", "Tab", properties)];
});

// The first two mixins also contribute the shared alias, which is what turns the four
// types that compose both of them into duplicate-alias findings.
for (const alias of mixins.slice(0, 2)) {
  const mixin = byAlias.get(alias);
  mixin.groups[0].properties.push(property(mixin, DUPLICATE_ALIAS));
}

for (const node of nodes)
  node.ownPropertyCount = node.groups.reduce((sum, g) => sum + g.properties.length, 0);

/** A composed copy of the source's own groups, marked with where they came from. */
function composedGroups(source) {
  // Only the source's own groups: copying what it was itself composed of would hand
  // two types the same alias from two origins and invent duplicate-alias findings.
  return source.groups.filter((g) => g.fromCompositionId === null).map((g) => ({
    ...g,
    id: guid(`group/composed/${source.alias}/${g.alias}`),
    fromCompositionId: source.id,
    properties: g.properties.map((p) => ({ ...p, fromCompositionId: source.id })),
  }));
}

for (const [alias, used] of usedMixins)
  for (const mixin of used) byAlias.get(alias).groups.push(...composedGroups(byAlias.get(mixin)));
for (const alias of inheritors)
  byAlias.get(alias).groups.push(...composedGroups(byAlias.get("page12")));

for (const node of nodes) {
  const composed = node.groups.filter((g) => g.fromCompositionId !== null);
  node.composedPropertyCount = composed.reduce((sum, g) => sum + g.properties.length, 0);
}

// ------------------------------------------------------------------ templates

// Every creatable page type has one, except six left bare so the no-template note has
// something to report. Element Types and compositions never render on their own.
const noTemplate = new Set(range(6, 40).map((i) => `page${pad(i)}`));
for (const node of nodes) {
  if (node.isElement || mixins.includes(node.alias)) continue;
  if (node.alias.startsWith("mixinUnused") || noTemplate.has(node.alias)) continue;
  node.templates = [
    {
      id: guid(`template/${node.alias}`),
      alias: node.alias,
      name: titleOf(node.alias),
      isDefault: true,
    },
  ];
}

// ------------------------------------------------------------------ usage

const busy = ["hubPage", ...roots.slice(0, 5), ...pages.slice(0, 4)];
// editorial00 is in here so all five of the multilingual types have content to be
// multilingual about.
const quiet = ["editorial00", ...hubChildren.slice(10, 25), ...editorial.slice(60, 70)];

const byType = {};
for (const node of nodes)
  byType[node.id] = {
    total: 0,
    published: 0,
    drafts: 0,
    trashed: 0,
    rootInstances: 0,
    cultures: [],
    lastEdited: null,
  };

function fill(alias, total) {
  const node = byAlias.get(alias);
  const trashed = Math.floor(total * 0.04);
  const drafts = Math.floor(total * (random() * 0.3));
  byType[node.id] = {
    total,
    published: total - drafts - trashed,
    drafts,
    trashed,
    rootInstances: node.allowedAsRoot ? between(1, 4) : 0,
    cultures: MULTILINGUAL.includes(alias)
      ? ["en-US", "da-DK", "de-DE"]
      : node.variesByCulture
        ? ["en-US", "da-DK"]
        : ["en-US"],
    lastEdited: EPOCH,
  };
}
for (const alias of busy) fill(alias, between(120, 940));
for (const alias of quiet) fill(alias, between(1, 40));

const references = [
  ["editorial30", "page00"],
  ["editorial30", "page06"],
  ["editorial31", "page01"],
  ["editorial32", "page02"],
  ["hubPage", "page00"],
  ["root0", "hubPage"],
].map(([from, to]) => ({ fromType: id(from), toType: id(to), count: between(1, 90) }));

// ------------------------------------------------------------------ write

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const aliasOf = new Map(nodes.map((node) => [node.id, node.alias]));
nodes.sort((a, b) => order(a.alias, b.alias));
edges.sort(
  (a, b) =>
    order(a.kind, b.kind) ||
    order(aliasOf.get(a.from) ?? a.from, aliasOf.get(b.from) ?? b.from) ||
    order(aliasOf.get(a.to) ?? a.to, aliasOf.get(b.to) ?? b.to) ||
    order(a.propertyAlias ?? "", b.propertyAlias ?? ""),
);

const write = (name, value) =>
  writeFileSync(join(FIXTURES, name), `${JSON.stringify(value, null, 2)}\n`);

write("pathological.json", { generatedAt: EPOCH, folders, nodes, edges });
write("pathological-usage.json", { generatedAt: EPOCH, byType, references });

// ------------------------------------------------------------------ what was planted

const count = (kind) => edges.filter((edge) => edge.kind === kind).length;
const known = new Set(nodes.map((node) => node.id));
const touched = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
console.log(
  [
    `nodes ${nodes.length}, elements ${nodes.filter((n) => n.isElement).length}, roots ${nodes.filter((n) => n.allowedAsRoot).length}`,
    `folders ${folders.map((f) => `${f.name} ${nodes.filter((n) => n.folderId === f.id).length}`).join(", ")}`,
    `edges ${edges.length}: allowedChild ${count("allowedChild")}, composition ${count("composition")}, inherits ${count("inherits")}, block ${count("block")}, reference ${count("reference")}`,
    `broken block targets ${edges.filter((e) => e.kind === "block" && !known.has(e.to)).length}`,
    `types with no edge at all ${nodes.filter((n) => !touched.has(n.id)).length}`,
    `hub children ${edges.filter((e) => e.kind === "allowedChild" && e.from === id("hubPage")).length}, parents of crowdedChild ${edges.filter((e) => e.kind === "allowedChild" && e.to === id("crowdedChild")).length}`,
    `rank-skipping edges ${SKIPS.length}, cycles 2 (one self-loop, one three-type ring)`,
    `compositions used by ${usedMixins.size} types, used by nothing ${nodes.filter((n) => n.alias.startsWith("mixin") && !edges.some((e) => e.kind === "composition" && e.to === n.id)).length}`,
    `types with no properties ${nodes.filter((n) => n.ownPropertyCount + n.composedPropertyCount === 0).length}, with 25 or more ${nodes.filter((n) => n.ownPropertyCount + n.composedPropertyCount >= 25).length}`,
    `types with a duplicate alias ${dupTypes.length} (${DUPLICATE_ALIAS})`,
    `usage: ${Object.values(byType).filter((u) => u.total === 0).length} at zero, ${Object.values(byType).filter((u) => u.total >= 100).length} in the hundreds, ${Object.values(byType).filter((u) => u.cultures.length === 3).length} with three cultures, ${references.length} references`,
  ].join("\n"),
);
