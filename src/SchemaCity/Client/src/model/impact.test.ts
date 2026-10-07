import { describe, expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import mediumUsage from "../../dev/fixtures/medium-usage.json";
import {
  aliasImpact,
  type Impact,
  impactCsv,
  impactMarkdown,
  impactOf,
  MAX_PATHS,
  pathWords,
} from "./impact";
import type {
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
  UsageReport,
} from "./types";

const property = (
  alias: string,
  fromCompositionId: string | null = null,
  dataTypeName = "Textstring"
) =>
  ({
    alias,
    dataTypeId: `dt-${alias}`,
    dataTypeName,
    editorAlias: "Umbraco.TextBox",
    fromCompositionId,
    targets: [],
  }) as unknown as SchemaProperty;

const node = (
  id: string,
  extra: Partial<SchemaNode> = {},
  properties: SchemaProperty[] = []
) =>
  ({
    id,
    alias: id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    isElement: false,
    allowedAsRoot: false,
    groups: [{ properties }],
    ...extra,
  }) as unknown as SchemaNode;

const edge = (
  kind: SchemaEdge["kind"],
  from: string,
  to: string,
  propertyAlias?: string
): SchemaEdge => ({
  kind,
  from,
  to,
  ...(propertyAlias ? { propertyAlias } : {}),
});

const graph = {
  generatedAt: "2026-10-01T00:00:00Z",
  folders: [],
  nodes: [
    node("root", { allowedAsRoot: true }),
    node("hub"),
    node("leaf"),
    node("shared"),
    node("seo", {}, [property("title")]),
    node("article", {}, [
      property("title", "seo"),
      property("body", null, "Body Blocks"),
    ]),
    node("press", {}, [
      property("title", "seo"),
      property("body", "article", "Body Blocks"),
    ]),
    node("dup", {}, [property("title", "seo"), property("title")]),
    node("quote", { isElement: true }),
    node("grid", { isElement: true }, [property("cells", null, "Grid")]),
    node("landing", {}, [property("main", null, "Grid")]),
    node("settings", {}, [property("related", null, "Related")]),
    node("x"),
    node("y"),
  ],
  edges: [
    edge("allowedChild", "root", "hub"),
    edge("allowedChild", "root", "shared"),
    edge("allowedChild", "hub", "leaf"),
    edge("allowedChild", "hub", "shared"),
    edge("allowedChild", "hub", "article"),
    edge("composition", "article", "seo"),
    edge("composition", "dup", "seo"),
    edge("composition", "press", "article"),
    edge("inherits", "press", "article"),
    edge("block", "article", "quote", "body"),
    edge("block", "grid", "quote", "cells"),
    edge("block", "landing", "grid", "main"),
    edge("reference", "settings", "article", "related"),
    edge("composition", "x", "y"),
    edge("composition", "y", "x"),
    edge("block", "landing", "missing", "main"),
  ],
} as SchemaGraph;

const usage = {
  generatedAt: "2026-10-02T00:00:00Z",
  byType: {
    article: { total: 10 },
    press: { total: 4 },
    landing: { total: 2 },
    dup: { total: 1 },
  },
  references: [],
  blocks: {
    partial: false,
    valuesRead: 3,
    unreadable: 0,
    byDataType: [
      {
        dataTypeId: "dt-body",
        values: 3,
        items: 3,
        elements: [
          { elementTypeId: "quote", content: 6, settings: 1, items: 3 },
        ],
      },
    ],
  },
} as unknown as UsageReport;

const nameOf = (id: string) =>
  graph.nodes.find((candidate) => candidate.id === id)?.name ?? id;
const rows = (impact: Impact, key: string) =>
  impact.groups.find((group) => group.key === key)?.rows ?? [];
const words = (impact: Impact, key: string) =>
  rows(impact, key).map((row) =>
    row.paths.map((path) =>
      pathWords(impact.start, path, impact.direction, nameOf)
    )
  );

describe("impactOf", () => {
  it("follows composition users through inheritance, with each path in words", () => {
    const impact = impactOf(graph, "seo", {}, usage);
    expect(words(impact, "receivers")).toEqual([
      ["Article composes Seo"],
      ["Dup composes Seo"],
      ["Press inherits Article, which composes Seo"],
    ]);
    expect(rows(impact, "receivers").map((row) => row.direct)).toEqual([
      true,
      true,
      false,
    ]);
    expect(impact.types).toBe(3);
    expect(impact.content).toBe(15);
  });

  it("stops at the depth asked for", () => {
    const impact = impactOf(graph, "seo", { depth: 1 }, usage);
    expect(rows(impact, "receivers").map((row) => row.id)).toEqual([
      "article",
      "dup",
    ]);
  });

  it("finds block hosts, nested blocks and the types that inherit a host, with stored blocks", () => {
    const impact = impactOf(graph, "quote", {}, usage);
    expect(words(impact, "blockHosts")).toEqual([
      ["Article offers Quote as a block in body (Body Blocks)"],
      ["Grid offers Quote as a block in cells (Grid)"],
      [
        "Press inherits Article, which offers Quote as a block in body (Body Blocks)",
      ],
      [
        "Landing offers Grid as a block in main (Grid), which offers Quote as a block in cells (Grid)",
      ],
    ]);
    expect(impact.stored).toEqual([
      { dataTypeId: "dt-body", name: "dt-body", blocks: 7 },
    ]);
    // An Element Type holds no content items of its own, so it counts blocks.
    expect(
      rows(impact, "blockHosts").find((row) => row.id === "grid")
    ).toMatchObject({
      blocks: 0,
    });
    expect(
      impactOf(graph, "quote", { relations: ["blocks"] }).groups
    ).toHaveLength(1);
  });

  it("lists the parents that lose a creation option and the children only it leads to", () => {
    const impact = impactOf(graph, "hub", {}, usage);
    expect(words(impact, "parents")).toEqual([["Root allows Hub as a child"]]);
    // Shared is also allowed under the root, so it stays reachable.
    expect(words(impact, "orphans")).toEqual([
      ["Article is reached only through Hub"],
      ["Leaf is reached only through Hub"],
    ]);
    // A parent passes nothing on, and the picker group is off.
    const parentsOnly = impactOf(graph, "article", { relations: ["children"] });
    expect(parentsOnly.groups.map((group) => group.key)).toEqual(["parents"]);
  });

  it("finds pickers and the types that carry the picker property", () => {
    const impact = impactOf(graph, "article", { relations: ["pickers"] });
    expect(words(impact, "pickers")).toEqual([
      ["Settings can pick Article in related (Related)"],
    ]);
  });

  it("is safe in a composition cycle and never lists the start", () => {
    const impact = impactOf(graph, "x");
    expect(rows(impact, "receivers").map((row) => row.id)).toEqual(["y"]);
  });

  it("keeps several paths per type, shortest first, up to the cap", () => {
    const fan = {
      ...graph,
      nodes: ["s", "a", "b", "c", "d", "t"].map((id) => node(id)),
      edges: [
        edge("composition", "t", "s"),
        ...["a", "b", "c", "d"].flatMap((id) => [
          edge("composition", id, "s"),
          edge("composition", "t", id),
        ]),
      ],
    } as SchemaGraph;
    const target = rows(impactOf(fan, "s"), "receivers").find(
      (row) => row.id === "t"
    );
    expect(target?.paths).toHaveLength(MAX_PATHS);
    expect(target?.paths.map((path) => path.length)).toEqual([1, 2, 2]);
  });

  it("walks the other way for dependencies", () => {
    const impact = impactOf(graph, "press", { direction: "dependencies" });
    expect(words(impact, "sources")).toEqual([
      ["Press inherits Article"],
      ["Press inherits Article, which composes Seo"],
    ]);
  });

  it("counts 37 types and 188 items for the seeded Seo Composition", () => {
    const medium = mediumFixture as SchemaGraph;
    const seo = medium.nodes.find((n) => n.alias === "seoComposition");
    const impact = impactOf(
      medium,
      seo?.id ?? "",
      {},
      mediumUsage as UsageReport
    );
    expect([impact.types, impact.content]).toEqual([37, 188]);
    const press = rows(impact, "receivers").find(
      (row) => row.alias === "pressRelease"
    );
    expect(press?.direct).toBe(false);
  });
});

describe("aliasImpact", () => {
  it("checks a planned alias against every type it would land on", () => {
    const planned = aliasImpact(graph, "article", "Title", usage);
    // Article already has title, from Seo, so it is traced from Seo.
    expect(planned).toMatchObject({
      alias: "title",
      source: "seo",
      exists: true,
    });
    expect(planned?.carriers.map((row) => row.id)).toEqual([
      "seo",
      "article",
      "dup",
      "press",
    ]);
    expect(planned?.collisions).toEqual([
      { id: "dup", name: "Dup", from: "Dup" },
    ]);
  });

  it("treats a new alias as landing from the start type", () => {
    const planned = aliasImpact(graph, "article", "subtitle", usage);
    expect(planned).toMatchObject({ source: "article", exists: false });
    expect(planned?.carriers.map((row) => row.id)).toEqual([
      "article",
      "press",
    ]);
    expect(planned?.collisions).toEqual([]);
    expect(aliasImpact(graph, "article", "  ")).toBeNull();
  });
});

describe("exports", () => {
  const impact = impactOf(graph, "seo", {}, usage);
  const alias = aliasImpact(graph, "seo", "title", usage);

  it("writes a Markdown summary with totals, a table per group and collisions", () => {
    const text = impactMarkdown(impact, graph, usage, alias);
    expect(text).toContain("## Impact of changing Seo (seo)");
    expect(text).toContain("**3 types, 15 content items.**");
    expect(text).toContain(
      "| Press | press | 4 | Press inherits Article, which composes Seo |"
    );
    expect(text).toContain("| Dup | Dup |");
    expect(text).not.toContain("safe");
  });

  it("puts the CSV header first and protects formula-like cells", () => {
    const risky = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === "dup" ? { ...n, name: "=cmd|x" } : n
      ),
    };
    const text = impactCsv(impactOf(risky, "seo"), risky);
    const [header, ...lines] = text.trimEnd().split("\n");
    expect(header?.startsWith("Group,Type,Alias,Type key,Direct")).toBe(true);
    expect(
      lines.some((line) => line.startsWith("Get its properties,'=cmd|x,dup,"))
    ).toBe(true);
    expect(text).toContain(",unavailable\n");
  });
});
