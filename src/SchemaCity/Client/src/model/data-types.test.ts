import { describe, expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import mediumUsageFixture from "../../dev/fixtures/medium-usage.json";
import { sortRows } from "../app/TypeTable";
import {
  allowedBlocks,
  dataTypeIndex,
  dataTypeUsers,
  matchDataTypes,
  storedByElementType,
} from "./data-types";
import type {
  SchemaDataType,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
  UsageReport,
} from "./types";

const medium = mediumFixture as unknown as SchemaGraph;
const mediumUsage = mediumUsageFixture as unknown as UsageReport;

const property = (
  alias: string,
  dataTypeId: string,
  fromCompositionId: string | null = null
): SchemaProperty => ({
  alias,
  name: alias,
  dataTypeId,
  dataTypeName: dataTypeId.toUpperCase(),
  editorAlias:
    dataTypeId === "blocks" ? "Umbraco.BlockList" : "Umbraco.TextBox",
  editorUiAlias: null,
  mandatory: false,
  variesByCulture: false,
  fromCompositionId,
  targets: [],
});

const node = (id: string, properties: SchemaProperty[]): SchemaNode => ({
  id,
  alias: id,
  name: id,
  icon: "icon-document",
  iconColor: null,
  folderId: null,
  isElement: false,
  allowedAsRoot: true,
  variesByCulture: false,
  variesBySegment: false,
  description: null,
  groups: [
    {
      id: "g",
      alias: "g",
      name: "G",
      type: "Group",
      parentAlias: null,
      fromCompositionId: null,
      properties,
    },
  ],
  ownPropertyCount: properties.length,
  composedPropertyCount: 0,
  templates: [],
});

const blocks: SchemaDataType = {
  id: "blocks",
  name: "Blocks",
  editorAlias: "Umbraco.BlockList",
  editorUiAlias: "Umb.PropertyEditorUi.BlockList",
  folder: null,
  targets: [
    { nodeId: "card", role: "content" },
    { nodeId: "gone", role: "content" },
    { nodeId: "style", role: "settings" },
  ],
  otherUses: 0,
};

const graph: SchemaGraph = {
  generatedAt: "2026-10-07T00:00:00Z",
  folders: [],
  nodes: [
    node("seo", [property("meta", "text")]),
    node("page", [property("body", "blocks"), property("meta", "text", "seo")]),
    node("card", []),
  ],
  edges: [],
  dataTypes: [
    blocks,
    {
      ...blocks,
      id: "spare",
      name: "Spare",
      targets: [],
      editorAlias: "Umbraco.TextBox",
    },
  ],
};

const usage: UsageReport = {
  generatedAt: "2026-10-07T00:00:00Z",
  byType: {},
  references: [],
  blocks: {
    partial: false,
    valuesRead: 3,
    unreadable: 0,
    byDataType: [
      {
        dataTypeId: "blocks",
        values: 3,
        items: 3,
        elements: [
          { elementTypeId: "card", content: 14, settings: 0, items: 3 },
          { elementTypeId: "style", content: 0, settings: 2, items: 2 },
          { elementTypeId: "retired", content: 1, settings: 0, items: 1 },
        ],
      },
    ],
  },
};

describe("dataTypeIndex", () => {
  it("lists every Data Type with its properties, types and stored blocks", () => {
    const rows = dataTypeIndex(graph, usage);
    expect(
      rows.map((row) => [row.name, row.properties, row.types, row.stored])
    ).toEqual([
      ["Blocks", 1, 1, 17],
      ["Spare", 0, 0, null],
      // Named only by properties: the composed copy on page counts as a type,
      // not as a second property.
      ["TEXT", 1, 2, null],
    ]);
    expect(rows.find((row) => row.id === "text")?.listed).toBe(false);
  });

  it("leaves stored blocks unknown until a report counts them", () => {
    expect(dataTypeIndex(graph)[0]?.stored).toBeNull();
  });

  it("covers every Data Type the seeded properties use", () => {
    const listed = new Set(dataTypeIndex(medium).map((row) => row.id));
    for (const each of medium.nodes)
      for (const group of each.groups)
        for (const p of group.properties)
          expect(listed).toContain(p.dataTypeId);
  });
});

it("finds every type using a Data Type, composed properties included", () => {
  const users = dataTypeUsers(graph, "text");
  expect(users.map((user) => user.node.id)).toEqual(["page", "seo"]);
  expect(users[0]?.properties[0]?.fromCompositionId).toBe("seo");
});

it("pairs each offered block with its stored count and lists the ones no longer offered", () => {
  const nodesById = new Map(graph.nodes.map((each) => [each.id, each]));
  expect(allowedBlocks(blocks, usage, nodesById)).toEqual({
    content: [
      { id: "card", name: "card", stored: 14 },
      { id: "gone", name: null, stored: 0 },
    ],
    settings: [{ id: "style", name: null, stored: 2 }],
    notOffered: [{ id: "retired", name: null, stored: 1 }],
  });
  expect(allowedBlocks(blocks, undefined, nodesById).content[0]?.stored).toBe(
    null
  );
});

it("adds stored blocks up per Element Type across Data Types", () => {
  const stored = storedByElementType(mediumUsage);
  const quote = medium.nodes.find((each) => each.alias === "elementQuote");
  // 33 in the body blocks and 5 in the rich text.
  expect(stored.get(quote?.id ?? "")?.blocks).toBe(38);
  expect(stored.get(quote?.id ?? "")?.dataTypeIds).toHaveLength(2);
});

it("filters by name, editor or key and sorts by any column", () => {
  const rows = dataTypeIndex(graph, usage);
  expect(matchDataTypes(rows, "textbox").map((row) => row.id)).toEqual([
    "spare",
    "text",
  ]);
  expect(matchDataTypes(rows, " ").length).toBe(3);
  // Built-ins wait behind the switch, except the one whose page is open.
  const withBuiltIn = rows.map((row) =>
    row.id === "spare" ? { ...row, isBuiltIn: true } : row
  );
  const ids = (options: { builtIn?: boolean; keep?: string | null }) =>
    matchDataTypes(withBuiltIn, "", options).map((row) => row.id);
  expect(ids({ builtIn: false })).toEqual(["blocks", "text"]);
  expect(ids({ builtIn: false, keep: "spare" })).toEqual([
    "blocks",
    "spare",
    "text",
  ]);
  expect(ids({ builtIn: true })).toHaveLength(3);
  expect(sortRows(rows, "types", false).map((row) => row.id)).toEqual([
    "text",
    "blocks",
    "spare",
  ]);
  // No stored count sorts below a count of any size.
  expect(sortRows(rows, "stored", true).map((row) => row.id)).toEqual([
    "spare",
    "text",
    "blocks",
  ]);
  expect(sortRows(rows, "editor", true)[0]?.id).toBe("blocks");
});
