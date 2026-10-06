// The matrix view: types down the side, compositions or Data Types across the top.
// A real table with sticky headers, so it scrolls both ways and still says which
// row and column a cell belongs to.
import { type ReactNode, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type CompositionUse,
  compositionMatrix,
  dataTypeMatrix,
  type Matrix as MatrixData,
  sortColumns,
} from "../model/matrix";
import type { SchemaGraph } from "../model/types";
import { READING } from "./InspectorChips";
import { FilterField, useMatches } from "./TypeTable";

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
}: {
  graph: SchemaGraph;
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [kind, setKind] = useState<Kind>("compositions");
  const [columnSort, setColumnSort] = useState<ColumnSort>("usage");
  const compositions = useMemo(() => compositionMatrix(graph), [graph]);
  const dataTypes = useMemo(() => dataTypeMatrix(graph), [graph]);
  const matched = useMatches(graph, query);
  const names = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.name])),
    [graph.nodes]
  );

  const composition = (use: CompositionUse) =>
    use.via === null ? (
      <span className="text-azure text-sm">●</span>
    ) : (
      <span className="text-azure/70 text-sm">○</span>
    );
  const compositionTitle = (use: CompositionUse) =>
    use.via === null
      ? "composed directly"
      : `through ${names.get(use.via) ?? "another composition"}`;

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
          columnSort={columnSort}
          data={compositions}
          empty="No type uses a composition."
          matched={matched}
          note={
            <>
              <span className="text-azure">●</span> composed directly,{" "}
              <span className="text-azure/70">○</span> through another
              composition. Inheriting from a parent counts as a direct
              composition, as Umbraco models it. The column total counts the
              types that use it.
            </>
          }
          onSelect={onSelect}
          selected={selected}
          title={compositionTitle}
        />
      ) : (
        <Grid
          cell={(count) => <span className="font-mono text-xs">{count}</span>}
          columnSort={columnSort}
          data={dataTypes}
          empty="No type has properties of its own."
          matched={matched}
          note="Counts each type's own properties. A composed property counts once, on the composition that declares it, so the column total is the number of properties using that Data Type."
          onSelect={onSelect}
          selected={selected}
          title={(count) =>
            `${count} ${count === 1 ? "property" : "properties"}`
          }
        />
      )}
    </div>
  );
}

function Grid<Cell>({
  data,
  cell,
  title,
  columnSort,
  matched,
  selected,
  onSelect,
  note,
  empty,
}: {
  data: MatrixData<Cell>;
  cell: (value: Cell) => ReactNode;
  title: (value: Cell) => string;
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

  return (
    <>
      <p className="border-line border-b px-4 py-1.5 text-label text-xs">
        {note} <span className="font-mono">{rows.length}</span> of{" "}
        <span className="font-mono">{data.rows.length}</span> types.
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
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
                {columns.map((column) => (
                  <th
                    className={`${CELL} sticky top-0 z-20 bg-panel px-1 py-2 align-bottom font-normal`}
                    key={column.id}
                    scope="col"
                    title={`${column.label} (${column.id})`}
                  >
                    {/* Vertical, so a long editor alias costs height once instead
                        of width in every row. */}
                    <span className="inline-block rotate-180 text-left [writing-mode:vertical-rl]">
                      <span className="block max-h-48 truncate text-prose text-xs">
                        {column.label}
                      </span>
                      <span className="block max-h-48 truncate font-mono text-2xs text-faint">
                        {column.detail} · {column.total}
                      </span>
                    </span>
                  </th>
                ))}
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
                      return (
                        <td
                          className={`${CELL} min-w-7 px-1 text-center`}
                          key={column.id}
                          title={
                            value === undefined
                              ? undefined
                              : `${row.name}, ${column.label}: ${title(value)}`
                          }
                        >
                          {value === undefined ? "" : cell(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
