import { describe, expect, it } from "vitest";
import { searchNodes } from "./search";
import type { SchemaNode, SchemaProperty } from "./types";

const property = (alias: string): SchemaProperty => ({
  alias,
  name: alias,
  dataTypeId: "dt",
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: "Umb.PropertyEditorUi.TextBox",
  mandatory: false,
  variesByCulture: false,
  fromCompositionId: null,
  targets: [],
});

const node = (alias: string, propertyAliases: string[] = []): SchemaNode => ({
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
  groups: [
    {
      id: `${alias}-group`,
      alias: "content",
      name: "Content",
      type: "Group",
      parentAlias: null,
      fromCompositionId: null,
      properties: propertyAliases.map(property),
    },
  ],
  ownPropertyCount: propertyAliases.length,
  composedPropertyCount: 0,
  templates: [],
});

describe("searchNodes", () => {
  it("returns nothing for an empty query", () => {
    expect(searchNodes([node("article")], "")).toEqual([]);
    expect(searchNodes([node("article")], "   ")).toEqual([]);
  });

  it("matches a property alias and reports which one matched", () => {
    const hits = searchNodes([node("landingPage", ["seoTitle"]), node("article")], "seotitle");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.node.alias).toBe("landingPage");
    expect(hits[0]?.propertyAlias).toBe("seoTitle");
  });

  it("ranks an exact alias above a partial one and above a property match", () => {
    const hits = searchNodes(
      [node("heroBanner", ["heroImage"]), node("carousel", ["hero"]), node("hero")],
      "hero",
    );

    expect(hits.map((hit) => hit.node.alias)).toEqual(["hero", "heroBanner", "carousel"]);
    expect(hits[1]?.propertyAlias).toBeNull();
    expect(hits[2]?.propertyAlias).toBe("hero");
  });
});
