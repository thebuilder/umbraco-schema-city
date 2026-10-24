import type { SchemaGraph } from "@schema-city/core/model/types";
import { expect, test } from "vitest";
import { citySummary } from "./a11y";

const graph = { nodes: [{ id: "a" }, { id: "b" }] } as unknown as SchemaGraph;

test("names the type count and the grouping the city is drawn with", () => {
  expect(citySummary(graph, "structure", "3D city")).toBe(
    "3D city of 2 Document Types, grouped by what editors can create where. The List view has the same types as a table."
  );
  expect(citySummary(graph, "folders", "3D city")).toContain(
    "grouped by folder"
  );
});
