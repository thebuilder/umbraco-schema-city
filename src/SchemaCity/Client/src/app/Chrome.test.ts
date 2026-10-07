import { expect, it } from "vitest";
import type { SchemaGraph, UsageReport } from "../model/types";
import { snapshotParts } from "./Chrome";

const graph = (generatedAt: string) =>
  ({ generatedAt, nodes: [{}, {}] }) as unknown as SchemaGraph;
const usage = (generatedAt: string) =>
  ({ generatedAt, byType: {}, references: [] }) as UsageReport;
// Timestamps built from local parts, so the tests hold in any time zone.
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

it("says the local time for a snapshot read today and the date for an older one", () => {
  expect(
    snapshotParts(
      graph(at(7, 9, 12)),
      usage(at(6, 23, 59)),
      false,
      "2026-10-07"
    )
  ).toEqual(["2 types", "schema read 09:12", "usage 2026-10-06"]);
});

it("leaves out the epoch a snapshot carries when nothing dated it", () => {
  expect(
    snapshotParts(
      graph("1970-01-01T00:00:00Z"),
      usage("1970-01-01T00:00:00Z"),
      false,
      "2026-10-07"
    )
  ).toEqual(["2 types"]);
});

it("says usage is loading until it settles, and unavailable when it never came", () => {
  const read = graph(at(7, 9, 12));
  expect(snapshotParts(read, undefined, true, "2026-10-07")).toContain(
    "usage loading"
  );
  expect(snapshotParts(read, undefined, false, "2026-10-07")).toContain(
    "usage unavailable"
  );
});
