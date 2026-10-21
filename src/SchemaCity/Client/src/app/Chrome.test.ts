import { expect, it } from "vitest";
import type { SchemaGraph, UsageReport } from "../model/types";
import { snapshotParts } from "./Chrome";
import { snapshotTimes } from "./Findings";

const graph = (generatedAt: string) =>
  ({ generatedAt, nodes: [{}, {}] }) as unknown as SchemaGraph;
const usage = (generatedAt: string) =>
  ({ generatedAt, byType: {}, references: [] }) as UsageReport;
// Timestamps built from local parts, so the tests hold in any time zone.
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

it("says only the type count once usage has arrived", () => {
  expect(
    snapshotParts(graph(at(7, 9, 12)), usage(at(6, 23, 59)), false)
  ).toEqual(["2 types"]);
});

it("says usage is loading until it settles, and unavailable when it never came", () => {
  const read = graph(at(7, 9, 12));
  expect(snapshotParts(read, undefined, true)).toEqual([
    "2 types",
    "usage loading",
  ]);
  expect(snapshotParts(read, undefined, false)).toEqual([
    "2 types",
    "usage unavailable",
  ]);
});

it("keeps both times for the hover, and leaves out the epoch a snapshot carries when nothing dated it", () => {
  expect(snapshotTimes(graph(at(7, 9, 12)), usage(at(6, 23, 59)))).toBe(
    "Schema read 2026-10-07 09:12, usage counted 2026-10-06 23:59"
  );
  expect(
    snapshotTimes(graph("1970-01-01T00:00:00Z"), usage("1970-01-01T00:00:00Z"))
  ).toBe("");
});
