import { describe, expect, it } from "vitest";
import type { Finding } from "./findings";
import { findingsCsv } from "./findings-export";
import type { SchemaGraph, SchemaNode, UsageReport } from "./types";

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
  generatedAt: "2026-09-06T10:00:00Z",
  folders: [
    { id: "f1", name: "Pages", parentId: null },
    { id: "f2", name: "News", parentId: "f1" },
  ],
  nodes: [
    node("page", { name: "Page, root", folderId: "f2" }),
    node("hub", { name: "Hub" }),
    node("leaf", { name: "Leaf" }),
  ],
  edges: [
    { kind: "allowedChild", from: "page", to: "hub" },
    { kind: "allowedChild", from: "hub", to: "leaf" },
    { kind: "allowedChild", from: "leaf", to: "leaf" },
  ],
};

const usage: UsageReport = {
  generatedAt: "2026-09-06T10:02:00Z",
  byType: {
    page: {
      total: 12,
      published: 9,
      drafts: 2,
      trashed: 1,
      rootInstances: 0,
      cultures: [],
      lastEdited: "2026-09-05T08:00:00",
    },
  },
  references: [],
};

const broken: Finding = {
  id: "brokenBlock:page",
  kind: "brokenBlock",
  severity: "problem",
  nodeId: "page",
  summary: "Blocks, settings\nneed review",
  related: ["deleted-key", "hub"],
};

const lines = (text: string) => text.trimEnd().split("\n");

describe("findingsCsv", () => {
  it("puts the header row first, with no preamble", () => {
    const [header] = lines(findingsCsv([broken], graph, usage));
    expect(header).toBe(
      "Kind,Kind code,Severity,Type,Alias,Type key,Folder,Total,Published,Drafts,Trashed,Last edited,Backoffice path,Detail,Explanation,What to do,Related,Unused branch root,Filter,Schema snapshot,Usage snapshot,Data Types,Data Type keys"
    );
  });

  it("writes one row per finding with usage, folder, path and readable related names", () => {
    const output = findingsCsv([broken], graph, usage, ["brokenBlock"]);
    expect(output).toContain(
      'Broken block,brokenBlock,problem,"Page, root",page,page,Pages/News,12,9,2,1,2026-09-05,/umbraco/section/settings/workspace/document-type/edit/page,"Blocks, settings\nneed review",'
    );
    expect(output).toContain(
      ",Missing Element Type deleted-key | Hub,,Broken block,2026-09-06,2026-09-06,,\n"
    );
  });

  it("says when the usage snapshot is missing and the export is not filtered", () => {
    const [, row] = lines(findingsCsv([{ ...broken, summary: "x" }], graph));
    expect(row).toContain(",page,Pages/News,,,,,,/umbraco/");
    expect(row?.endsWith(",All kinds,2026-09-06,unavailable,,")).toBe(true);
  });

  it("names the topmost unused ancestor of each unused type, cycle safe", () => {
    const unused = (nodeId: string): Finding => ({
      id: `unusedType:${nodeId}`,
      kind: "unusedType",
      severity: "problem",
      nodeId,
      summary: "",
    });
    const rows = lines(
      findingsCsv(
        [
          unused("hub"),
          unused("leaf"),
          { ...broken, nodeId: "hub", summary: "x" },
        ],
        graph,
        usage
      )
    ).slice(1);
    // Hub's parent has content, so hub tops its own branch, and leaf is under it.
    // The column is for unused type rows only, not another kind on the same type.
    expect(rows.map((row) => row.split(",").slice(-6)[0])).toEqual([
      "Hub",
      "Hub",
      "",
    ]);
  });

  it("writes a Data Type finding with blank type columns and the Data Type's path", () => {
    const withDataType: SchemaGraph = {
      ...graph,
      dataTypes: [
        {
          id: "dt-old",
          name: "Old Picker",
          editorAlias: "Umbraco.MultiNodeTreePicker",
          editorUiAlias: null,
          folder: "Legacy",
          targets: [],
          otherUses: 0,
        },
      ],
    };
    const [, row] = lines(
      findingsCsv(
        [
          {
            id: "unusedDataType:dt-old",
            kind: "unusedDataType",
            severity: "note",
            summary: "Editor Umbraco.MultiNodeTreePicker",
            dataTypeIds: ["dt-old"],
          },
        ],
        withDataType,
        usage
      )
    );
    expect(row).toContain(
      "Unused Data Type,unusedDataType,note,,,,Legacy,,,,,,/umbraco/section/settings/workspace/data-type/edit/dt-old,"
    );
    expect(row?.endsWith(",Old Picker,dt-old")).toBe(true);
  });

  it.each(["", "\t", "  ", "\r\n"])(
    "neutralizes formulas after leading whitespace %j",
    (prefix) => {
      const formulaGraph = {
        ...graph,
        nodes: [node("page", { name: `${prefix}=HYPERLINK("x")` })],
      };
      expect(
        findingsCsv(
          [
            {
              id: "noProperties:page",
              kind: "noProperties",
              severity: "note",
              nodeId: "page",
              summary: "check",
            },
          ],
          formulaGraph
        )
      ).toContain(`"'${prefix}=HYPERLINK(""x"")"`);
    }
  );
});
