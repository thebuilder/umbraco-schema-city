import { expect, it } from "vitest";
import type { PropertyGroup } from "../model/types";
import { topGroups } from "./InspectorProperties";

const group = (
  alias: string,
  type: "Tab" | "Group",
  parentAlias: string | null,
  fromCompositionId: string | null = null
) =>
  ({
    id: `${fromCompositionId ?? "own"}:${alias}`,
    alias,
    name: alias,
    type,
    parentAlias,
    fromCompositionId,
    properties: [],
  }) as PropertyGroup;

it("draws a group once when the type and a composition both declare its tab", () => {
  const outline = topGroups([
    group("seo", "Tab", null),
    group("seo", "Tab", null, "seoComposition"),
    group("meta", "Group", "seo", "seoComposition"),
  ]);
  expect(
    outline.map((top) => [top.id, top.children.map((child) => child.id)])
  ).toEqual([
    ["own:seo", ["seoComposition:meta"]],
    ["seoComposition:seo", []],
  ]);
});
