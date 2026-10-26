import { describe, expect, it } from "vitest";
import {
  creationTree,
  exclusionLine,
  ROW_LIMIT,
  treeRows,
} from "./creation-tree";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "./types";

const graph = (
  nodes: [string, Partial<SchemaNode>?][],
  edges: [SchemaEdge["kind"], string, string][]
) =>
  ({
    nodes: nodes.map(([id, extra]) => ({
      id,
      name: id,
      isElement: false,
      allowedAsRoot: false,
      ...extra,
    })),
    edges: edges.map(([kind, from, to]) => ({ kind, from, to })),
  }) as SchemaGraph;

const ids = (rows: { id: string; depth: number }[]) =>
  rows.map((row) => `${"-".repeat(row.depth)}${row.id}`);

describe("creationTree", () => {
  it("starts from every root and lists children by name", () => {
    const tree = creationTree(
      graph(
        [
          ["site", { allowedAsRoot: true }],
          ["blog", { allowedAsRoot: true }],
          ["b"],
          ["a"],
        ],
        [
          ["allowedChild", "site", "b"],
          ["allowedChild", "site", "a"],
        ]
      )
    );
    expect(tree.roots).toEqual(["blog", "site"]);
    expect(tree.children.get("site")).toEqual(["a", "b"]);
    expect(tree.unreachable).toEqual([]);
  });

  it("finds a rootless chain, not only types without a parent", () => {
    const tree = creationTree(
      graph(
        [["home", { allowedAsRoot: true }], ["orphan"], ["orphanChild"]],
        [["allowedChild", "orphan", "orphanChild"]]
      )
    );
    expect(tree.unreachable).toEqual([
      { id: "orphan", parents: [] },
      { id: "orphanChild", parents: ["orphan"] },
    ]);
  });

  it("leaves out Element Types and compositions nothing can create", () => {
    const tree = creationTree(
      graph(
        [
          ["home", { allowedAsRoot: true }],
          ["seo"],
          ["card", { isElement: true }],
          ["base"],
          ["page"],
        ],
        [
          ["composition", "home", "seo"],
          ["composition", "page", "base"],
          ["allowedChild", "page", "base"],
        ]
      )
    );
    // base is composed, but it can also be created under page, so it stays.
    expect(tree.unreachable.map((entry) => entry.id)).toEqual(["base", "page"]);
    expect(tree.excluded).toEqual({ elements: 1, compositions: 1 });
  });
});

describe("treeRows", () => {
  const cyclic = creationTree(
    graph(
      [["home", { allowedAsRoot: true }], ["folder"], ["page"]],
      [
        ["allowedChild", "home", "folder"],
        ["allowedChild", "folder", "folder"],
        ["allowedChild", "folder", "page"],
        ["allowedChild", "page", "folder"],
      ]
    )
  );

  it("shows only the roots until a row is expanded", () => {
    expect(ids(treeRows(cyclic, new Set()).rows)).toEqual(["home"]);
  });

  it("marks a type already in its own ancestry and does not expand it", () => {
    const { rows } = treeRows(
      cyclic,
      new Set(["home", "home/folder", "home/folder/page"])
    );
    expect(ids(rows)).toEqual([
      "home",
      "-folder",
      "--folder",
      "--page",
      "---folder",
    ]);
    expect(rows.filter((row) => row.recursive).map((row) => row.key)).toEqual([
      "home/folder/folder",
      "home/folder/page/folder",
    ]);
    expect(rows.some((row) => row.recursive && row.expandable)).toBe(false);
  });

  it("shows a type under each parent that allows it", () => {
    const tree = creationTree(
      graph(
        [
          ["a", { allowedAsRoot: true }],
          ["b", { allowedAsRoot: true }],
          ["shared"],
        ],
        [
          ["allowedChild", "a", "shared"],
          ["allowedChild", "b", "shared"],
        ]
      )
    );
    expect(ids(treeRows(tree, new Set(["a", "b"])).rows)).toEqual([
      "a",
      "-shared",
      "b",
      "-shared",
    ]);
  });

  it("opens every path to a match and hides the rest", () => {
    const { rows } = treeRows(cyclic, new Set(), new Set(["page"]));
    expect(ids(rows)).toEqual(["home", "-folder", "--page"]);
  });

  it("stops at the row limit when paths fan out and join again", () => {
    // Two types per level, each allowing both on the next: 2^12 paths to the bottom.
    const levels = Array.from({ length: 12 }, (_, level) => [
      `${level}a`,
      `${level}b`,
    ]);
    const tree = creationTree(
      graph(
        levels
          .flat()
          .map((id): [string, Partial<SchemaNode>] => [
            id,
            { allowedAsRoot: id === "0a" },
          ]),
        levels
          .slice(1)
          .flatMap((next, level) =>
            levels[level].flatMap((from) =>
              next.map((to): [SchemaEdge["kind"], string, string] => [
                "allowedChild",
                from,
                to,
              ])
            )
          )
      )
    );
    const { rows, truncated } = treeRows(tree, new Set(), new Set(["11a"]));
    expect(rows).toHaveLength(ROW_LIMIT);
    expect(truncated).toBe(true);
  });
});

it("says what the unreachable list leaves out, in the singular when it is one", () => {
  expect(exclusionLine({ elements: 17, compositions: 6 })).toBe(
    "17 Element Types and 6 compositions are left out, since editors never create them in the content tree."
  );
  expect(exclusionLine({ elements: 0, compositions: 1 })).toBe(
    "1 composition is left out, since editors never create it in the content tree."
  );
  expect(exclusionLine({ elements: 0, compositions: 0 })).toBe(null);
});
