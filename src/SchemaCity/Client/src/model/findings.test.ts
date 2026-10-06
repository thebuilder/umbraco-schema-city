import { describe, expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import mediumUsageFixture from "../../dev/fixtures/medium-usage.json";
import pathologicalFixture from "../../dev/fixtures/pathological.json";
import pathologicalUsageFixture from "../../dev/fixtures/pathological-usage.json";
import smallFixture from "../../dev/fixtures/small.json";
import {
  FINDING_KINDS,
  type FindingKind,
  findFindings,
  findingGroups,
} from "./findings";
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
const pathological = pathologicalFixture as unknown as SchemaGraph;
const pathologicalUsage = pathologicalUsageFixture as unknown as UsageReport;

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

const property = (
  alias: string,
  fromCompositionId: string | null,
  extra: Partial<SchemaProperty> = {}
): SchemaProperty => ({
  alias,
  name: alias,
  dataTypeId: "dt",
  dataTypeName: null,
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: null,
  mandatory: false,
  variesByCulture: false,
  fromCompositionId,
  targets: [],
  ...extra,
});

const group = (
  alias: string,
  properties: SchemaProperty[],
  type: "Tab" | "Group" = "Group"
) => ({
  id: alias,
  alias,
  name: alias,
  type,
  parentAlias: null,
  fromCompositionId: null,
  properties,
});

/** `count` plain properties named `${prefix}0`, `${prefix}1` and so on. */
const many = (prefix: string, count: number, from: string | null = null) =>
  Array.from({ length: count }, (_, i) => property(`${prefix}${i}`, from));

const summaryOf = (graph: SchemaGraph, kind: FindingKind, alias: string) =>
  findFindings(graph).find(
    (finding) => finding.kind === kind && finding.nodeId === alias
  );

const graphOf = (
  nodes: SchemaNode[],
  edges: SchemaEdge[] = []
): SchemaGraph => ({
  generatedAt: "2026-09-03T00:00:00Z",
  folders: [],
  nodes,
  edges,
});

const edge = (
  kind: SchemaEdge["kind"],
  from: string,
  to: string,
  propertyAlias?: string
) =>
  ({
    kind,
    from,
    to,
    ...(propertyAlias ? { propertyAlias } : {}),
  }) as SchemaEdge;

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
const kindsFor = (
  graph: SchemaGraph,
  alias: string,
  usage?: UsageReport
): FindingKind[] =>
  findFindings(graph, usage)
    .filter((finding) => finding.nodeId === alias)
    .map((finding) => finding.kind);

const aliasesFor = (
  graph: SchemaGraph,
  kind: FindingKind,
  usage?: UsageReport
) =>
  findFindings(graph, usage)
    .filter((finding) => finding.kind === kind)
    .map((finding) => finding.nodeId)
    .sort();

describe("findFindings, one rule at a time", () => {
  it("reports a type with no content, only when usage says so", () => {
    const graph = graphOf([node("home", { allowedAsRoot: true })]);
    expect(kindsFor(graph, "home")).not.toContain("unusedType");
    expect(kindsFor(graph, "home", usageOf(graph, ["home"]))).toContain(
      "unusedType"
    );
    expect(kindsFor(graph, "home", usageOf(graph))).not.toContain("unusedType");
  });

  it("leaves a type no editor can create off the unused types", () => {
    const graph = graphOf(
      [
        node("page", { allowedAsRoot: true }),
        node("news"),
        node("seo"),
        node("orphan"),
      ],
      [edge("composition", "page", "seo"), edge("allowedChild", "page", "news")]
    );
    const usage = usageOf(graph, ["news", "seo", "orphan"]);
    // A composed mixin never has content of its own.
    expect(kindsFor(graph, "seo", usage)).toEqual(["pureMixin"]);
    // A creatable type with no content is still the one worth reading.
    expect(kindsFor(graph, "news", usage)).toContain("unusedType");
    // No root, no parent, no composer: the dead end says it, once.
    expect(kindsFor(graph, "orphan", usage)).toEqual(["deadEnd"]);
  });

  it("reports an Element Type no block editor points at", () => {
    const graph = graphOf(
      [
        node("host", { allowedAsRoot: true }),
        node("used", { isElement: true }),
        node("spare", { isElement: true }),
      ],
      [edge("block", "host", "used", "blocks")]
    );
    expect(aliasesFor(graph, "unusedElementType")).toEqual(["spare"]);
  });

  it("reports a type no editor can create and nothing composes", () => {
    const graph = graphOf(
      [node("home", { allowedAsRoot: true }), node("child"), node("orphan")],
      [edge("allowedChild", "home", "child")]
    );
    expect(aliasesFor(graph, "deadEnd")).toEqual(["orphan"]);
  });

  it("leaves a composed type off the dead ends, whatever usage says", () => {
    const graph = graphOf(
      [node("page", { allowedAsRoot: true }), node("seo"), node("lonely")],
      [edge("composition", "page", "seo")]
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
    const [finding] = findFindings(graph).filter(
      (f) => f.kind === "duplicateAlias"
    );
    expect(finding?.summary).toContain("seoTitle");
    expect(finding?.related).toEqual(["seoA", "seoB"]);
  });

  it("leaves one alias from one composition alone", () => {
    const graph = graphOf([
      node("page", {
        allowedAsRoot: true,
        groups: [
          group("seo", [
            property("seoTitle", "seoA"),
            property("seoBody", "seoA"),
          ]),
        ],
      }),
    ]);
    expect(aliasesFor(graph, "duplicateAlias")).toEqual([]);
  });

  it("reports a block target that resolves to no type", () => {
    const graph = graphOf(
      [node("host", { allowedAsRoot: true })],
      [edge("block", "host", "deleted-key", "blocks")]
    );
    const [finding] = findFindings(graph).filter(
      (f) => f.kind === "brokenBlock"
    );
    expect(finding?.nodeId).toBe("host");
    expect(finding?.related).toEqual(["deleted-key"]);
    expect(finding?.summary).toContain("blocks");
  });

  it("reports a type with no properties at all", () => {
    const graph = graphOf([
      node("empty", { allowedAsRoot: true, ownPropertyCount: 0 }),
      node("full", {
        allowedAsRoot: true,
        composedPropertyCount: 3,
        ownPropertyCount: 0,
      }),
    ]);
    expect(aliasesFor(graph, "noProperties")).toEqual(["empty"]);
  });

  it("reports a type with no template as a note", () => {
    const graph = graphOf([
      node("bare", { allowedAsRoot: true, templates: [] }),
      node("templated", { allowedAsRoot: true }),
      node("element", { isElement: true, templates: [] }),
    ]);
    const [finding] = findFindings(graph).filter(
      (f) => f.kind === "noTemplate"
    );
    expect(finding?.nodeId).toBe("bare");
    expect(finding?.severity).toBe("note");
  });

  it("says nothing about templates on a schema that has none, or about a mixin", () => {
    const headless = graphOf([
      node("home", { allowedAsRoot: true, templates: [] }),
    ]);
    expect(aliasesFor(headless, "noTemplate")).toEqual([]);
    const mixin = graphOf(
      [node("page", { allowedAsRoot: true }), node("seo", { templates: [] })],
      [edge("composition", "page", "seo")]
    );
    expect(aliasesFor(mixin, "noTemplate")).toEqual([]);
  });

  it("says nothing about templates when most creatable types have none", () => {
    const mostlyHeadless = graphOf([
      node("home", { allowedAsRoot: true }),
      node("news", { allowedAsRoot: true, templates: [] }),
      node("event", { allowedAsRoot: true, templates: [] }),
    ]);
    expect(aliasesFor(mostlyHeadless, "noTemplate")).toEqual([]);
  });

  it("leaves the template note off a type already reported as unused", () => {
    const graph = graphOf([
      node("home", { allowedAsRoot: true }),
      node("news", { allowedAsRoot: true, templates: [] }),
      node("event", { allowedAsRoot: true, templates: [] }),
      node("about", { allowedAsRoot: true }),
    ]);
    expect(aliasesFor(graph, "noTemplate", usageOf(graph))).toEqual([
      "event",
      "news",
    ]);
    const kinds = kindsFor(graph, "news", usageOf(graph, ["news"]));
    expect(kinds).toContain("unusedType");
    expect(kinds).not.toContain("noTemplate");
  });

  it("reports a composition that is only ever composed", () => {
    const graph = graphOf(
      [node("page", { allowedAsRoot: true }), node("seo")],
      [edge("composition", "page", "seo")]
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
        node("page", {
          allowedAsRoot: true,
          ownPropertyCount: 1,
          composedPropertyCount: 2,
        }),
        node("seo"),
        node("hero", { isElement: true }),
      ],
      [
        edge("composition", "page", "seo"),
        edge("block", "page", "hero", "blocks"),
        edge("block", "page", "hero", "extras"),
      ]
    );
    // 1 own + 2 composed + 2 * 1 composition + 1 distinct block target.
    const finding = findFindings(graph).find(
      (candidate) =>
        candidate.kind === "complexity" && candidate.nodeId === "page"
    );
    expect(finding?.summary).toContain("Score 6");
  });

  it("gives every finding a stable id and keeps the order between runs", () => {
    const first = findFindings(medium);
    const second = findFindings(medium);
    expect(first.map((finding) => finding.id)).toEqual(
      second.map((finding) => finding.id)
    );
    expect(new Set(first.map((finding) => finding.id)).size).toBe(first.length);
    expect(first[0]?.id).toBe(`${first[0]?.kind}:${first[0]?.nodeId}`);
    // Problems first, so the drawer's first group is the one worth reading.
    const firstNote = first.findIndex((finding) => finding.severity === "note");
    expect(
      first.slice(firstNote).every((finding) => finding.severity === "note")
    ).toBe(true);
  });

  it("says where an unused type can be created, empty branches first", () => {
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true }),
        node("landing", { allowedAsRoot: true }),
        node("news"),
        node("press"),
      ],
      [
        edge("allowedChild", "home", "news"),
        edge("allowedChild", "landing", "press"),
      ]
    );
    const rows = findFindings(
      graph,
      usageOf(graph, ["landing", "news", "press"])
    ).filter((finding) => finding.kind === "unusedType");
    // press sits under an empty landing, so it comes before the alphabet would put it.
    expect(rows.map((row) => [row.nodeId, row.summary])).toEqual([
      ["press", "Allowed under landing, which has no content either"],
      ["landing", "Allowed at root"],
      ["news", "Allowed under home"],
    ]);
    expect(rows[0]?.related).toEqual(["landing"]);
  });

  it("names the clashing alias and where each copy comes from", () => {
    const graph = graphOf([
      node("seoA", { name: "Seo A" }),
      node("page", {
        allowedAsRoot: true,
        groups: [
          group("seo", [property("seoTitle", "seoA")]),
          group("own", [property("seoTitle", null)]),
        ],
      }),
    ]);
    const [finding] = findFindings(graph).filter(
      (f) => f.kind === "duplicateAlias"
    );
    expect(finding?.summary).toBe("seoTitle from Seo A, page");
  });

  it("reports a type whose only parents no root reaches", () => {
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true }),
        node("news"),
        node("legacyHub", { name: "Legacy Hub" }),
        node("legacyPage"),
        node("legacyLeaf"),
      ],
      [
        edge("allowedChild", "home", "news"),
        edge("allowedChild", "legacyHub", "legacyPage"),
        edge("allowedChild", "legacyPage", "legacyLeaf"),
      ]
    );
    expect(aliasesFor(graph, "unreachableChain")).toEqual([
      "legacyLeaf",
      "legacyPage",
    ]);
    expect(summaryOf(graph, "unreachableChain", "legacyPage")?.summary).toBe(
      "Allowed under Legacy Hub, which no root can reach"
    );
    // The head has no parent at all, so it stays the dead end it was.
    expect(aliasesFor(graph, "deadEnd")).toEqual(["legacyHub"]);
    // An editor cannot create it, so no content is not news about it.
    expect(
      kindsFor(graph, "legacyPage", usageOf(graph, ["legacyPage"]))
    ).not.toContain("unusedType");
  });

  it("leaves a type with one reachable parent, and Element Types, alone", () => {
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true }),
        node("orphan"),
        node("shared"),
        node("hero", { isElement: true }),
      ],
      [
        edge("allowedChild", "orphan", "shared"),
        edge("allowedChild", "home", "shared"),
        edge("allowedChild", "orphan", "hero"),
      ]
    );
    expect(aliasesFor(graph, "unreachableChain")).toEqual([]);
  });

  it("reports a rootless cycle once per type in it", () => {
    const graph = graphOf(
      [node("a"), node("b")],
      [edge("allowedChild", "a", "b"), edge("allowedChild", "b", "a")]
    );
    expect(aliasesFor(graph, "unreachableChain")).toEqual(["a", "b"]);
    expect(aliasesFor(graph, "deadEnd")).toEqual([]);
  });

  it("reports a variant property and a variant block on an invariant type", () => {
    const graph = graphOf(
      [
        node("landing", {
          allowedAsRoot: true,
          groups: [
            group("content", [
              property("campaignCode", null, { variesByCulture: true }),
              property("title", null),
            ]),
          ],
        }),
        node("quote", {
          isElement: true,
          name: "Quote",
          variesByCulture: true,
        }),
        node("hero", { isElement: true }),
      ],
      [
        edge("block", "landing", "quote", "quotes"),
        edge("block", "landing", "hero", "quotes"),
      ]
    );
    const finding = summaryOf(graph, "cultureMismatch", "landing");
    expect(finding?.summary).toBe(
      "campaignCode varies by culture; quotes lists Quote, which varies by culture"
    );
    expect(finding?.related).toEqual(["quote"]);
    expect(aliasesFor(graph, "cultureMismatch")).toEqual(["landing"]);
  });

  it("leaves variance alone on a type that varies by culture", () => {
    const graph = graphOf(
      [
        node("home", {
          allowedAsRoot: true,
          variesByCulture: true,
          groups: [
            group("content", [
              property("title", null, { variesByCulture: true }),
            ]),
          ],
        }),
        node("quote", { isElement: true, variesByCulture: true }),
      ],
      // Block level variance: an invariant property on a variant type is how a
      // variant Element Type gets its cultures.
      [edge("block", "home", "quote", "quotes")]
    );
    expect(aliasesFor(graph, "cultureMismatch")).toEqual([]);
  });

  it("names the composition a mismatched variant property comes from", () => {
    const graph = graphOf(
      [
        node("seo", { name: "SEO", variesByCulture: true }),
        node("page", {
          allowedAsRoot: true,
          groups: [
            group("seo", [
              property("metaTitle", "seo", { variesByCulture: true }),
            ]),
          ],
        }),
      ],
      [edge("composition", "page", "seo")]
    );
    const finding = summaryOf(graph, "cultureMismatch", "page");
    expect(finding?.summary).toBe("metaTitle from SEO varies by culture");
    expect(finding?.related).toEqual(["seo"]);
  });

  it("reports own properties on a Data Type named like another", () => {
    const toggle = (alias: string, id: string, name: string) =>
      property(alias, null, { dataTypeId: id, dataTypeName: name });
    const graph = graphOf([
      node("page", {
        allowedAsRoot: true,
        groups: [
          group("content", [
            toggle("hideInNav", "dt-1", "SEO Toggle"),
            toggle("hideFromSearch", "dt-2", "Seo_Toggle"),
          ]),
        ],
      }),
      node("news", {
        allowedAsRoot: true,
        groups: [group("content", [toggle("noIndex", "dt-1", "SEO Toggle")])],
      }),
      node("plain", {
        allowedAsRoot: true,
        groups: [group("content", [toggle("title", "dt-3", "Textstring")])],
      }),
    ]);
    expect(aliasesFor(graph, "nearDuplicateDataType")).toEqual([
      "news",
      "page",
    ]);
    expect(summaryOf(graph, "nearDuplicateDataType", "page")?.summary).toBe(
      "hideInNav, hideFromSearch use SEO Toggle and Seo_Toggle"
    );
    expect(summaryOf(graph, "nearDuplicateDataType", "news")?.summary).toBe(
      "noIndex uses SEO Toggle, next to Seo_Toggle"
    );
  });

  it("leaves one Data Type used everywhere, and composed properties, alone", () => {
    const text = (alias: string, from: string | null, id = "dt-1") =>
      property(alias, from, { dataTypeId: id, dataTypeName: "Textstring" });
    const graph = graphOf(
      [
        node("seo", {
          groups: [group("seo", [text("metaTitle", null, "dt-2")])],
        }),
        node("page", {
          allowedAsRoot: true,
          groups: [
            group("content", [text("title", null)]),
            group("seo", [text("metaTitle", "seo", "dt-2")]),
          ],
        }),
        node("news", {
          allowedAsRoot: true,
          groups: [group("content", [text("title", null)])],
        }),
      ],
      [edge("composition", "page", "seo")]
    );
    // dt-1 and dt-2 share the exact name, so page's own title is reported, while
    // its composed metaTitle is left to seo.
    expect(aliasesFor(graph, "nearDuplicateDataType")).toEqual([
      "news",
      "page",
      "seo",
    ]);
    expect(summaryOf(graph, "nearDuplicateDataType", "page")?.summary).toBe(
      "title uses Textstring, next to another Textstring"
    );
    const single = graphOf([
      node("news", {
        allowedAsRoot: true,
        groups: [group("content", [text("title", null), text("lead", null)])],
      }),
    ]);
    expect(aliasesFor(single, "nearDuplicateDataType")).toEqual([]);
  });

  it("reports a tab with more than twenty properties, composed ones included", () => {
    const graph = graphOf([
      node("page", {
        allowedAsRoot: true,
        groups: [
          { ...group("content", many("own", 15), "Tab"), name: "Content" },
          {
            ...group("content", many("seo", 7, "seo"), "Tab"),
            fromCompositionId: "seo",
          },
          group("settings", many("setting", 20), "Tab"),
        ],
      }),
    ]);
    const finding = summaryOf(graph, "overloadedTab", "page");
    expect(finding?.summary).toBe("Content tab holds 22 properties");
    expect(finding?.severity).toBe("note");
  });

  it("counts each group on a type without tabs, and stops at twenty", () => {
    const graph = graphOf([
      node("tabless", {
        allowedAsRoot: true,
        groups: [
          group("listing", many("item", 21)),
          group("meta", many("m", 5)),
        ],
      }),
      node("full", {
        allowedAsRoot: true,
        groups: [group("content", many("field", 20), "Tab")],
      }),
    ]);
    expect(aliasesFor(graph, "overloadedTab")).toEqual(["tabless"]);
    expect(summaryOf(graph, "overloadedTab", "tabless")?.summary).toBe(
      "listing group holds 21 properties"
    );
  });

  it("reports a content block with nothing to fill in", () => {
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true, name: "Home" }),
        node("article", { allowedAsRoot: true, name: "Article" }),
        node("divider", { isElement: true, ownPropertyCount: 0 }),
        node("hero", { isElement: true }),
      ],
      [
        edge("block", "home", "divider", "body"),
        edge("block", "article", "divider", "blocks"),
        edge("block", "article", "hero", "blocks"),
      ]
    );
    const finding = summaryOf(graph, "emptyBlock", "divider");
    expect(finding?.summary).toBe("Listed by body on Home, blocks on Article");
    expect(finding?.related).toEqual(["home", "article"]);
    // The empty block row says it, so the no properties note does not repeat it.
    expect(kindsFor(graph, "divider")).toEqual(["emptyBlock"]);
    expect(aliasesFor(graph, "emptyBlock")).toEqual(["divider"]);
  });

  it("leaves an empty settings block and an unlisted empty element alone", () => {
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true }),
        node("noSettings", { isElement: true, ownPropertyCount: 0 }),
        node("spare", { isElement: true, ownPropertyCount: 0 }),
      ],
      [
        {
          ...edge("block", "home", "noSettings", "body"),
          role: "settings",
        },
      ]
    );
    expect(aliasesFor(graph, "emptyBlock")).toEqual([]);
    expect(aliasesFor(graph, "noProperties")).toEqual(["noSettings", "spare"]);
  });

  it("orders kinds by fixed priority, broken blocks first, whatever the counts", () => {
    const graph = graphOf(
      [
        node("host", { allowedAsRoot: true, templates: [] }),
        node("a", { allowedAsRoot: true, templates: [] }),
        node("b", { allowedAsRoot: true, ownPropertyCount: 0 }),
        node("c", { allowedAsRoot: true, ownPropertyCount: 0 }),
        node("d", { allowedAsRoot: true, ownPropertyCount: 0 }),
        node("e", { allowedAsRoot: true }),
        node("f", { allowedAsRoot: true }),
      ],
      [edge("block", "host", "deleted-key", "blocks")]
    );
    const groups = findingGroups(findFindings(graph));
    // Three empty types outnumber the one broken block, and still come after it.
    expect(groups.map((group) => group.kind)).toEqual([
      "brokenBlock",
      "noProperties",
      "complexity",
      "noTemplate",
    ]);
    expect(FINDING_KINDS.slice(0, 8)).toEqual([
      "brokenBlock",
      "duplicateAlias",
      "emptyBlock",
      "cultureMismatch",
      "unreachableChain",
      "deadEnd",
      "unusedElementType",
      "unusedType",
    ]);
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

  it("finds one planted example of each newer check", () => {
    expect(named("unreachableChain")).toEqual(["biography"]);
    expect(named("cultureMismatch")).toEqual(["landingPage"]);
    expect(named("nearDuplicateDataType")).toEqual(["tagPage"]);
    expect(named("overloadedTab")).toEqual(["newsListing"]);
    expect(named("emptyBlock")).toEqual(["dividerBlock"]);
  });

  it("leaves the usage rules out until a report arrives", () => {
    expect(named("unusedType")).toEqual([]);
    // legacyWidget cannot be created, so only articlePage is an unused type.
    expect(
      named("unusedType", usageOf(small, ["legacyWidget", "articlePage"]))
    ).toEqual(["articlePage"]);
  });
});

describe("findFindings on the seeded medium.json", () => {
  // The seeder plants these. unusedArticleLegacy is the one that needs a usage
  // report, so it is given a hand-made one with that type at zero. The two
  // composition-shaped types are at zero as well, because nothing can create
  // content of a type no editor can reach.
  const usage = usageOf(medium, [
    "unusedArticleLegacy",
    "unusedSeoComposition",
    "deadEndPromo",
  ]);
  const planted: [string, FindingKind][] = [
    ["unusedArticleLegacy", "unusedType"],
    ["unusedElementBanner", "unusedElementType"],
    ["unusedSeoComposition", "deadEnd"],
    ["deadEndPromo", "deadEnd"],
    ["dupAliasPage", "duplicateAlias"],
    ["brokenBlockHost", "brokenBlock"],
    ["emptyType", "noProperties"],
  ];

  it("treats the sample as headless and leaves the template note out", () => {
    // 50 of its 55 creatable types have no template, noTemplatePage among them.
    expect(aliasesFor(medium, "noTemplate", usage)).toEqual([]);
  });

  it.each(planted)("reports %s as %s", (alias, kind) => {
    const id = medium.nodes.find((candidate) => candidate.alias === alias)?.id;
    expect(findFindings(medium, usage)).toContainEqual(
      expect.objectContaining({ kind, nodeId: id })
    );
  });

  it("reports the seeded site's own usage report the same way", () => {
    const legacy = medium.nodes.find(
      (candidate) => candidate.alias === "unusedArticleLegacy"
    )?.id;
    const article = medium.nodes.find(
      (candidate) => candidate.alias === "article"
    )?.id;
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

/**
 * What the rules make of the pathological fixture, per kind. The generator plants the
 * shapes and prints them; these are the rows that come out.
 *
 * unusedType is every reachable non-element type the usage report leaves at zero,
 * 164 of the 228; the dead ends, chains and mixins below are at zero too and not
 * counted. deadEnd is the 15 orphans, the 2 compositions nothing uses and archive00,
 * the head of a tree no root reaches, and unreachableChain is the other 32 types of
 * that tree. pureMixin is the 10 compositions that are used, and complexity is the
 * 20 types carrying 30 properties. The 6 planted types with no template have no
 * content either, so their unusedType row stands in for that note, which only shows
 * without a report. There is no unusedElementType row on purpose: the 30 block hosts
 * between them reach all 40 Element Types.
 *
 * nearDuplicateDataType is every type with an own property on Text String, Textstring,
 * SEO Toggle or Seo Toggle, which the Data Type rotation puts on 279 of the 300.
 * emptyBlock is block39, overloadedTab is editorial40,
 * and cultureMismatch is editorial05 hosting the variant block05, and root2.
 */
const PLANTED = {
  brokenBlock: 3,
  duplicateAlias: 4,
  emptyBlock: 1,
  cultureMismatch: 2,
  unreachableChain: 32,
  deadEnd: 18,
  unusedType: 164,
  overloadedTab: 1,
  nearDuplicateDataType: 279,
  noProperties: 5,
  complexity: 20,
  pureMixin: 10,
};

describe("findFindings on the pathological fixture", () => {
  // dev/make-pathological.mjs plants the shapes and prints what it planted; these are
  // the rows the rules make of them. A count that moves here means either the
  // generator or a rule changed, and both are worth reading the diff for.
  it("counts every kind the generator planted", () => {
    const counts: Record<string, number> = {};
    for (const finding of findFindings(pathological, pathologicalUsage))
      counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;

    expect(counts).toEqual(PLANTED);
  });

  it("names the type each planted shape is reported on", () => {
    const named = (kind: FindingKind) =>
      findFindings(pathological, pathologicalUsage)
        .filter((finding) => finding.kind === kind)
        .map(
          (finding) =>
            pathological.nodes.find((n) => n.id === finding.nodeId)?.alias
        );

    expect(named("brokenBlock")).toEqual([
      "editorial27",
      "editorial28",
      "editorial29",
    ]);
    expect(named("duplicateAlias")).toEqual([
      "editorial00",
      "editorial01",
      "page00",
      "page01",
    ]);
    expect(named("emptyBlock")).toEqual(["block39"]);
    expect(named("overloadedTab")).toEqual(["editorial40"]);
    expect(named("cultureMismatch")).toEqual(["editorial05", "root2"]);
  });

  it("drops the usage rules and keeps the rest without a report", () => {
    const counts: Record<string, number> = {};
    for (const finding of findFindings(pathological))
      counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;

    const { unusedType, ...rest } = PLANTED;
    expect(unusedType).toBeGreaterThan(0);
    expect(counts).toEqual({ ...rest, noTemplate: 6 });
  });
});
