// The list view: every type as a row in a real table. This is the accessible
// reading of the city, so it is plain semantic markup with no canvas anywhere near
// it, and the same search that feeds the palette filters it.
import { type ReactNode, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { type Finding, problemLabels } from "../model/findings";
import { contentCountOf, type Role, roleOf } from "../model/inspector";
import { neighbourhoods } from "../model/neighbourhood";
import { searchNodes } from "../model/search";
import type { SchemaGraph, UsageReport } from "../model/types";
import { useAnnounceChange } from "./a11y";
import { FindingDot, RoleKey } from "./InspectorChips";

export type TypeRow = {
  id: string;
  name: string;
  alias: string;
  role: Role;
  root: boolean;
  own: number;
  composed: number;
  children: number;
  /**
   * Content instances, or null when the usage report has not arrived or the type
   * cannot hold content of its own: an Element Type lives inside block values, so
   * a 0 there would read as unused.
   */
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
  const around = neighbourhoods(graph);
  // The inspector chips' rule, so the list and the panel agree on which types
  // have a count at all.
  const countOf = contentCountOf(
    usage,
    new Map(graph.nodes.map((node) => [node.id, node])),
    graph.edges ?? []
  );

  return graph.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    alias: node.alias,
    role: roleOf(node, around.get(node.id)),
    root: node.allowedAsRoot,
    own: node.ownPropertyCount,
    composed: node.composedPropertyCount,
    children: children.get(node.id) ?? 0,
    usage: countOf(node.id) ?? null,
  }));
}

/**
 * Sorted by one column. Text sorts as text, everything else by number, with a type
 * the usage report says nothing about at the bottom either way. Ties fall back to
 * the name, so the order is stable however often you click a header. The Data
 * Types list sorts its rows the same way.
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
  const compare = (a: Row, b: Row) =>
    (typeof a[key] === "string"
      ? String(a[key]).localeCompare(String(b[key]))
      : number(a) - number(b)) || a.name.localeCompare(b.name);

  return [...rows].sort((a, b) => (ascending ? compare(a, b) : -compare(a, b)));
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "alias", label: "Alias" },
  { key: "role", label: "Role" },
  { key: "root", label: "Root" },
  { key: "own", label: "Own", numeric: true },
  { key: "composed", label: "Composed", numeric: true },
  { key: "children", label: "Allowed children", numeric: true },
  { key: "usage", label: "Content", numeric: true },
];

const CELL = "border-line/60 border-b px-2 py-1.5 text-left align-baseline";

/**
 * A count in mono, faint at zero so the counts that say something stand out. On the
 * selected row's background faint falls below 4.5:1, so it steps up to label.
 */
function Count({ value, on }: { value: number | null; on: boolean }) {
  let tone = on ? "text-label" : "text-faint";
  if (value) tone = "text-prose";
  return (
    <td className={`${CELL} text-right font-mono text-xs ${tone}`}>
      {value?.toLocaleString()}
    </td>
  );
}

/** The filter box the 2D views share, fed by the palette's query. */
export function FilterField({
  query,
  onQuery,
}: {
  query: string;
  onQuery: (query: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // The label names the field alone: wrapped around the clear button too, it read
  // as "Filter Clear the filter".
  return (
    <div className="flex items-center gap-2 font-sans text-label text-xs">
      <label htmlFor={id}>Filter</label>
      {/* type="text" and our own clear button, because a search field draws the
          browser's blue X, which is unreadable on this background. */}
      <span className="relative">
        <Input
          className="h-8 w-64 min-w-[14rem] bg-secondary px-2 pr-7 font-sans text-prose text-xs placeholder:text-faint focus-visible:border-phosphor md:text-xs"
          id={id}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Filter types"
          ref={input}
          type="text"
          value={query}
        />
        {query === "" ? null : (
          <button
            aria-label="Clear the filter"
            className="-translate-y-1/2 absolute top-1/2 right-1 cursor-pointer px-1 text-base text-faint leading-none hover:text-phosphor-bright"
            onClick={() => {
              onQuery("");
              // The button goes with the text, so focus goes back to the field.
              input.current?.focus();
            }}
            type="button"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Ids of the types the query matches, within the focus scope when there is one, or
 * null when neither narrows anything.
 */
export function useMatches(
  graph: SchemaGraph,
  query: string,
  scope: ReadonlySet<string> | null = null
) {
  return useMemo(() => {
    if (query.trim() === "") return scope;
    const hits = searchNodes(graph.nodes, query, graph.nodes.length)
      .map((hit) => hit.node.id)
      .filter((id) => scope === null || scope.has(id));
    return new Set(hits);
  }, [graph.nodes, query, scope]);
}

/** What the List, Tree and Matrix views are given. */
export type ListProps = {
  graph: SchemaGraph;
  usage?: UsageReport;
  findings: Finding[];
  /** The palette's query, so a search survives the switch between views. */
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  /** In focus mode, the types around the focused one; null shows every type. */
  scope: ReadonlySet<string> | null;
};

/**
 * A scrolling area a keyboard can reach and a screen reader can name. A table wider
 * than the window scrolls sideways, and only a focused scroller takes arrow keys.
 */
export function Scroller({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className="min-h-0 flex-1 overflow-auto focus-visible:outline-offset-[-2px]"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region has to be reachable by keyboard.
      tabIndex={0}
    >
      {children}
    </section>
  );
}

export function TypeTable({
  graph,
  usage,
  findings,
  query,
  onQuery,
  selected,
  onSelect,
  scope,
}: ListProps) {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "name",
    ascending: true,
  });

  const rows = useMemo(() => typeRows(graph, usage), [graph, usage]);
  const problems = useMemo(() => problemLabels(findings), [findings]);
  // The same ranking the palette uses, kept only as a set: the table's own sort
  // decides the order, and searchNodes decides what is in it.
  const matched = useMatches(graph, query, scope);
  const shown = useMemo(
    () =>
      sortRows(
        matched ? rows.filter((row) => matched.has(row.id)) : rows,
        sort.key,
        sort.ascending
      ),
    [rows, matched, sort]
  );

  useAnnounceChange(`${shown.length} of ${rows.length} types`);

  const columns = usage
    ? COLUMNS
    : COLUMNS.filter((column) => column.key !== "usage");
  const toggle = (key: SortKey) =>
    setSort((was) => ({
      key,
      ascending: was.key === key ? !was.ascending : true,
    }));

  return (
    <div className="flex h-full flex-col bg-background font-sans text-[13px] text-prose leading-normal">
      <div className="flex items-center gap-3 border-line border-b px-4 py-2">
        <FilterField onQuery={onQuery} query={query} />
        <p className="text-label text-xs">
          <span className="font-mono">{shown.length}</span> of{" "}
          <span className="font-mono">{rows.length}</span> types
        </p>
      </div>

      <Scroller label="Type list">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Every Document Type in the schema. Choosing a row opens it in the
            inspector.
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
                  className={`${CELL} border-line font-medium text-label text-xs ${
                    column.numeric ? "text-right" : ""
                  }`}
                  key={column.key}
                  scope="col"
                >
                  <button
                    className={`hover:text-phosphor ${sort.key === column.key ? "text-prose" : ""}`}
                    onClick={() => toggle(column.key)}
                    type="button"
                  >
                    {column.label}
                    {/* aria-sort on the header says the order; the arrow is for eyes. */}
                    {sort.key === column.key ? (
                      <span aria-hidden className="text-faint">
                        {sort.ascending ? " ▲" : " ▼"}
                      </span>
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const on = row.id === selected;
              const flagged = problems.get(row.id);
              return (
                <tr
                  className={on ? "bg-accent" : "hover:bg-accent/50"}
                  key={row.id}
                  onClick={() => onSelect(row.id)}
                >
                  <th className={`${CELL} font-normal`} scope="row">
                    <span className="flex items-center gap-1.5">
                      <button
                        className={`text-left hover:text-phosphor hover:underline ${on ? "text-phosphor-bright" : "text-prose"}`}
                        onClick={() => onSelect(row.id)}
                        type="button"
                      >
                        {row.name}
                      </button>
                      {flagged ? <FindingDot title={flagged} /> : null}
                    </span>
                  </th>
                  <td
                    className={`${CELL} font-mono text-xs ${on ? "text-label" : "text-faint"}`}
                  >
                    {row.alias}
                  </td>
                  <td className={CELL}>
                    <RoleKey role={row.role} />
                  </td>
                  <td className={`${CELL} text-label text-xs`}>
                    {row.root ? "Root" : ""}
                  </td>
                  <Count on={on} value={row.own} />
                  <Count on={on} value={row.composed} />
                  <Count on={on} value={row.children} />
                  {usage ? <Count on={on} value={row.usage} /> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-faint text-xs">
            No type or property matches “{query}”.
          </p>
        ) : null}
      </Scroller>
    </div>
  );
}
