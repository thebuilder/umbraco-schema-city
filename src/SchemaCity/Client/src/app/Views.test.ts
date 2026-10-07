import { expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import type { SchemaGraph } from "../model/types";
import { aboutOf, backFrom, focusScope, pageStep } from "./Views";

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

it("goes back from a type page to the schema-wide view it was opened from", () => {
  expect(backFrom("list", "city")).toBe("list");
  expect(backFrom("editor", "list")).toBe("list");
  expect(backFrom("impact", "tree")).toBe("tree");
});

it("traces the type the impact page was opened on, and edits the selection", () => {
  expect(aboutOf("impact", "b", "a")).toBe("a");
  expect(aboutOf("impact", "b", null)).toBe("b");
  expect(aboutOf("editor", "b", "a")).toBe("b");
});

it("opens a type page on the selection, and says so without one", () => {
  expect(pageStep("editor", "city", "a", "a")).toBe("open");
  expect(pageStep("editor", "city", null, null)).toBe("nudge");
  // Pressed again on the same type, it goes back.
  expect(pageStep("editor", "editor", "a", "a")).toBe("back");
  // A trace of another type moves to the selection rather than closing.
  expect(pageStep("impact", "impact", "b", "a")).toBe("open");
  // With the selection put down, the page key still leads back.
  expect(pageStep("impact", "impact", null, "a")).toBe("back");
});
