import { expect, test } from "vitest";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { sortRows, typeRows } from "./TypeTable";

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
    element: false,
    root: true,
    own: 3,
    composed: 0,
    // Two allowed children, and the block edge is not one of them.
    children: 2,
    usage: null,
  });
  expect(rows[1].element).toBe(true);
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

  expect(typeRows(graph, usage).map((row) => row.usage)).toEqual([12, 0, 0]);
});

test("clicking a header sorts by it, and clicking it again turns it round", () => {
  const rows = typeRows(graph);
  const names = (key: Parameters<typeof sortRows>[1], ascending: boolean) =>
    sortRows(rows, key, ascending).map((row) => row.name);

  expect(names("name", true)).toEqual(["Article", "Card", "Home"]);
  expect(names("name", false)).toEqual(["Home", "Card", "Article"]);
  expect(names("own", false)).toEqual(["Home", "Article", "Card"]);
  // Equal numbers keep the name order, so the table never shuffles under a click.
  expect(names("children", true)).toEqual(["Article", "Card", "Home"]);
});
