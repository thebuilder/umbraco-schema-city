import { describe, expect, it } from "vitest";
import type { Finding } from "./findings";
import { type Decision, failureMessage, isReviewed, reviewsOf } from "./review";
import type { SchemaGraph, SchemaNode } from "./types";

const node = (id: string, fingerprint?: string): SchemaNode => ({
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
  fingerprint,
});

const finding = (id: string, extra: Partial<Finding> = {}): Finding => ({
  id,
  kind: "deadEnd",
  severity: "problem",
  summary: "",
  ...extra,
});

const decision = (findingId: string, fingerprint: string): Decision => ({
  findingId,
  status: "intentional",
  reason: "Kept for the import",
  decidedBy: "Ada",
  decidedByKey: "k",
  decidedAt: "2026-10-07T08:41:00Z",
  fingerprint,
});

const graph: SchemaGraph = {
  generatedAt: "2026-10-07T08:00:00Z",
  folders: [],
  nodes: [node("a", "aaaa"), node("b", "bbbb")],
  edges: [],
  dataTypes: [
    {
      id: "dt",
      name: "Spare",
      editorAlias: "Umbraco.TextBox",
      editorUiAlias: null,
      folder: null,
      targets: [],
      otherUses: 0,
      fingerprint: "dddd",
    },
  ],
};

describe("failureMessage", () => {
  it("says what failed, and that a 401 or 403 needs Settings access", () => {
    expect(failureMessage("Saving the decision")).toBe(
      "Saving the decision failed: the server did not answer."
    );
    expect(failureMessage("Saving the decision", 403)).toBe(
      "Saving the decision failed: you need access to the Settings section to review findings."
    );
    expect(
      failureMessage("Saving the decision", 409, "The type changed.")
    ).toBe("Saving the decision failed: The type changed.");
    expect(failureMessage("Undoing the decision", 500)).toBe(
      "Undoing the decision failed: the server answered 500."
    );
  });
});

describe("reviewsOf", () => {
  const findings = [
    finding("deadEnd:a", { nodeId: "a" }),
    finding("deadEnd:b", { nodeId: "b" }),
    finding("unusedDataType:dt", {
      kind: "unusedDataType",
      dataTypeIds: ["dt"],
    }),
  ];

  it("keeps a decision while its subject's fingerprint matches and reopens it after", () => {
    const reviews = reviewsOf(
      findings,
      [
        decision("deadEnd:a", "aaaa"),
        decision("deadEnd:b", "old"),
        decision("unusedDataType:dt", "dddd"),
        decision("deadEnd:gone", "x"),
      ],
      graph
    );
    expect(isReviewed(reviews.get("deadEnd:a"))).toBe(true);
    expect(reviews.get("deadEnd:b")?.reopened).toBe(true);
    expect(isReviewed(reviews.get("deadEnd:b"))).toBe(false);
    expect(isReviewed(reviews.get("unusedDataType:dt"))).toBe(true);
    expect(reviews.has("deadEnd:gone")).toBe(false);
  });

  it("never reopens on a graph without fingerprints", () => {
    const bare = { ...graph, nodes: [node("a")] };
    const reviews = reviewsOf(
      [findings[0] as Finding],
      [decision("deadEnd:a", "")],
      bare
    );
    expect(isReviewed(reviews.get("deadEnd:a"))).toBe(true);
  });
});
