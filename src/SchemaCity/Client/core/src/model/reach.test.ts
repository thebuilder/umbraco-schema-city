import { expect, test } from "vitest";
import { reachableWithin } from "./reach";
import type { SchemaGraph } from "./types";

const graph = {
  nodes: ["a", "b", "c", "d"].map((id) => ({ id })),
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "a" },
    { from: "d", to: "c" },
    { from: "a", to: "missing" },
  ],
} as SchemaGraph;
test("expands one relationship step at a time in either direction and ignores missing types", () => {
  expect(reachableWithin(graph, "a", 0)).toEqual(new Set(["a"]));
  expect(reachableWithin(graph, "a", 1)).toEqual(new Set(["a", "b", "c"]));
  expect(reachableWithin(graph, "a", 2)).toEqual(new Set(["a", "b", "c", "d"]));
  expect(reachableWithin(graph, "a", 100)).toEqual(
    reachableWithin(graph, "a", 2)
  );
  expect(reachableWithin(graph, "unknown", 2)).toEqual(new Set());
});
