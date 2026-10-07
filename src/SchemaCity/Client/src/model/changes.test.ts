import { describe, expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { plannedBaseline } from "../../dev/planned-baseline";
import {
  type ChangeGroups,
  causeLine,
  changeSummary,
  changesCsv,
  changesMarkdown,
  groupChanges,
  plannedFromAliases,
} from "./changes";
import { compareSchemas } from "./snapshots";
import type { SchemaGraph, SchemaNode, SchemaProperty } from "./types";

const medium = mediumFixture as SchemaGraph;

const property = (
  alias: string,
  extra: Partial<SchemaProperty> = {}
): SchemaProperty => ({
  alias,
  name: alias,
  dataTypeId: "text",
  dataTypeName: "Textstring",
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: null,
  mandatory: false,
  variesByCulture: false,
  fromCompositionId: null,
  targets: [],
  ...extra,
});

const node = (
  id: string,
  properties: SchemaProperty[] = [],
  extra: Partial<SchemaNode> = {}
): SchemaNode => ({
  id,
  alias: id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  icon: "icon-document",
  iconColor: null,
  folderId: null,
  isElement: false,
  allowedAsRoot: false,
  variesByCulture: false,
  variesBySegment: false,
  description: null,
  groups: [
    {
      id: `${id}-g`,
      alias: "content",
      name: "Content",
      type: "Group",
      parentAlias: null,
      fromCompositionId: null,
      properties,
    },
  ],
  ownPropertyCount: properties.filter((p) => !p.fromCompositionId).length,
  composedPropertyCount: properties.filter((p) => p.fromCompositionId).length,
  templates: [],
  ...extra,
});

const graph = (
  nodes: SchemaNode[],
  edges: SchemaGraph["edges"] = []
): SchemaGraph => ({
  generatedAt: "2026-10-07T00:00:00Z",
  folders: [],
  nodes,
  edges,
});

/** Every line of every change, as "alias: text", so nothing can go missing. */
const allLines = (groups: ChangeGroups) =>
  groups.causes
    .flatMap((cause) => [
      ...cause.details.map((d) => `${cause.change.alias}: ${d.text}`),
      ...cause.effects.flatMap((effect) =>
        effect.details.map((d) => `${effect.change.alias}: ${d.text}`)
      ),
    ])
    .sort();

const flatLines = (baseline: SchemaGraph, current: SchemaGraph) => {
  const comparison = compareSchemas(baseline, current);
  return [...comparison.added, ...comparison.removed, ...comparison.changed]
    .flatMap((change) =>
      change.details.map((d) => `${change.alias}: ${d.text}`)
    )
    .sort();
};

const causeNames = (groups: ChangeGroups) =>
  groups.causes.map((cause) => cause.change.name);
const effectNames = (groups: ChangeGroups, cause: string) =>
  groups.causes
    .find((c) => c.change.alias === cause)
    ?.effects.map((effect) => effect.change.name);

describe("change causes", () => {
  it("puts the types composing a changed composition under it", () => {
    const seo = (extra: SchemaProperty[]) => [property("title"), ...extra];
    const composed = (extra: SchemaProperty[]) =>
      seo(extra).map((p) => ({ ...p, fromCompositionId: "seo" }));
    const before = graph([
      node("seo", seo([])),
      node("page", composed([])),
      node("blog", composed([])),
    ]);
    const robots = [property("robots")];
    const after = graph([
      node("seo", seo(robots)),
      node("page", composed(robots)),
      node("blog", composed(robots)),
    ]);
    const groups = groupChanges(compareSchemas(before, after));
    expect(causeNames(groups)).toEqual(["Seo"]);
    expect(effectNames(groups, "seo")).toEqual(["Blog", "Page"]);
    expect(changeSummary(groups)).toBe("1 cause, 2 side effects");
    expect(groups.kinds.get("page")).toBe("side effect");
    expect(groups.kinds.get("seo")).toBe("changed");
    // The composed count goes with the composed property it counts.
    expect(groups.causes[0]?.effects[0]?.details.map((d) => d.text)).toContain(
      "composedPropertyCount: 1 -> 2"
    );
    expect(allLines(groups)).toEqual(flatLines(before, after));
  });

  it("puts Element Types under the host whose block list changed, and keeps a type with its own edit a cause", () => {
    const grid = (targets: string[]) =>
      property("grid", {
        targets: targets.map((nodeId) => ({ nodeId, role: "content" })),
      });
    const edges = (targets: string[]) =>
      targets.map((to) => ({
        kind: "block" as const,
        from: "page",
        to,
        propertyAlias: "grid",
      }));
    const before = graph(
      [
        node("page", [grid(["quote"])]),
        node("quote", [], { isElement: true }),
        node("video", [property("url")], { isElement: true }),
      ],
      edges(["quote"])
    );
    const after = graph(
      [
        node("page", [grid(["video"])]),
        node("quote", [], { isElement: true }),
        node("video", [property("url", { mandatory: true })], {
          isElement: true,
        }),
      ],
      edges(["video"])
    );
    const groups = groupChanges(compareSchemas(before, after));
    expect(causeNames(groups)).toEqual(["Page", "Video"]);
    const [page, video] = groups.causes;
    expect(page?.effects.map((e) => [e.change.name, e.alsoCause])).toEqual([
      ["Quote", false],
      ["Video", true],
    ]);
    expect(video?.details.map((d) => d.text)).toEqual([
      "property content.url mandatory: false -> true",
    ]);
    expect(changeSummary(groups)).toBe("2 causes, 1 side effect");
    expect(allLines(groups)).toEqual(flatLines(before, after));
  });

  it("puts a parent's lost allowed child and a picker's lost target under the removed type", () => {
    const before = graph(
      [
        node("landing"),
        node("release"),
        node("news", [
          property("related", {
            targets: [{ nodeId: "release", role: "picker" }],
          }),
        ]),
      ],
      [
        { kind: "allowedChild", from: "landing", to: "release" },
        {
          kind: "reference",
          from: "news",
          to: "release",
          propertyAlias: "related",
        },
        { kind: "allowedChild", from: "release", to: "news" },
      ]
    );
    const after = graph([node("landing"), node("news", [property("related")])]);
    const groups = groupChanges(compareSchemas(before, after));
    expect(causeNames(groups)).toEqual(["Release"]);
    expect(effectNames(groups, "release")).toEqual(["Landing", "News"]);
    expect(groups.kinds.get("release")).toBe("removed");
    expect(allLines(groups)).toEqual(flatLines(before, after));
  });

  it("follows a side effect of a side effect back to its cause", () => {
    // Article's grid gains Video; Release composes Article, so its composed grid
    // and its own block edge to Video change too, and Video's incoming edges both.
    const grid = (targets: string[], from: string | null) =>
      property("grid", {
        fromCompositionId: from,
        targets: targets.map((nodeId) => ({ nodeId, role: "content" })),
      });
    const make = (targets: string[]) =>
      graph(
        [
          node("article", [grid(targets, null)]),
          node("release", [grid(targets, "article")]),
          node("video", [], { isElement: true }),
        ],
        targets.flatMap((to) =>
          ["article", "release"].map((from) => ({
            kind: "block" as const,
            from,
            to,
            propertyAlias: "grid",
          }))
        )
      );
    const before = make([]);
    const after = make(["video"]);
    const groups = groupChanges(compareSchemas(before, after));
    expect(causeNames(groups)).toEqual(["Article"]);
    expect(effectNames(groups, "article")).toEqual(["Release", "Video"]);
    expect(allLines(groups)).toEqual(flatLines(before, after));
  });

  it("keeps a loop of lines that only point at each other as causes", () => {
    const before = graph([node("a"), node("b")]);
    const after = graph(
      [node("a"), node("b")],
      [
        { kind: "inherits", from: "a", to: "b" },
        { kind: "inherits", from: "b", to: "a" },
      ]
    );
    const groups = groupChanges(compareSchemas(before, after));
    expect(causeNames(groups)).toEqual(["A", "B"]);
    expect(allLines(groups)).toEqual(flatLines(before, after));
  });

  it("reads the four planned edits on the medium schema as four causes", () => {
    const baseline = plannedBaseline(medium);
    const comparison = compareSchemas(baseline, medium);
    const groups = groupChanges(comparison);
    expect(causeNames(groups)).toEqual([
      "Press Release",
      "Article",
      "Blog Post",
      "Seo Composition",
    ]);
    const changedTypes =
      comparison.added.length +
      comparison.removed.length +
      comparison.changed.length;
    expect(groups.causes.length + groups.sideEffects).toBe(changedTypes);
    // Every block the new type offers through Article's grid, its parents and the
    // type its picker points at follow from Press Release.
    const press = effectNames(groups, "pressRelease") ?? [];
    expect(press).toContain("Article");
    expect(press).toContain("Press Landing");
    expect(press.filter((name) => name.startsWith("Element"))).toHaveLength(14);
    expect(changeSummary(groups)).toBe("4 causes, 48 side effects");
    expect(effectNames(groups, "seoComposition")).toContain("Home");
    // A cause that is also a side effect says of what, both ways round.
    const alsoOf = (alias: string) =>
      groups.causes
        .find((cause) => cause.change.alias === alias)
        ?.effectOf.map((root) => root.name);
    expect(alsoOf("article")).toEqual(["Press Release", "Seo Composition"]);
    expect(alsoOf("blogPost")).toEqual(["Seo Composition"]);
    expect(alsoOf("pressRelease")).toEqual([]);
    const [, article, blogPost] = groups.causes;
    expect(article && causeLine(article)).toBe(
      "2 edits, 2 side effects, also a side effect of Press Release and Seo Composition"
    );
    expect(blogPost && causeLine(blogPost)).toBe(
      "1 edit, no side effects, also a side effect of Seo Composition"
    );
    expect(allLines(groups)).toEqual(flatLines(baseline, medium));
  });

  it("marks a pasted plan by alias, without case", () => {
    const groups = groupChanges(
      compareSchemas(plannedBaseline(medium), medium)
    );
    expect(
      plannedFromAliases(groups, "pressrelease, seoComposition\nnoSuchType")
    ).toEqual([
      "bf7206eb-f246-1061-80b0-97dedde32777",
      "76bccc6e-b746-508a-d797-4df742a7a61b",
    ]);
  });

  it("exports Markdown and CSV with causes, side effects and the plan", () => {
    const before = graph([node("seo"), node("page")]);
    const after = graph([
      node("seo", [property("robots")], { name: "=Seo" }),
      node("page", [property("robots", { fromCompositionId: "seo" })]),
    ]);
    const groups = groupChanges(compareSchemas(before, after));
    const sides = {
      baseline: "live.example.com, 2026-10-01",
      current: "staging.example.com, 2026-10-07",
    };
    const markdown = changesMarkdown(groups, new Set(["seo"]), sides);
    expect(markdown).toContain("- Baseline: live.example.com, 2026-10-01");
    expect(markdown).toContain("- 1 cause, 1 side effect, 0 unplanned");
    expect(markdown).toContain("- [x] **=Seo** (`seo`), changed, planned");
    expect(markdown).toContain("  - 1 side effect:");
    expect(markdown).toContain(
      "    - Page (`page`): composedPropertyCount: 0 -> 1; property added: content.robots"
    );
    const rows = changesCsv(groups, new Set(), sides).trim().split("\n");
    expect(rows[0]).toBe(
      "Cause,Role,Change,Type,Alias,Detail,Planned,Baseline,Current"
    );
    // The formula guard and the quoting the findings export uses.
    expect(rows[1]).toBe(
      `C1,cause,changed,'=Seo,seo,name: Seo -> =Seo,no,"live.example.com, 2026-10-01","staging.example.com, 2026-10-07"`
    );
    expect(rows[rows.length - 1]).toContain(
      "C1,side effect,side effect,Page,page,"
    );
  });
});
