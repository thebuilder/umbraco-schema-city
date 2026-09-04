import { describe, expect, it } from "vitest";
import { neighbourhoods } from "./neighbourhood";
import type { SchemaGraph, SchemaNode } from "./types";

const node = (alias: string): SchemaNode => ({
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
  ownPropertyCount: 0,
  composedPropertyCount: 0,
  templates: [],
});

const graph = (
  aliases: string[],
  edges: SchemaGraph["edges"]
): SchemaGraph => ({
  generatedAt: "2026-09-03T00:00:00Z",
  folders: [],
  nodes: aliases.map(node),
  edges,
});

describe("neighbourhoods", () => {
  it("splits allowedChild into parents and children", () => {
    const map = neighbourhoods(
      graph(
        ["home", "page", "widget"],
        [
          { kind: "allowedChild", from: "home", to: "page" },
          { kind: "allowedChild", from: "home", to: "widget" },
        ]
      )
    );

    expect(map.get("home")?.allowedChildren).toEqual(["page", "widget"]);
    expect(map.get("home")?.allowedParents).toEqual([]);
    expect(map.get("page")?.allowedParents).toEqual(["home"]);
  });

  it("groups block targets by property alias and lists the host on the target", () => {
    const map = neighbourhoods(
      graph(
        ["page", "quote", "card"],
        [
          { kind: "block", from: "page", to: "quote", propertyAlias: "body" },
          { kind: "block", from: "page", to: "card", propertyAlias: "body" },
          { kind: "block", from: "page", to: "card", propertyAlias: "aside" },
        ]
      )
    );

    expect(map.get("page")?.blockTargets).toEqual([
      { propertyAlias: "aside", ids: ["card"] },
      { propertyAlias: "body", ids: ["card", "quote"] },
    ]);
    expect(map.get("card")?.blockHosts).toEqual(["page"]);
  });

  it("keeps a block target that resolves to no node, sorted last", () => {
    const map = neighbourhoods(
      graph(
        ["page", "card"],
        [
          {
            kind: "block",
            from: "page",
            to: "deleted-key",
            propertyAlias: "body",
          },
          { kind: "block", from: "page", to: "card", propertyAlias: "body" },
        ]
      )
    );

    expect(map.get("page")?.blockTargets[0]?.ids).toEqual([
      "card",
      "deleted-key",
    ]);
  });

  it("separates references out from references in, and compositions from inherits", () => {
    const map = neighbourhoods(
      graph(
        ["page", "article", "base"],
        [
          {
            kind: "reference",
            from: "page",
            to: "article",
            propertyAlias: "related",
          },
          { kind: "composition", from: "page", to: "base" },
          { kind: "inherits", from: "page", to: "base" },
        ]
      )
    );

    expect(map.get("page")?.referencesOut).toEqual([
      { propertyAlias: "related", ids: ["article"] },
    ]);
    expect(map.get("article")?.referencesIn).toEqual(["page"]);
    expect(map.get("page")?.compositions).toEqual(["base"]);
    expect(map.get("page")?.inherits).toEqual(["base"]);
  });
});
