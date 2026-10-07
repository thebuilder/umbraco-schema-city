import { describe, expect, it } from "vitest";
import {
  compareSchemas,
  createSnapshot,
  MAX_SNAPSHOT_BYTES,
  parseSnapshot,
  readSnapshotFile,
  snapshotFileName,
} from "./snapshots";
import type { SchemaGraph, SchemaNode, SchemaProperty } from "./types";

const node = (
  id: string,
  alias: string,
  extra: Partial<SchemaNode> = {}
): SchemaNode => ({
  id,
  alias,
  name: alias,
  icon: "icon-document",
  iconColor: null,
  folderId: null,
  isElement: false,
  allowedAsRoot: true,
  variesByCulture: false,
  variesBySegment: false,
  description: null,
  groups: [],
  ownPropertyCount: 1,
  composedPropertyCount: 0,
  templates: [],
  ...extra,
});
const graph = (
  nodes: SchemaNode[],
  edges: SchemaGraph["edges"] = []
): SchemaGraph => ({
  generatedAt: "2026-09-06T00:00:00Z",
  folders: [],
  nodes,
  edges,
});

describe("schema snapshots", () => {
  it("reads valid files, rejects oversized files, and reports malformed JSON", async () => {
    const snapshot = createSnapshot(graph([node("a", "page")]));
    const valid = { size: 20, text: async () => JSON.stringify(snapshot) };
    expect((await readSnapshotFile(valid)).snapshot?.graph.nodes).toHaveLength(
      1
    );
    expect(
      (
        await readSnapshotFile({
          size: MAX_SNAPSHOT_BYTES + 1,
          text: async () => "{}",
        })
      ).error
    ).toContain("larger than 5 MB");
    expect(
      (await readSnapshotFile({ size: 2, text: async () => "{" })).error
    ).toContain("not valid JSON");
    expect(
      (
        await readSnapshotFile({
          size: 2,
          text: () => {
            throw new Error("read");
          },
        })
      ).error
    ).toContain("Could not read");
  });

  it("round trips a versioned snapshot", () => {
    const original = createSnapshot(graph([node("a", "page")]));
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(original)));
    expect(parsed.snapshot?.graph.nodes[0]?.alias).toBe("page");
    expect(parsed.snapshot?.version).toBe(1);
  });

  it("rejects malformed and unsupported snapshots with useful errors", () => {
    expect(parseSnapshot(null).error).toContain("snapshot must be an object");
    expect(
      parseSnapshot({ format: "other", version: 1, capturedAt: "x", graph: {} })
        .error
    ).toContain("format must be schema-city");
    expect(
      parseSnapshot({
        format: "schema-city",
        version: 2,
        capturedAt: "2026-09-06T00:00:00Z",
        graph: {},
      }).error
    ).toContain("version must be 1");
    expect(
      parseSnapshot({
        format: "schema-city",
        version: 1,
        capturedAt: "2026-09-06T00:00:00Z",
        graph: {},
      }).error
    ).toContain("graph.generatedAt");
  });

  it("accepts a property without a Data Type name and rejects a wrong one", () => {
    const withName = (dataTypeName?: unknown) => ({
      format: "schema-city",
      version: 1,
      capturedAt: "2026-09-06T00:00:00Z",
      graph: graph([
        node("a", "page", {
          groups: [
            {
              id: "g",
              alias: "content",
              name: "Content",
              type: "Group",
              parentAlias: null,
              fromCompositionId: null,
              properties: [
                {
                  alias: "title",
                  name: "Title",
                  dataTypeId: "dt",
                  ...(dataTypeName === undefined ? {} : { dataTypeName }),
                  editorAlias: "Umbraco.TextBox",
                  editorUiAlias: null,
                  mandatory: false,
                  variesByCulture: false,
                  fromCompositionId: null,
                  targets: [],
                } as SchemaProperty,
              ],
            },
          ],
        }),
      ]),
    });
    // Snapshots exported before the Data Type name existed have no such key.
    expect(parseSnapshot(withName()).snapshot).toBeDefined();
    expect(parseSnapshot(withName(null)).snapshot).toBeDefined();
    expect(parseSnapshot(withName(7)).error).toContain(
      "dataTypeName must be a string or null"
    );
  });

  it("rejects duplicate ids, cyclic folders, invalid dates, and ambiguous aliases", () => {
    const duplicate = graph([node("a", "page"), node("a", "other")]);
    expect(
      parseSnapshot({
        format: "schema-city",
        version: 1,
        capturedAt: "2026-09-06T00:00:00Z",
        graph: duplicate,
      }).error
    ).toContain("ids must be unique");
    const cyclic = {
      ...graph([node("a", "page")]),
      folders: [
        { id: "one", name: "One", parentId: "two" },
        { id: "two", name: "Two", parentId: "one" },
      ],
    };
    expect(
      parseSnapshot({
        format: "schema-city",
        version: 1,
        capturedAt: "2026-09-06T00:00:00Z",
        graph: cyclic,
      }).error
    ).toContain("must not contain cycles");
    expect(
      parseSnapshot({
        format: "schema-city",
        version: 1,
        capturedAt: "tomorrow",
        graph: graph([node("a", "page")]),
      }).error
    ).toContain("capturedAt must be an ISO date");
    const baseline = graph([node("old-a", "same"), node("old-b", "same")]);
    const current = graph([node("new-a", "same")]);
    expect(compareSchemas(baseline, current).matches.size).toBe(0);
  });

  it("matches a changed environment by unique alias after stable ids fail", () => {
    const baseline = graph(
      [
        node("old-page", "page", { name: "Page", ownPropertyCount: 1 }),
        node("old-base", "base"),
      ],
      [{ kind: "composition", from: "old-page", to: "old-base" }]
    );
    const current = graph(
      [
        node("new-page", "page", { name: "Page", ownPropertyCount: 2 }),
        node("new-base", "base"),
      ],
      [{ kind: "composition", from: "new-page", to: "new-base" }]
    );
    const result = compareSchemas(baseline, current);
    expect(result.matches.get("new-page")).toBe("old-page");
    expect(result.matches.get("new-base")).toBe("old-base");
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed[0]?.details).toContain("ownPropertyCount: 1 -> 2");
  });

  it("ignores generated time and ordering while reporting additions/removals", () => {
    const baseline = graph([node("a", "page"), node("b", "old")]);
    const current = {
      ...graph([node("b", "old"), node("a", "page"), node("c", "new")]),
      generatedAt: "later",
    };
    const result = compareSchemas(baseline, current);
    expect(result.added.map((change) => change.alias)).toEqual(["new"]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("names block targets and Data Types, and lists a target change once", () => {
    const blocks = (
      dataTypeId: string,
      dataTypeName: string,
      to: string[]
    ) => ({
      alias: "body",
      name: "Body",
      dataTypeId,
      dataTypeName,
      editorAlias: "Umbraco.BlockList",
      editorUiAlias: null,
      mandatory: false,
      variesByCulture: false,
      fromCompositionId: null,
      targets: to.map((nodeId) => ({ nodeId, role: "content" as const })),
    });
    const page = (body: ReturnType<typeof blocks>) =>
      node("page", "page", {
        groups: [
          {
            id: "g",
            alias: "content",
            name: "Content",
            type: "Group",
            parentAlias: null,
            fromCompositionId: null,
            properties: [body],
          },
        ],
      });
    const card = node("card-key", "card", { name: "Card", isElement: true });
    const quote = node("quote-key", "quote", {
      name: "Quote",
      isElement: true,
    });
    const before = graph(
      [page(blocks("dt-1", "Textarea", ["card-key", "gone-key"])), card],
      [
        { kind: "block", from: "page", to: "card-key", propertyAlias: "body" },
        { kind: "block", from: "page", to: "gone-key", propertyAlias: "body" },
      ]
    );
    const after = graph(
      [page(blocks("dt-2", "Textstring", ["quote-key"])), card, quote],
      [{ kind: "block", from: "page", to: "quote-key", propertyAlias: "body" }]
    );
    const details =
      compareSchemas(before, after).changed.find((c) => c.alias === "page")
        ?.details ?? [];
    expect(details).toEqual([
      "property content.body Data Type: Textarea to Textstring",
      "target added: content.body -> Quote (content)",
      "target removed: content.body -> Card (content)",
      "target removed: content.body -> gone-key (content)",
    ]);
  });

  it("names the snapshot file after the site and the day", () => {
    expect(
      snapshotFileName("Www.Example.com", "2026-10-07T08:30:00.000Z")
    ).toBe("schema-city-snapshot-www-example-com-2026-10-07.json");
    expect(snapshotFileName("", "2026-10-07T08:30:00.000Z")).toBe(
      "schema-city-snapshot-2026-10-07.json"
    );
  });

  it("names replaced relationships and property-level changes", () => {
    const property = (alias: string, mandatory: boolean) => ({
      alias,
      name: alias,
      dataTypeId: "text",
      dataTypeName: "Textstring",
      editorAlias: "textbox",
      editorUiAlias: null,
      mandatory,
      variesByCulture: false,
      fromCompositionId: null,
      targets: [],
    });
    const before = graph(
      [
        node("page", "page", {
          groups: [
            {
              id: "g",
              alias: "content",
              name: "Content",
              type: "Group",
              parentAlias: null,
              fromCompositionId: null,
              properties: [property("title", false), property("old", false)],
            },
          ],
        }),
        node("old", "old-target"),
        node("base", "base"),
      ],
      [{ kind: "composition", from: "page", to: "old" }]
    );
    const after = graph(
      [
        node("page", "page", {
          groups: [
            {
              id: "g",
              alias: "content",
              name: "Content",
              type: "Group",
              parentAlias: null,
              fromCompositionId: null,
              properties: [property("title", true), property("new", false)],
            },
          ],
        }),
        node("new", "new-target"),
        node("base", "base"),
      ],
      [
        { kind: "composition", from: "page", to: "new" },
        { kind: "allowedChild", from: "page", to: "new" },
      ]
    );
    const details = compareSchemas(before, after).changed[0]?.details ?? [];
    expect(details).toContain(
      "property content.title mandatory: false -> true"
    );
    expect(details).toContain("property removed: content.old");
    expect(details).toContain("property added: content.new");
    expect(details).toContain(
      "relationship added: allowedChild: page -> new-target"
    );
    expect(details).toContain(
      "relationship removed: composition: page -> old-target"
    );
    expect(details).toContain(
      "relationship added: composition: page -> new-target"
    );
  });
});
