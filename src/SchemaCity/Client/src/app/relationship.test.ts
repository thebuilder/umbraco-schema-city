import { expect, test } from "vitest";
import type { SchemaEdge, SchemaNode } from "../model/types";
import { describeRelationship, uniqueConnections } from "./relationship";

const nodes = new Map([
  ["a", { name: "Article" }],
  ["b", { name: "SEO" }],
]) as Map<string, SchemaNode>;
for (const kind of [
  "allowedChild",
  "composition",
  "inherits",
  "block",
  "reference",
] as const)
  test(`${kind} preserves source and target when read from either endpoint`, () => {
    const edge: SchemaEdge = {
      kind,
      from: "a",
      to: "b",
      propertyAlias: "modules",
      role: "settings",
    };
    const outgoing = describeRelationship(edge, nodes, "a");
    const incoming = describeRelationship(edge, nodes, "b");
    expect(outgoing.detail).toBe(incoming.detail);
    expect(incoming.detail).toContain("Article");
    expect(incoming.detail).toContain("SEO");
    expect(outgoing.direction).toBe("Outgoing");
    expect(incoming.direction).toBe("Incoming");
    if (kind === "block")
      expect(incoming.detail).toBe(
        "Article.modules allows SEO as block settings."
      );
    if (kind === "reference")
      expect(incoming.detail).toContain("configuration, not observed usage");
  });

test("shared road explanations deduplicate edges but preserve distinct properties", () => {
  const edge: SchemaEdge = {
    kind: "block",
    from: "a",
    to: "b",
    propertyAlias: "body",
    role: "content",
  };
  const other = { ...edge, propertyAlias: "sidebar" };
  expect(uniqueConnections([edge, { ...edge }, other])).toEqual([edge, other]);
});
