// The two matrices: which types use which compositions, and which Data Types each
// type's properties are built on. Pure: no DOM, no React.
import type { SchemaGraph, SchemaNode } from "./types";

export type MatrixColumn = {
  id: string;
  label: string;
  /** A second line for the header, such as a short Data Type id. */
  detail: string;
  /** Types using a composition, or properties using a Data Type. */
  total: number;
};

export type Matrix<Cell> = {
  /** Types with at least one cell, by name. */
  rows: SchemaNode[];
  columns: MatrixColumn[];
  /** Row id to column id to cell. */
  cells: Map<string, Map<string, Cell>>;
};

/** `via` is null for a direct composition, else the direct one it arrives through. */
export type CompositionUse = { via: string | null };

/**
 * Types by the compositions they use. A composition edge is direct, inheritance
 * included, so anything further down the chain arrives through one of them.
 */
export function compositionMatrix(graph: SchemaGraph): Matrix<CompositionUse> {
  const known = new Map(graph.nodes.map((node) => [node.id, node]));
  const direct = new Map<string, string[]>();
  for (const edge of graph.edges ?? []) {
    if (edge.kind !== "composition" || !known.has(edge.to)) continue;
    direct.set(edge.from, [...(direct.get(edge.from) ?? []), edge.to]);
  }

  const cells = new Map(
    [...direct.keys()].map((id) => [id, compositionsOf(id, direct)])
  );
  return build(known, cells, (id) => ({
    label: known.get(id)?.name ?? id,
    detail: known.get(id)?.alias ?? "",
  }));
}

/**
 * Every composition one type uses. Breadth first, so a composition reached two ways
 * is credited to the shortest route, the one Umbraco resolves its properties through.
 */
function compositionsOf(
  id: string,
  direct: ReadonlyMap<string, string[]>
): Map<string, CompositionUse> {
  const own = direct.get(id) ?? [];
  const uses = new Map<string, CompositionUse>(
    own.map((to) => [to, { via: null }])
  );
  const queue = own.map((to) => ({ at: to, via: to }));
  for (let next = queue.shift(); next; next = queue.shift())
    for (const deeper of direct.get(next.at) ?? [])
      if (deeper !== id && !uses.has(deeper)) {
        uses.set(deeper, { via: next.via });
        queue.push({ at: deeper, via: next.via });
      }
  return uses;
}

/**
 * Types by the Data Types of their own properties. A composed property is counted
 * once, on the composition that declares it, so each total is the number of
 * properties configured with that Data Type.
 */
export function dataTypeMatrix(graph: SchemaGraph): Matrix<number> {
  const known = new Map(graph.nodes.map((node) => [node.id, node]));
  const headers = new Map<string, { label: string; detail: string }>();
  const cells = new Map<string, Map<string, number>>();
  for (const node of graph.nodes)
    for (const group of node.groups ?? [])
      for (const property of group.properties) {
        if (property.fromCompositionId) continue;
        // The start of the key keeps two Data Types with one name apart.
        headers.set(property.dataTypeId, {
          label: property.dataTypeName ?? property.editorAlias,
          detail: `${property.editorAlias} · ${property.dataTypeId.slice(0, 8)}`,
        });
        const row = cells.get(node.id) ?? new Map<string, number>();
        row.set(property.dataTypeId, (row.get(property.dataTypeId) ?? 0) + 1);
        cells.set(node.id, row);
      }

  return build(
    known,
    cells,
    (id) => headers.get(id) ?? { label: id, detail: "" }
  );
}

function build<Cell>(
  known: Map<string, SchemaNode>,
  cells: Map<string, Map<string, Cell>>,
  header: (id: string) => { label: string; detail: string }
): Matrix<Cell> {
  const rows = [...cells.keys()]
    .map((id) => known.get(id))
    .filter((node): node is SchemaNode => node !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  // A counted cell adds its count, any other cell adds the one row it is on.
  const totals = new Map<string, number>();
  for (const row of rows)
    for (const [id, cell] of cells.get(row.id) ?? [])
      totals.set(
        id,
        (totals.get(id) ?? 0) + (typeof cell === "number" ? cell : 1)
      );
  const columns = [...totals].map(([id, total]) => ({
    id,
    total,
    ...header(id),
  }));
  return { rows, columns: sortColumns(columns, "usage"), cells };
}

/** Most used first, or by label; ties fall back to the label so the order is stable. */
export function sortColumns(
  columns: MatrixColumn[],
  by: "usage" | "name"
): MatrixColumn[] {
  const byLabel = (a: MatrixColumn, b: MatrixColumn) =>
    a.label.localeCompare(b.label) || a.detail.localeCompare(b.detail);
  return [...columns].sort((a, b) =>
    by === "usage" ? b.total - a.total || byLabel(a, b) : byLabel(a, b)
  );
}
