import { expect, test } from "vitest";
import type { SchemaGraph } from "../model/types";
import { citySummary } from "./a11y";

const graph = { nodes: [{ id: "a" }, { id: "b" }] } as unknown as SchemaGraph;

test("names the type count and the grouping the city is drawn with", () => {
  expect(citySummary(graph, "structure")).toBe(
    "3D city of 2 Document Types, grouped by what editors can create where. The List view has the same types as a table."
  );
  expect(citySummary(graph, "folders")).toContain("grouped by folder");
});
