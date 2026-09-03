import { describe, expect, it } from "vitest";
import mediumUsageFixture from "../../dev/fixtures/medium-usage.json";
import mediumFixture from "../../dev/fixtures/medium.json";
import smallFixture from "../../dev/fixtures/small.json";
import { type FindingKind, findFindings } from "./findings";
import type {
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
  UsageReport,
} from "./types";

const small = smallFixture as unknown as SchemaGraph;
const medium = mediumFixture as unknown as SchemaGraph;
const mediumUsage = mediumUsageFixture as unknown as UsageReport;

function node(alias: string, extra: Partial<SchemaNode> = {}): SchemaNode {
  return {
    id: alias,
    alias,
    name: alias,
    icon: "icon-document",
    iconColor: null,
    folderId: null,
    isElement: false,
    allowedAsRoot: false,
    variesByCulture: false,
    variesBySegment: false,
    description: null,
    groups: [],
    ownPropertyCount: 1,
    composedPropertyCount: 0,
    templates: [{ id: "t", alias: "t", name: "T", isDefault: true }],
    ...extra,
  };
}

const property = (alias: string, fromCompositionId: string | null): SchemaProperty => ({
  alias,
  name: alias,
  dataTypeId: "dt",
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: null,
  mandatory: false,
  variesByCulture: false,
  fromCompositionId,
  targets: [],
});

const group = (alias: string, properties: SchemaProperty[]) => ({
  id: alias,
  alias,
  name: alias,
  type: "Group" as const,
  parentAlias: null,
  fromCompositionId: null,
  properties,
});

const graphOf = (nodes: SchemaNode[], edges: SchemaEdge[] = []): SchemaGraph => ({
  generatedAt: "2026-09-03T00:00:00Z",
  folders: [],
  nodes,
  edges,
});

const edge = (kind: SchemaEdge["kind"], from: string, to: string, propertyAlias?: string) =>
  ({ kind, from, to, ...(propertyAlias ? { propertyAlias } : {}) }) as SchemaEdge;

/** Every type has content, unless `zero` names it. */
function usageOf(graph: SchemaGraph, zero: string[] = []): UsageReport {
  const byType: UsageReport["byType"] = {};
  for (const candidate of graph.nodes) {
    const total = zero.includes(candidate.alias) ? 0 : 7;
    byType[candidate.id] = {
      total,
      published: total,
      drafts: 0,
      trashed: 0,
      rootInstances: 0,
      cultures: [],
      lastEdited: total > 0 ? "2026-09-01T10:00:00Z" : null,
    };
  }
  return { generatedAt: "2026-09-03T00:00:00Z", byType, references: [] };
}

/** The kinds reported against one node, which is what each rule test asserts on. */
const kindsFor = (graph: SchemaGraph, alias: string, usage?: UsageReport): FindingKind[] =>
  findFindings(graph, usage)
    .filter((finding) => finding.nodeId === alias)
    .map((finding) => finding.kind);

const aliasesFor = (graph: SchemaGraph, kind: FindingKind, usage?: UsageReport) =>
  findFindings(graph, usage)
    .filter((finding) => finding.kind === kind)
    .map((finding) => finding.nodeId)
    .sort();

describe("findFindings, one rule at a time", () => {
  it("reports a type with no content, only when usage says so", () => {
    const graph = graphOf([node("home", { allowedAsRoot: true })]);
    expect(kindsFor(graph, "home")).not.toContain("unusedType");
    expect(kindsFor(graph, "home", usageOf(graph, ["home"]))).toContain("unusedType");
    expect(kindsFor(graph, "home", usageOf(graph))).not.toContain("unusedType");
  });

  it("reports an Element Type no block editor points at", () => {
    const graph = graphOf(
      [
        node("host", { allowedAsRoot: true }),
        node("used", { isElement: true }),
        node("spare", { isElement: true }),
      ],
      [edge("block", "host", "used", "blocks")],
    );
    expect(aliasesFor(graph, "unusedElementType")).toEqual(["spare"]);
  });

  it("reports a type no editor can create and nothing composes", () => {
    const graph = graphOf(
      [node("home", { allowedAsRoot: true }), node("child"), node("orphan")],
      [edge("allowedChild", "home", "child")],
    );
    expect(aliasesFor(graph, "deadEnd")).toEqual(["orphan"]);
  });

  it("leaves a composed type off the dead ends, whatever usage says", () => {
    const graph = graphOf(
      [node("page", { allowedAsRoot: true }), node("seo"), node("lonely")],
      [edge("composition", "page", "seo")],
    );
    expect(aliasesFor(graph, "deadEnd")).toEqual(["lonely"]);
    expect(aliasesFor(graph, "deadEnd", usageOf(graph))).toEqual(["lonely"]);
    // seo is composed, so it is the pure mixin note and nothing else.
    expect(kindsFor(graph, "seo")).toEqual(["pureMixin"]);
  });

  it("reports a property alias two compositions both contribute", () => {
    const graph = graphOf([
      node("page", {
        allowedAsRoot: true,
        groups: [
          group("seo", [property("seoTitle", "seoA")]),
          group("mirror", [property("seoTitle", "seoB")]),
        ],
      }),
    ]);
    const [finding] = findFindings(graph).filter((f) => f.kind === "duplicateAlias");
    expect(finding?.summary).toContain("seoTitle");
    expect(finding?.related).toEqual(["seoA", "seoB"]);
  });

  it("leaves one alias from one composition alone", () => {
    const graph = graphOf([
      node("page", {
        allowedAsRoot: true,
        groups: [
          group("seo", [property("seoTitle", "seoA"), property("seoBody", "seoA")]),
        ],
      }),
    ]);
    expect(aliasesFor(graph, "duplicateAlias")).toEqual([]);
  });

  it("reports a block target that resolves to no type", () => {
    const graph = graphOf(
      [node("host", { allowedAsRoot: true })],
      [edge("block", "host", "deleted-key", "blocks")],
    );
    const [finding] = findFindings(graph).filter((f) => f.kind === "brokenBlock");
    expect(finding?.nodeId).toBe("host");
    expect(finding?.related).toEqual(["deleted-key"]);
    expect(finding?.summary).toContain("blocks");
  });

  it("reports a type with no properties at all", () => {
    const graph = graphOf([
      node("empty", { allowedAsRoot: true, ownPropertyCount: 0 }),
      node("full", { allowedAsRoot: true, composedPropertyCount: 3, ownPropertyCount: 0 }),
    ]);
    expect(aliasesFor(graph, "noProperties")).toEqual(["empty"]);
  });

  it("reports a type with no template as a note", () => {
    const graph = graphOf([
      node("bare", { allowedAsRoot: true, templates: [] }),
      node("templated", { allowedAsRoot: true }),
      node("element", { isElement: true, templates: [] }),
    ]);
    const [finding] = findFindings(graph).filter((f) => f.kind === "noTemplate");
    expect(finding?.nodeId).toBe("bare");
    expect(finding?.severity).toBe("note");
  });

  it("says nothing about templates on a schema that has none, or about a mixin", () => {
    const headless = graphOf([node("home", { allowedAsRoot: true, templates: [] })]);
    expect(aliasesFor(headless, "noTemplate")).toEqual([]);
    const mixin = graphOf(
      [node("page", { allowedAsRoot: true }), node("seo", { templates: [] })],
      [edge("composition", "page", "seo")],
    );
    expect(aliasesFor(mixin, "noTemplate")).toEqual([]);
  });

  it("reports a composition that is only ever composed", () => {
    const graph = graphOf(
      [node("page", { allowedAsRoot: true }), node("seo")],
      [edge("composition", "page", "seo")],
    );
    const [finding] = findFindings(graph).filter((f) => f.kind === "pureMixin");
    expect(finding?.nodeId).toBe("seo");
    expect(finding?.related).toEqual(["page"]);
  });

  it("reports only the top complexity tier", () => {
    const graph = graphOf([
      node("big", { allowedAsRoot: true, ownPropertyCount: 40 }),
      node("small", { allowedAsRoot: true, ownPropertyCount: 2 }),
    ]);
    expect(aliasesFor(graph, "complexity")).toEqual(["big"]);
  });

  it("counts compositions twice and block targets once in the score", () => {
    const graph = graphOf(
      [
        node("page", { allowedAsRoot: true, ownPropertyCount: 1, composedPropertyCount: 2 }),
        node("seo"),
        node("hero", { isElement: true }),
      ],
      [
        edge("composition", "page", "seo"),
        edge("block", "page", "hero", "blocks"),
        edge("block", "page", "hero", "extras"),
      ],
    );
    // 1 own + 2 composed + 2 * 1 composition + 1 distinct block target.
    const finding = findFindings(graph).find(
      (candidate) => candidate.kind === "complexity" && candidate.nodeId === "page",
    );
    expect(finding?.summary).toContain("Complexity 6");
  });

  it("gives every finding a stable id and keeps the order between runs", () => {
    const first = findFindings(medium);
    const second = findFindings(medium);
    expect(first.map((finding) => finding.id)).toEqual(second.map((finding) => finding.id));
    expect(new Set(first.map((finding) => finding.id)).size).toBe(first.length);
    expect(first[0]?.id).toBe(`${first[0]?.kind}:${first[0]?.nodeId}`);
    // Problems first, so the drawer's first group is the one worth reading.
    const firstNote = first.findIndex((finding) => finding.severity === "note");
    expect(first.slice(firstNote).every((finding) => finding.severity === "note")).toBe(true);
  });

  it("says nothing about an empty graph", () => {
    expect(findFindings(graphOf([]))).toEqual([]);
  });
});

describe("findFindings on small.json", () => {
  const named = (kind: FindingKind, usage?: UsageReport) =>
    findFindings(small, usage)
      .filter((finding) => finding.kind === kind)
      .map((finding) => small.nodes.find((n) => n.id === finding.nodeId)?.alias)
      .sort();

  it("finds the fixture's dead ends and its empty type", () => {
    // Every Element Type in the fixture is in a block editor, so that rule is
    // silent here and the hand-built graph above is what covers it.
    expect(named("unusedElementType")).toEqual([]);
    // seoComposition is composed by another type, so it is a mixin, not a dead end.
    expect(named("deadEnd")).toEqual(["legacyWidget", "person"]);
    expect(named("noProperties")).toEqual(["legacyWidget"]);
    expect(named("pureMixin")).toEqual(["seoComposition"]);
  });

  it("leaves the usage rules out until a report arrives", () => {
    expect(named("unusedType")).toEqual([]);
    expect(named("unusedType", usageOf(small, ["legacyWidget"]))).toEqual(["legacyWidget"]);
  });
});

describe("findFindings on the seeded medium.json", () => {
  // The seeder plants these. unusedArticleLegacy is the one that needs a usage
  // report, so it is given a hand-made one with that type at zero. The two
  // composition-shaped types are at zero as well, because nothing can create
  // content of a type no editor can reach.
  const usage = usageOf(medium, ["unusedArticleLegacy", "unusedSeoComposition", "deadEndPromo"]);
  const planted: [string, FindingKind][] = [
    ["unusedArticleLegacy", "unusedType"],
    ["unusedElementBanner", "unusedElementType"],
    ["unusedSeoComposition", "deadEnd"],
    ["deadEndPromo", "deadEnd"],
    ["dupAliasPage", "duplicateAlias"],
    ["brokenBlockHost", "brokenBlock"],
    ["emptyType", "noProperties"],
    ["noTemplatePage", "noTemplate"],
  ];

  it.each(planted)("reports %s as %s", (alias, kind) => {
    const id = medium.nodes.find((candidate) => candidate.alias === alias)?.id;
    expect(findFindings(medium, usage)).toContainEqual(
      expect.objectContaining({ kind, nodeId: id }),
    );
  });

  it("reports the seeded site's own usage report the same way", () => {
    const legacy = medium.nodes.find(
      (candidate) => candidate.alias === "unusedArticleLegacy",
    )?.id;
    const article = medium.nodes.find((candidate) => candidate.alias === "article")?.id;
    const unused = findFindings(medium, mediumUsage)
      .filter((finding) => finding.kind === "unusedType")
      .map((finding) => finding.nodeId);
    expect(unused).toContain(legacy);
    // article has 162 items in that report, so it is never the unused one.
    expect(unused).not.toContain(article);
  });

  it("reports the graph-only rules with no usage report at all", () => {
    const kinds = new Set(findFindings(medium).map((finding) => finding.kind));
    expect(kinds.has("unusedType")).toBe(false);
    for (const [, kind] of planted.filter(([, k]) => k !== "unusedType")) {
      expect(kinds.has(kind)).toBe(true);
    }
  });
});
