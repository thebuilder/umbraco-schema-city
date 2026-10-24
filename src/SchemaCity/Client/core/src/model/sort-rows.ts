import type { ChangeKind } from "./changes";

/**
 * The Change column's order, most serious first: a removed type breaks whatever
 * still points at it, a type's own edits come next, then a new type, then a type
 * that only moved because another did. Alphabetical put "added" on top.
 */
const CHANGE_SEVERITY: (ChangeKind | "none")[] = [
  "removed",
  "changed",
  "added",
  "side effect",
  "none",
];

/**
 * Sorted by one column. Change sorts by severity, other text as text, everything
 * else by number, with a type the usage report says nothing about at the bottom
 * either way. Ties fall back to the name, so the order is stable however often you
 * click a header. The Data Types list sorts its rows the same way.
 */
export function sortRows<Row extends { name: string }>(
  rows: Row[],
  key: keyof Row,
  ascending: boolean
): Row[] {
  const number = (row: Row) => {
    const value: unknown = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    return Number.NEGATIVE_INFINITY;
  };
  const severity = (row: Row) =>
    CHANGE_SEVERITY.indexOf(row[key] as ChangeKind | "none");
  const byValue = (a: Row, b: Row) => {
    if (key === "change") return severity(a) - severity(b);
    return typeof a[key] === "string"
      ? String(a[key]).localeCompare(String(b[key]))
      : number(a) - number(b);
  };
  const compare = (a: Row, b: Row) =>
    byValue(a, b) || a.name.localeCompare(b.name);

  return [...rows].sort((a, b) => (ascending ? compare(a, b) : -compare(a, b)));
}
