import { expect, test } from "vitest";
import type { Finding, FindingKind } from "../model/findings";
import { filterFindings, snapshotDate } from "./Findings";

const finding = (kind: FindingKind, nodeId: string): Finding => ({
  id: `${kind}:${nodeId}`,
  kind,
  severity: "note",
  nodeId,
  summary: "",
});

test("a picked kind with no rows left stops filtering instead of hiding every row", () => {
  // No template was picked, then usage arrived and those rows became unused types.
  const before = [finding("noTemplate", "a"), finding("complexity", "b")];
  expect(filterFindings(before, ["noTemplate"]).matched).toHaveLength(1);

  const after = [finding("unusedType", "a"), finding("complexity", "b")];
  const { active, matched, present } = filterFindings(after, ["noTemplate"]);
  expect(present).not.toContain("noTemplate");
  expect(active).toEqual([]);
  expect(matched).toEqual(after);
});

test("keeps the picked kinds that still have rows", () => {
  const rows = [finding("unusedType", "a"), finding("complexity", "b")];
  const { active, matched } = filterFindings(rows, [
    "noTemplate",
    "complexity",
  ]);
  expect(active).toEqual(["complexity"]);
  expect(matched.map((row) => row.nodeId)).toEqual(["b"]);
});

test("dates a snapshot to the minute in local time and hides a missing or epoch date", () => {
  // Built from local parts, so the test holds in any time zone the suite runs in.
  const local = new Date(2026, 9, 7, 8, 41, 12, 500);
  expect(snapshotDate(local.toISOString())).toBe("2026-10-07 08:41");
  // An offset other than the reader's is converted, not printed as written.
  expect(snapshotDate("2026-10-07T23:30:00-05:00")).toBe(
    snapshotDate(new Date(Date.UTC(2026, 9, 8, 4, 30)).toISOString())
  );
  expect(snapshotDate("1970-01-01T00:00:00+00:00")).toBeNull();
  expect(snapshotDate("0001-01-01T00:00:00")).toBeNull();
  expect(snapshotDate(undefined)).toBeNull();
  expect(snapshotDate("")).toBeNull();
});
