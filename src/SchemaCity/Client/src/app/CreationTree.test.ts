import { expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { creationTree, treeRows } from "../model/creation-tree";
import type { SchemaGraph } from "../model/types";
import { type Branch, nest, openEverything } from "./CreationTree";

it("opens every row of the medium sample and stops, cycles included", () => {
  const tree = creationTree(mediumFixture as unknown as SchemaGraph);
  const { rows, truncated } = treeRows(tree, openEverything(tree));
  expect(truncated).toBe(false);
  expect(rows.some((row) => row.recursive)).toBe(true);
  expect(rows.every((row) => row.open === row.expandable)).toBe(true);
});

it("nests the flat rows so each sits under its parent row", () => {
  const tree = creationTree(mediumFixture as unknown as SchemaGraph);
  const { rows } = treeRows(tree, openEverything(tree));
  const branches = nest(rows);
  // Every row comes back once, at the depth its key says, under the row whose key
  // is its own minus the last step.
  const seen: string[] = [];
  const walk = (list: Branch[], parent: string | null, depth: number) => {
    for (const { row, children } of list) {
      seen.push(row.key);
      expect(row.depth).toBe(depth);
      expect(parent === null || row.key.startsWith(`${parent}/`)).toBe(true);
      walk(children, row.key, depth + 1);
    }
  };
  walk(branches, null, 0);
  expect(seen).toEqual(rows.map((row) => row.key));
  expect(branches.map((branch) => branch.row.id)).toEqual(tree.roots);
});
