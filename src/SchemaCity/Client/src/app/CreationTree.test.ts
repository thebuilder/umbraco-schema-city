import { expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { creationTree, treeRows } from "../model/creation-tree";
import type { SchemaGraph } from "../model/types";
import { openEverything } from "./CreationTree";

it("opens every row of the medium sample and stops, cycles included", () => {
  const tree = creationTree(mediumFixture as unknown as SchemaGraph);
  const { rows, truncated } = treeRows(tree, openEverything(tree));
  expect(truncated).toBe(false);
  expect(rows.some((row) => row.recursive)).toBe(true);
  expect(rows.every((row) => row.open === row.expandable)).toBe(true);
});
