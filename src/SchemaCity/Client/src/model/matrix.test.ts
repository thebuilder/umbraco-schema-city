import { describe, expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { compositionMatrix, dataTypeMatrix, sortColumns } from "./matrix";
import type { SchemaGraph, SchemaNode, SchemaProperty } from "./types";

const property = (
  dataTypeId: string,
  fromCompositionId: string | null = null
) =>
  ({
    alias: dataTypeId,
    dataTypeId,
    editorAlias: `Umbraco.${dataTypeId}`,
    fromCompositionId,
  }) as SchemaProperty;

const node = (id: string, properties: SchemaProperty[] = []) =>
  ({
    id,
    alias: id,
    name: id,
    groups: [{ properties }],
  }) as unknown as SchemaNode;

describe("compositionMatrix", () => {
  const graph = {
    nodes: ["article", "page", "seo", "meta", "loose"].map((id) => node(id)),
    edges: [
      { kind: "composition", from: "article", to: "page" },
      { kind: "composition", from: "article", to: "seo" },
      { kind: "composition", from: "page", to: "seo" },
      { kind: "composition", from: "seo", to: "meta" },
      { kind: "allowedChild", from: "loose", to: "article" },
    ],
  } as SchemaGraph;
  const matrix = compositionMatrix(graph);

  it("tells a direct composition from one that arrives through another", () => {
    const article = matrix.cells.get("article");
    expect(article?.get("page")).toEqual({ via: null });
    // seo is direct even though page composes it too.
    expect(article?.get("seo")).toEqual({ via: null });
    expect(article?.get("meta")).toEqual({ via: "seo" });
    expect(matrix.cells.get("page")?.get("meta")).toEqual({ via: "seo" });
  });

  it("lists only types that use a composition, and counts users per column", () => {
    expect(matrix.rows.map((row) => row.id)).toEqual([
      "article",
      "page",
      "seo",
    ]);
    expect(
      matrix.columns.map((column) => [column.label, column.total])
    ).toEqual([
      ["meta", 3],
      ["seo", 2],
      ["page", 1],
    ]);
  });

  it("stops on a composition cycle", () => {
    const cyclic = compositionMatrix({
      nodes: [node("a"), node("b")],
      edges: [
        { kind: "composition", from: "a", to: "b" },
        { kind: "composition", from: "b", to: "a" },
      ],
    } as SchemaGraph);
    expect([...(cyclic.cells.get("a")?.keys() ?? [])]).toEqual(["b"]);
  });
});

describe("dataTypeMatrix", () => {
  it("counts own properties per Data Type and leaves composed ones to their source", () => {
    const matrix = dataTypeMatrix({
      nodes: [
        node("seo", [property("TextBox")]),
        node("article", [
          property("TextBox"),
          property("TextBox"),
          property("RichText"),
          property("TextBox", "seo"),
        ]),
        node("empty"),
      ],
      edges: [],
    } as unknown as SchemaGraph);

    expect(matrix.rows.map((row) => row.id)).toEqual(["article", "seo"]);
    expect(matrix.cells.get("article")?.get("TextBox")).toBe(2);
    expect(
      matrix.columns.map((column) => [column.label, column.total])
    ).toEqual([
      ["Umbraco.TextBox", 3],
      ["Umbraco.RichText", 1],
    ]);
  });

  it("covers every own property in the medium sample", () => {
    const medium = mediumFixture as unknown as SchemaGraph;
    const matrix = dataTypeMatrix(medium);
    const own = medium.nodes.reduce(
      (sum, candidate) => sum + candidate.ownPropertyCount,
      0
    );
    expect(matrix.columns.reduce((sum, column) => sum + column.total, 0)).toBe(
      own
    );
  });
});

describe("sortColumns", () => {
  it("sorts by usage, or by label, with the label breaking ties", () => {
    const columns = [
      { id: "1", label: "b", detail: "", total: 1 },
      { id: "2", label: "c", detail: "", total: 5 },
      { id: "3", label: "a", detail: "", total: 1 },
    ];
    expect(sortColumns(columns, "usage").map((column) => column.id)).toEqual([
      "2",
      "3",
      "1",
    ]);
    expect(sortColumns(columns, "name").map((column) => column.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });
});
