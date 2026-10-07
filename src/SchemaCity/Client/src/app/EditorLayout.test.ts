import { expect, it } from "vitest";
import mediumFixture from "../../dev/fixtures/medium.json";
import { GENERIC_TAB } from "../model/editor-layout";
import { findFindings } from "../model/findings";
import type { SchemaGraph } from "../model/types";
import { hasTabRow, propertyFlags } from "./EditorLayout";

const tab = (key: string) => ({
  key,
  name: key || GENERIC_TAB,
  panels: [],
  count: 1,
});

it("draws a tab row only when the type has real tabs", () => {
  expect(hasTabRow([])).toBe(false);
  expect(hasTabRow([tab("")])).toBe(false);
  expect(hasTabRow([tab(""), tab("content")])).toBe(true);
  expect(hasTabRow([tab("content")])).toBe(true);
});

const DUPLICATE_FIRST =
  /^Duplicate alias: seoTitle also comes from .+, with a different editor \(Media Picker\)$/;
const DUPLICATE_SECOND = /with a different editor \(Textstring\)$/;
const VARIANT_BLOCK = /^Culture mismatch: lists .+, which varies by culture$/;

const graph = mediumFixture as unknown as SchemaGraph;
const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
const findings = findFindings(graph);
const flagsOf = (alias: string) => {
  const node = graph.nodes.find((candidate) => candidate.alias === alias);
  if (!node) throw new Error(alias);
  return propertyFlags(
    node,
    findings.filter((finding) => finding.nodeId === node.id),
    nodesById
  );
};

it("marks both rows of a duplicate alias and says their editors differ", () => {
  const flags = [...flagsOf("dupAliasPage").values()];
  expect(flags).toHaveLength(2);
  expect(flags[0]).toMatch(DUPLICATE_FIRST);
  expect(flags[1]).toMatch(DUPLICATE_SECOND);
});

it("marks the block property that lists a deleted Element Type", () => {
  const flags = flagsOf("brokenBlockHost");
  expect([...flags.keys()]).toEqual([":brokenBody"]);
});

it("marks a block property whose Element Type varies on an invariant host", () => {
  const flags = flagsOf("localisedBlockHost");
  expect(flags.get(":localisedBody")).toMatch(VARIANT_BLOCK);
});

it("marks nothing on a type the checks did not flag", () => {
  expect(flagsOf("home").size).toBe(0);
});
