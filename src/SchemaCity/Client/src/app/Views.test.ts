import { expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import type { SchemaGraph } from "../model/types";
import { focusScope } from "./Views";

const graph = mediumFixture as unknown as SchemaGraph;
const idOf = (alias: string) =>
  graph.nodes.find((node) => node.alias === alias)?.id ?? "";

it("has no scope out of focus, so the lists show every type", () => {
  expect(focusScope(graph, null, 1)).toBeNull();
});

it("scopes the lists to the focused type and what one step reaches", () => {
  const article = idOf("article");
  const scope = focusScope(graph, article, 1);
  expect(scope?.around).toBe(article);
  expect(scope?.ids.has(article)).toBe(true);
  // Article composes Seo Composition, so one step reaches it.
  expect(scope?.ids.has(idOf("seoComposition"))).toBe(true);
  // A wider step never shows fewer types.
  expect(focusScope(graph, article, 2)?.ids.size).toBeGreaterThanOrEqual(
    scope?.ids.size ?? 0
  );
});
