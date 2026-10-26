// The matrix view: types down the side, compositions or Data Types across the top.
// A real table with sticky headers, so it scrolls both ways and still says which
// row and column a cell belongs to.

import {
  type CompositionUse,
  compositionMatrix,
  dataTypeMatrix,
  type MatrixColumn,
  type Matrix as MatrixData,
  sortColumns,
} from "@schema-city/core/model/matrix";
import type { SchemaGraph, SchemaNode } from "@schema-city/core/model/types";
import { type ReactNode, use, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line border-b px-4 py-2"
        data-ui="view-toolbar"
      >
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
              <span className="block">
                <span aria-hidden className="text-azure">
                  ●
                </span>{" "}
                composed directly
              </span>
              <span className="block">
                <span aria-hidden className="text-azure/70">
                  ○
                </span>{" "}
                through another composition
              </span>
              <span className="block">
                <span className="text-azure">parent</span> inherited from
              </span>
            </>
          }
          noteSaid="A filled mark is composed directly, a hollow one through another composition. A column marked parent is a type others inherit from."
          onColumn={onSelect}
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
          note="Each type's own properties. A composed property counts on its composition."
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

interface HeaderProps {
  column: MatrixColumn;
  /** The name as printed, with its tag. */
  name: ReactNode;
  onColumn?: (id: string) => void;
  /** The name as read aloud. */
  said: string;
}

/** The name and how many use the column, in the same quiet mono as a group count. */
function Counted({ name, total }: { name: ReactNode; total: number }) {
  return (
    <>
      {name}
      <span className="font-mono text-2xs text-faint"> {total}</span>
    </>
  );
}

/**
 * Every column name slants at 45 degrees, however few there are, so the matrix
 * looks the same from one schema to the next and a column is only as wide as its
 * marks. Each name gets a lane: the column's own borders, leaned over and carried
 * up to the top of the header, so it is boxed in and still lines up with its
 * marks. The lane is also what you click, and what lights the name. The cell's
 * box stays upright, so above the lanes to its left it covers bare header, and a
 * hover on the cell would light a name the pointer is nowhere near.
 */
function SlantedHeader({
  column,
  name,
  said,
  onColumn,
  first,
  zIndex,
}: HeaderProps & { first: boolean; zIndex: number }) {
  const lane = `absolute inset-0 origin-bottom-left -skew-x-45 border-line/60 border-r ${first ? "border-l" : ""}`;
  return (
    <th
      className="sticky top-0 h-40 min-w-8 border-line/60 border-b bg-panel p-0 align-bottom font-normal"
      scope="col"
      style={{ zIndex }}
    >
      {onColumn ? (
        <button
          className={`${lane} peer hover:bg-accent/50`}
          onClick={() => onColumn(column.id)}
          title={column.detail}
          type="button"
        >
          <span className="sr-only">{said}</span>
        </button>
      ) : (
        <span className={lane} title={column.detail}>
          <span className="sr-only">{said}</span>
        </span>
      )}
      {/* Rotated about its left middle and dropped half a line, so the name runs
          up the middle of its lane. One line, since a second would leave the
          lane. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 block w-52 origin-left translate-y-1/2 -rotate-45 truncate pl-3 text-left text-prose text-xs leading-5 peer-hover:text-phosphor peer-hover:underline"
      >
        <Counted name={name} total={column.total} />
      </span>
    </th>
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
  noteSaid,
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
  /** Given, a column header is a link: a composition selects its type, a Data Type opens its page. */
  onColumn?: (id: string) => void;
  columnSort: ColumnSort;
  matched: ReadonlySet<string> | null;
  selected: string | null;
  onSelect: (id: string) => void;
  note: ReactNode;
  /** The key as a screen reader hears it, where `note` is marks and fragments. */
  noteSaid?: string;
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
    <Scroller label="Matrix">
      {data.rows.length === 0 ? (
        <p className="px-4 py-6 text-faint text-xs">{empty}</p>
      ) : (
        <table className="border-separate border-spacing-0" data-ui="matrix">
          <caption className="sr-only">
            Types by column. {noteSaid ?? note} Choosing a row opens the type in
            the inspector.
          </caption>
          <thead>
            <tr>
              {/* The corner is sticky both ways so the row names never slide
                    under it. */}
              <th
                className={`${CELL} sticky top-0 left-0 bg-panel pr-2 pl-4 text-left align-bottom ${LABEL}`}
                scope="col"
                style={{ zIndex: 30 + columns.length }}
              >
                {/* The key fills the corner's empty height, beside the names it
                      explains, rather than a strip over the grid. The caption
                      gives it to a screen reader once. */}
                <div
                  aria-hidden
                  className={`${READING} mb-3 max-w-56 whitespace-normal font-normal text-faint text-xs`}
                  data-ui="matrix-key"
                >
                  {note}
                  <span className="mt-1.5 block">
                    <span className="font-mono">{rows.length}</span> of{" "}
                    <span className="font-mono">{data.rows.length}</span> types
                  </span>
                </div>
                Type
              </th>
              {columns.map((column, index) => {
                const marked = tag(column);
                const header = {
                  column,
                  name: (
                    <>
                      {column.label}
                      {marked ? (
                        <span className="text-azure"> · {marked}</span>
                      ) : null}
                    </>
                  ),
                  said: columnName(column),
                  onColumn,
                };
                return (
                  <SlantedHeader
                    key={column.id}
                    {...header}
                    first={index === 0}
                    // A lane leans over the headers to its right, so each one
                    // sits above the next, or their backgrounds would cut it
                    // off.
                    zIndex={20 + columns.length - index}
                  />
                );
              })}
              {/* Room for the last lanes to finish their lean, which takes as
                    much width as the header is tall. */}
              <th
                aria-hidden
                className="sticky top-0 w-40 min-w-40 border-line/60 border-b bg-panel"
                style={{ zIndex: 20 }}
              />
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
                    className={`${CELL} sticky left-0 z-10 max-w-64 py-1 pr-2 pl-4 text-left font-normal ${
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
  );
}
