import { describe, expect, it } from "vitest";
import type { SchemaGraph } from "../../model/types";
import { neighboursOf } from "./graph-links";

const graphOf = (edges: SchemaGraph["edges"]): SchemaGraph => ({
  generatedAt: "2026-09-03T00:00:00Z",
  folders: [],
  nodes: [],
  edges,
});

describe("neighboursOf", () => {
  it("always includes the node itself", () => {
    expect(neighboursOf(graphOf([]), "a")).toEqual(new Set(["a"]));
  });

  it("follows a link edge in either direction", () => {
    const graph = graphOf([
      { kind: "allowedChild", from: "a", to: "b" },
      { kind: "reference", from: "c", to: "a", propertyAlias: "x" },
    ]);

    expect(neighboursOf(graph, "a")).toEqual(new Set(["a", "b", "c"]));
  });

  it("ignores edges that do not touch the node", () => {
    const graph = graphOf([{ kind: "allowedChild", from: "b", to: "c" }]);

    expect(neighboursOf(graph, "a")).toEqual(new Set(["a"]));
  });

  it("does not follow a kind outside the link set", () => {
    // "kind" is widened past EdgeKind on purpose: a future kind should stay
    // excluded until this set is deliberately updated for it.
    const graph = graphOf([
      { kind: "future" as SchemaGraph["edges"][number]["kind"], from: "a", to: "b" },
    ]);

    expect(neighboursOf(graph, "a")).toEqual(new Set(["a"]));
  });
});
