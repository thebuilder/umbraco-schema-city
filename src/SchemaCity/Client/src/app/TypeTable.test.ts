import { expect, test } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { plannedBaseline } from "../../dev/planned-baseline";
import { groupChanges } from "../model/changes";
import { compareSchemas } from "../model/snapshots";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import {
  compareRows,
  type SortKey,
  sortRows,
  typeRows,
  visibleRows,
} from "./TypeTable";

const node = (id: string, extra: Partial<SchemaNode> = {}): SchemaNode => ({
  id,
  alias: id,
  name: id,
  icon: "icon-document",
  iconColor: null,
  folderId: null,
  isElement: false,
  allowedAsRoot: false,
  variesByCulture: false,
  variesBySegment: false,
  description: null,
  groups: [],
  ownPropertyCount: 0,
  composedPropertyCount: 0,
  templates: [],
  ...extra,
});

const graph: SchemaGraph = {
  generatedAt: "",
  folders: [],
  nodes: [
    node("home", { name: "Home", allowedAsRoot: true, ownPropertyCount: 3 }),
    node("card", { name: "Card", isElement: true, composedPropertyCount: 2 }),
    node("article", { name: "Article", ownPropertyCount: 1 }),
  ],
  edges: [
    { kind: "allowedChild", from: "home", to: "article" },
    { kind: "allowedChild", from: "home", to: "home" },
    { kind: "block", from: "article", to: "card" },
  ],
};

test("a row carries what the table shows about a type", () => {
  const rows = typeRows(graph);

  expect(rows[0]).toEqual({
    id: "home",
    name: "Home",
    alias: "home",
    role: "page",
    root: true,
    own: 3,
    composed: 0,
    // Two allowed children, and the block edge is not one of them.
    children: 2,
    usage: null,
  });
  expect(rows[1].role).toBe("element");
});

test("usage is a count when the report is in, and absent when it is not", () => {
  const usage: UsageReport = {
    generatedAt: "",
    byType: {
      home: {
        total: 12,
        published: 12,
        drafts: 0,
        trashed: 0,
        rootInstances: 1,
        cultures: [],
        lastEdited: null,
      },
    },
    references: [],
  };

  // Card is an Element Type: it never holds content of its own, so it shows no
  // count rather than a 0 that reads as unused, as the inspector chips do.
  expect(typeRows(graph, usage).map((row) => row.usage)).toEqual([12, null, 0]);
});

test("clicking a header sorts by it, and clicking it again turns it round", () => {
  const rows = typeRows(graph);
  const names = (key: SortKey, ascending: boolean) =>
    sortRows(rows, key, ascending).map((row) => row.name);

  expect(names("name", true)).toEqual(["Article", "Card", "Home"]);
  expect(names("name", false)).toEqual(["Home", "Card", "Article"]);
  expect(names("own", false)).toEqual(["Home", "Article", "Card"]);
  // Equal numbers keep the name order, so the table never shuffles under a click.
  expect(names("children", true)).toEqual(["Article", "Card", "Home"]);
  // A role sorts as text, by name inside it.
  expect(names("role", true)).toEqual(["Card", "Article", "Home"]);
});

test("lists a removed type after the current ones, and says how each changed", () => {
  // The medium schema taken as the baseline this time, so Press Release is removed.
  const baseline = mediumFixture as SchemaGraph;
  const current = plannedBaseline(baseline);
  const changes = groupChanges(compareSchemas(baseline, current));
  const rows = compareRows(current, undefined, { baseline, changes });
  const change = (name: string) =>
    rows.find((row) => row.name === name)?.change;
  expect(rows).toHaveLength(baseline.nodes.length);
  expect(rows[rows.length - 1]?.name).toBe("Press Release");
  expect(change("Press Release")).toBe("removed");
  expect(change("Seo Composition")).toBe("changed");
  expect(change("Home")).toBe("side effect");
  expect(change("Settings")).toBe("none");
  expect(compareRows(current, undefined, null)[0]?.change).toBeUndefined();
});

test("filters by change, and finds a removed type by name but not in focus", () => {
  const rows = [
    ...typeRows(
      { ...graph, nodes: [node("home"), node("card")], edges: [] },
      undefined,
      new Map([["home", "changed"]])
    ),
    {
      ...typeRows({ ...graph, nodes: [node("legacy")], edges: [] })[0],
      change: "removed" as const,
    },
  ] as ReturnType<typeof typeRows>;
  const ids = (options: Partial<Parameters<typeof visibleRows>[1]>) =>
    visibleRows(rows, {
      matched: null,
      query: "",
      scope: null,
      filter: "all",
      ...options,
    }).map((row) => row.id);
  expect(ids({})).toEqual(["home", "card", "legacy"]);
  expect(ids({ filter: "any" })).toEqual(["home", "legacy"]);
  expect(ids({ filter: "none" })).toEqual(["card"]);
  expect(ids({ matched: new Set(["card"]), query: "LEG" })).toEqual([
    "card",
    "legacy",
  ]);
  expect(ids({ matched: new Set(["home"]), scope: new Set(["home"]) })).toEqual(
    ["home"]
  );
});
