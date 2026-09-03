// The list view: every type as a row in a real table. This is the accessible
// reading of the city, so it is plain semantic markup with no canvas anywhere near
// it, and the same search that feeds the palette filters it.
import { useMemo, useState } from "react";
import { searchNodes } from "../model/search";
import type { SchemaGraph, UsageReport } from "../model/types";

export type TypeRow = {
  id: string;
  name: string;
  alias: string;
  element: boolean;
  root: boolean;
  own: number;
  composed: number;
  children: number;
  /** Content instances, or null when the usage report has not arrived. */
  usage: number | null;
};

export type SortKey = Exclude<keyof TypeRow, "id">;

/** One row per type, with the allowed-child count counted once for the whole graph. */
export function typeRows(graph: SchemaGraph, usage?: UsageReport): TypeRow[] {
  const children = new Map<string, number>();
  for (const edge of graph.edges ?? []) {
    if (edge.kind !== "allowedChild") continue;
    children.set(edge.from, (children.get(edge.from) ?? 0) + 1);
  }

  return graph.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    alias: node.alias,
    element: node.isElement,
    root: node.allowedAsRoot,
    own: node.ownPropertyCount,
    composed: node.composedPropertyCount,
    children: children.get(node.id) ?? 0,
    usage: usage ? (usage.byType[node.id]?.total ?? 0) : null,
  }));
}

/**
 * Sorted by one column. Text sorts by name, everything else by number, with a type
 * the usage report says nothing about at the bottom either way. Ties fall back to
 * the name, so the order is stable however often you click a header.
 */
export function sortRows(rows: TypeRow[], key: SortKey, ascending: boolean): TypeRow[] {
  const number = (row: TypeRow) => {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    return Number.NEGATIVE_INFINITY;
  };
  const compare = (a: TypeRow, b: TypeRow) =>
    key === "name" || key === "alias"
      ? String(a[key]).localeCompare(String(b[key]))
      : (number(a) - number(b) || a.name.localeCompare(b.name));

  return [...rows].sort((a, b) => (ascending ? compare(a, b) : -compare(a, b)));
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "alias", label: "Alias" },
  { key: "element", label: "Element" },
  { key: "root", label: "Root" },
  { key: "own", label: "Own", numeric: true },
  { key: "composed", label: "Composed", numeric: true },
  { key: "children", label: "Allowed children", numeric: true },
  { key: "usage", label: "Content", numeric: true },
];

const CELL = "border-line border-b px-2 py-1.5 text-left align-top";

export function TypeTable({
  graph,
  usage,
  query,
  onQuery,
  selected,
  onSelect,
}: {
  graph: SchemaGraph;
  usage?: UsageReport;
  /** The palette's query, so a search survives the switch between the two views. */
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "name",
    ascending: true,
  });

  const rows = useMemo(() => typeRows(graph, usage), [graph, usage]);
  // The same ranking the palette uses, kept only as a set: the table's own sort
  // decides the order, and searchNodes decides what is in it.
  const matched = useMemo(() => {
    if (query.trim() === "") return null;
    return new Set(searchNodes(graph.nodes, query, graph.nodes.length).map((hit) => hit.node.id));
  }, [graph.nodes, query]);
  const shown = useMemo(
    () => sortRows(matched ? rows.filter((row) => matched.has(row.id)) : rows, sort.key, sort.ascending),
    [rows, matched, sort],
  );

  const columns = usage ? COLUMNS : COLUMNS.filter((column) => column.key !== "usage");
  const toggle = (key: SortKey) =>
    setSort((was) => ({ key, ascending: was.key === key ? !was.ascending : true }));

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-3 border-line border-b px-4 py-2">
        <label className="flex items-center gap-2 font-bold text-2xs text-phosphor-dim uppercase tracking-terminal">
          Filter
          <input
            className="h-8 w-64 border border-line bg-secondary px-2 font-mono text-phosphor text-xs normal-case tracking-normal outline-none focus-visible:border-phosphor"
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Type name, alias or property alias"
            type="search"
            value={query}
          />
        </label>
        <p className="text-muted-foreground text-2xs">
          {shown.length} of {rows.length} types
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <caption className="sr-only">
            Every Document Type in the schema. Choosing a row opens it in the inspector.
          </caption>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr>
              {columns.map((column) => (
                <th
                  aria-sort={
                    sort.key === column.key
                      ? sort.ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={`${CELL} border-line-strong font-bold text-2xs text-phosphor-dim uppercase tracking-terminal ${
                    column.numeric ? "text-right" : ""
                  }`}
                  key={column.key}
                  scope="col"
                >
                  <button
                    className="uppercase hover:text-phosphor-bright"
                    onClick={() => toggle(column.key)}
                    type="button"
                  >
                    {column.label}
                    {sort.key === column.key ? (sort.ascending ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                className={
                  row.id === selected
                    ? "bg-accent text-phosphor-bright"
                    : "hover:bg-accent/50"
                }
                key={row.id}
                onClick={() => onSelect(row.id)}
              >
                <th className={`${CELL} font-normal`} scope="row">
                  <button
                    className="text-left text-phosphor hover:text-phosphor-bright hover:underline"
                    onClick={() => onSelect(row.id)}
                    type="button"
                  >
                    {row.name}
                  </button>
                </th>
                <td className={`${CELL} text-phosphor-dim`}>{row.alias}</td>
                <td className={CELL}>{row.element ? "Element" : ""}</td>
                <td className={CELL}>{row.root ? "Root" : ""}</td>
                <td className={`${CELL} text-right`}>{row.own}</td>
                <td className={`${CELL} text-right`}>{row.composed}</td>
                <td className={`${CELL} text-right`}>{row.children}</td>
                {usage ? (
                  <td className={`${CELL} text-right`}>{row.usage?.toLocaleString()}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-muted-foreground text-xs">
            No type or property matches “{query}”.
          </p>
        ) : null}
      </div>
    </div>
  );
}
