// The matrix view: types down the side, compositions or Data Types across the top.
// A real table with sticky headers, so it scrolls both ways and still says which
// row and column a cell belongs to.
import { type ReactNode, use, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type CompositionUse,
  compositionMatrix,
  dataTypeMatrix,
  type MatrixColumn,
  type Matrix as MatrixData,
  sortColumns,
} from "../model/matrix";
import type { SchemaGraph, SchemaNode } from "../model/types";
import { plural, useAnnounceChange } from "./a11y";
import { DataTypeLinks, READING } from "./InspectorChips";
import { FilterField, Scroller, useMatches } from "./TypeTable";

type Kind = "compositions" | "dataTypes";
type ColumnSort = "usage" | "name";

const LABEL = "font-sans font-medium text-label text-xs";
const CELL = "border-line/60 border-r border-b";

function Switch<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: [Value, string][];
  onChange: (value: Value) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={LABEL}>{label}</span>
      <ToggleGroup
        aria-label={label}
        onValueChange={(next) => {
          if (next[0]) onChange(next[0] as Value);
        }}
        size="sm"
        value={[value]}
        variant="outline"
      >
        {options.map(([option, text]) => (
          <ToggleGroupItem className={READING} key={option} value={option}>
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function Matrix({
  graph,
  query,
  onQuery,
  selected,
  onSelect,
  scope,
}: {
  graph: SchemaGraph;
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  scope: ReadonlySet<string> | null;
}) {
  const [kind, setKind] = useState<Kind>("compositions");
  const links = use(DataTypeLinks);
  const [columnSort, setColumnSort] = useState<ColumnSort>("usage");
  const compositions = useMemo(() => compositionMatrix(graph), [graph]);
  const dataTypes = useMemo(() => dataTypeMatrix(graph), [graph]);
  const matched = useMatches(graph, query, scope);
  const names = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.name])),
    [graph.nodes]
  );
  // Umbraco records a parent type as a composition of its children, so a parent
  // such as Article is a column here. Marked, so it does not read as a mixin.
  const inherits = useMemo(() => {
    const pairs = new Set<string>();
    for (const edge of graph.edges ?? [])
      if (edge.kind === "inherits") pairs.add(`${edge.from}>${edge.to}`);
    return pairs;
  }, [graph.edges]);
  const parents = useMemo(
    () => new Set([...inherits].map((pair) => pair.split(">")[1])),
    [inherits]
  );

  const composition = ({ via }: CompositionUse) =>
    via === null ? (
      <span className="text-azure text-sm">●</span>
    ) : (
      <span className="text-azure/70 text-sm">○</span>
    );
  const compositionSays = (
    row: SchemaNode,
    column: MatrixColumn,
    { via }: CompositionUse
  ) => {
    if (via !== null)
      return `${row.name} uses ${column.label} through ${names.get(via) ?? "another composition"}`;
    return inherits.has(`${row.id}>${column.id}`)
      ? `${row.name} inherits from ${column.label}`
      : `${row.name} uses ${column.label} directly`;
  };

  return (
    <div className="flex h-full flex-col bg-background font-sans text-[13px] text-prose leading-normal">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line border-b px-4 py-2">
        <Switch
          label="Matrix"
          onChange={setKind}
          options={[
            ["compositions", "Compositions"],
            ["dataTypes", "Data Types"],
          ]}
          value={kind}
        />
        <Switch
          label="Columns"
          onChange={setColumnSort}
          options={[
            ["usage", "By usage"],
            ["name", "By name"],
          ]}
          value={columnSort}
        />
        <FilterField onQuery={onQuery} query={query} />
      </div>
      {kind === "compositions" ? (
        <Grid
          cell={composition}
          columnName={(column) =>
            `${column.label}${parents.has(column.id) ? ", a parent type" : ""}, used by ${plural(column.total, "type")}`
          }
          columnSort={columnSort}
          data={compositions}
          empty="No type uses a composition."
          matched={matched}
          note={
            <>
              <span aria-hidden className="text-azure">
                ●
              </span>{" "}
              composed directly,{" "}
              <span aria-hidden className="text-azure/70">
                ○
              </span>{" "}
              through another composition. A column marked parent is a type
              others inherit from, which Umbraco records as a direct
              composition. The column total counts the types that use it.
            </>
          }
          onSelect={onSelect}
          says={compositionSays}
          selected={selected}
          tag={(column) => (parents.has(column.id) ? "parent" : null)}
        />
      ) : (
        <Grid
          cell={(count) => <span className="font-mono text-xs">{count}</span>}
          columnName={(column) =>
            `${column.label}, ${plural(column.total, "property", "properties")}`
          }
          columnSort={columnSort}
          data={dataTypes}
          empty="No type has properties of its own."
          matched={matched}
          note="Counts each type's own properties. A composed property counts once, on the composition that declares it, so the column total is the number of properties using that Data Type."
          onColumn={links?.open}
          onSelect={onSelect}
          says={(row, column, count) =>
            `${row.name}: ${plural(count, "property", "properties")} on ${column.label}`
          }
          selected={selected}
        />
      )}
    </div>
  );
}

function Grid<Cell>({
  data,
  cell,
  says,
  columnName,
  tag = () => null,
  onColumn,
  columnSort,
  matched,
  selected,
  onSelect,
  note,
  empty,
}: {
  data: MatrixData<Cell>;
  /** The mark drawn in a cell, hidden from screen readers in favour of `says`. */
  cell: (value: Cell) => ReactNode;
  /** A cell as one sentence, for a screen reader and on hover. */
  says: (row: SchemaNode, column: MatrixColumn, value: Cell) => string;
  /** A column header as read aloud, by name and without the Data Type key. */
  columnName: (column: MatrixColumn) => string;
  /** A short word printed on a column header, such as "parent". */
  tag?: (column: MatrixColumn) => string | null;
  /** Given, a column header is a link, as a Data Type header is to its page. */
  onColumn?: (id: string) => void;
  columnSort: ColumnSort;
  matched: ReadonlySet<string> | null;
  selected: string | null;
  onSelect: (id: string) => void;
  note: ReactNode;
  empty: string;
}) {
  const columns = useMemo(
    () => sortColumns(data.columns, columnSort),
    [data.columns, columnSort]
  );
  const rows = matched
    ? data.rows.filter((row) => matched.has(row.id))
    : data.rows;
  useAnnounceChange(`${rows.length} of ${data.rows.length} types`);

  return (
    <>
      <p className="border-line border-b px-4 py-1.5 text-label text-xs">
        {note} <span className="font-mono">{rows.length}</span> of{" "}
        <span className="font-mono">{data.rows.length}</span> types.
      </p>
      <Scroller label="Matrix">
        {data.rows.length === 0 ? (
          <p className="px-4 py-6 text-faint text-xs">{empty}</p>
        ) : (
          <table className="border-separate border-spacing-0">
            <caption className="sr-only">
              Types by column. Choosing a row opens the type in the inspector.
            </caption>
            <thead>
              <tr>
                {/* The corner is sticky both ways so the row names never slide
                    under it. */}
                <th
                  className={`${CELL} sticky top-0 left-0 z-30 bg-panel px-2 text-left align-bottom ${LABEL}`}
                  scope="col"
                >
                  Type
                </th>
                {columns.map((column) => {
                  const marked = tag(column);
                  const header = (
                    <>
                      <span className="sr-only">{columnName(column)}</span>
                      {/* Vertical, so a long editor alias costs height once instead
                          of width in every row. The key in the detail line keeps
                          two same-named Data Types apart for the eye only. */}
                      <span
                        aria-hidden
                        className="inline-block rotate-180 text-left [writing-mode:vertical-rl]"
                      >
                        <span className="block max-h-48 truncate text-prose text-xs group-hover:text-phosphor group-hover:underline">
                          {column.label}
                          {marked ? (
                            <span className="text-azure"> · {marked}</span>
                          ) : null}
                        </span>
                        <span className="block max-h-48 truncate font-mono text-2xs text-faint">
                          {column.detail} · {column.total}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <th
                      className={`${CELL} sticky top-0 z-20 bg-panel px-1 py-2 align-bottom font-normal`}
                      key={column.id}
                      scope="col"
                    >
                      {onColumn ? (
                        <button
                          className="group"
                          onClick={() => onColumn(column.id)}
                          type="button"
                        >
                          {header}
                        </button>
                      ) : (
                        header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cells = data.cells.get(row.id);
                const on = row.id === selected;
                return (
                  <tr
                    className={on ? "bg-accent" : "hover:bg-accent/50"}
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                  >
                    <th
                      className={`${CELL} sticky left-0 z-10 max-w-64 px-2 py-1 text-left font-normal ${
                        on ? "bg-accent" : "bg-background"
                      }`}
                      scope="row"
                    >
                      <button
                        className={`block max-w-full truncate text-left hover:text-phosphor hover:underline ${on ? "text-phosphor-bright" : "text-prose"}`}
                        onClick={() => onSelect(row.id)}
                        title={row.alias}
                        type="button"
                      >
                        {row.name}
                      </button>
                    </th>
                    {columns.map((column) => {
                      const value = cells?.get(column.id);
                      const said =
                        value === undefined
                          ? undefined
                          : says(row, column, value);
                      return (
                        <td
                          className={`${CELL} min-w-7 px-1 text-center`}
                          key={column.id}
                          title={said}
                        >
                          {value === undefined ? null : (
                            <>
                              <span aria-hidden>{cell(value)}</span>
                              <span className="sr-only">{said}</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Scroller>
    </>
  );
}
