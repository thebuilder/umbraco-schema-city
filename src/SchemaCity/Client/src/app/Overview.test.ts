import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import fixture from "../../dev/fixtures/small.json";
import type { SchemaGraph } from "../model/types";
import { Overview } from "./Overview";

const props = {
  graph: fixture as SchemaGraph,
  view: "city" as const,
  selected: false,
  onFindings: vi.fn(),
  onList: vi.fn(),
  onSearch: vi.fn(),
};

test("orientation gives useful entry points while explaining absent usage", () => {
  const html = renderToStaticMarkup(createElement(Overview, props));
  expect(html).toContain("Review findings");
  expect(html).toContain("Open type list");
  expect(html).toContain("Usage unavailable");
});

test("orientation leaves room for a selected type, list, or empty schema", () => {
  for (const overrides of [
    { selected: true },
    { view: "list" as const },
    { graph: { ...props.graph, nodes: [] } },
  ]) {
    expect(
      renderToStaticMarkup(createElement(Overview, { ...props, ...overrides }))
    ).toBe("");
  }
});
