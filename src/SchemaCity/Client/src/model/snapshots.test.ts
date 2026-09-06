import { describe, expect, it } from "vitest";
import {
  compareSchemas,
  createSnapshot,
  MAX_SNAPSHOT_BYTES,
  parseSnapshot,
  readSnapshotFile,
} from "./snapshots";
import type { SchemaGraph, SchemaNode } from "./types";

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

  it("names replaced relationships and property-level changes", () => {
    const property = (alias: string, mandatory: boolean) => ({
      alias,
      name: alias,
      dataTypeId: "text",
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
