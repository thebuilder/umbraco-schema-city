import { describe, expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { editorLayout, GENERIC_TAB } from "./editor-layout";
import type { PropertyGroup, SchemaGraph, SchemaNode } from "./types";

const group = (
  alias: string,
  type: "Tab" | "Group",
  parentAlias: string | null,
  properties: string[],
  fromCompositionId: string | null = null
) =>
  ({
    id: `${fromCompositionId ?? "own"}:${alias}`,
    alias,
    name: alias.toUpperCase(),
    type,
    parentAlias,
    fromCompositionId,
    properties: properties.map((property) => ({
      alias: property,
      fromCompositionId,
    })),
  }) as PropertyGroup;

const layout = (groups: PropertyGroup[]) =>
  editorLayout({ groups } as SchemaNode).map((tab) => ({
    name: tab.name,
    count: tab.count,
    panels: tab.panels.map((panel) => [
      panel.name,
      ...panel.properties.map((property) => property.alias),
    ]),
  }));

describe("editorLayout", () => {
  it("puts groups under their tab, a tab's own properties first", () => {
    expect(
      layout([
        group("content", "Tab", null, []),
        group("hero", "Group", "content", ["title"]),
        group("content", "Tab", null, ["intro"]),
      ])
    ).toEqual([
      {
        name: "CONTENT",
        count: 2,
        panels: [
          [null, "intro"],
          ["HERO", "title"],
        ],
      },
    ]);
  });

  it("merges a tab and a group that a composition declares under the same alias", () => {
    expect(
      layout([
        group("content", "Tab", null, []),
        group("main", "Group", "content", ["title"]),
        group("seo", "Tab", null, [], "seoComposition"),
        group("main", "Group", "content", ["summary"], "pageComposition"),
        group("meta", "Group", "seo", ["metaTitle"], "seoComposition"),
      ])
    ).toEqual([
      { name: "CONTENT", count: 2, panels: [["MAIN", "title", "summary"]] },
      { name: "SEO", count: 1, panels: [["META", "metaTitle"]] },
    ]);
  });

  it("collects root groups into a generic tab placed first", () => {
    const tabs = layout([
      group("content", "Tab", null, ["title"]),
      group("no-group", "Group", null, ["loose"]),
      group("orphan", "Group", "deletedTab", ["stray"]),
    ]);
    expect(tabs.map((tab) => tab.name)).toEqual([GENERIC_TAB, "CONTENT"]);
    expect(tabs[0].panels).toEqual([
      ["NO-GROUP", "loose"],
      ["ORPHAN", "stray"],
    ]);
  });

  it("names a tab after its declaration even when a group reaches it first", () => {
    const tabs = layout([
      group("main", "Group", "settings", ["a"]),
      group("settings", "Tab", null, [], "base"),
    ]);
    expect(tabs.map((tab) => tab.name)).toEqual(["SETTINGS"]);
  });

  it("keeps every property of every medium sample type", () => {
    for (const node of (mediumFixture as unknown as SchemaGraph).nodes) {
      const total = editorLayout(node).reduce((sum, tab) => sum + tab.count, 0);
      expect(total).toBe(node.ownPropertyCount + node.composedPropertyCount);
    }
  });
});
