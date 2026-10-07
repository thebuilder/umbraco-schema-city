// The tree view: what an editor can create where, from each root down the
// allowed-child rules, and the Document Types no root reaches. Plain markup, so it
// works where the canvas does not.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  creationTree,
  exclusionLine,
  type CreationTree as Tree,
  type TreeRow,
  treeRows,
} from "../model/creation-tree";
import { chips, contentCountOf } from "../model/inspector";
import type { FindingMark } from "../model/review";
import type { SchemaNode } from "../model/types";
import { plural } from "./a11y";
import { FindingDot, Heading, READING, TypeChips } from "./InspectorChips";
import { useProblemMarks } from "./Review";
import { FilterField, type ListProps, Scroller, useMatches } from "./TypeTable";

/**
 * Every row key there is to open, found a level at a time until nothing new shows.
 * The row limit in treeRows keeps it finite on a schema whose paths fan out.
 */
export function openEverything(tree: Tree): Set<string> {
  const all = new Set<string>();
  for (let grew = true; grew; ) {
    const { size } = all;
    for (const row of treeRows(tree, all).rows) all.add(row.key);
    grew = all.size > size;
  }
  return all;
}

type Names = Map<string, SchemaNode>;

/** What a row needs to say about a type besides its place in the tree. */
type Marks = {
  names: Names;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Content items of a type, or nothing while usage is loading. */
  countOf: (id: string) => number | undefined;
  problems: Map<string, FindingMark>;
};

/**
 * The type's name, quieter when the usage snapshot counts no content of it, so the
 * branches where content lives stand out. A pink dot names its problems, and a
 * hollow ring the ones already reviewed.
 */
function TypeName({ id, marks }: { id: string; marks: Marks }) {
  const node = marks.names.get(id);
  const empty = marks.countOf(id) === 0;
  const problems = marks.problems.get(id);
  let colour = empty ? "text-label" : "text-prose";
  if (id === marks.selected) colour = "text-phosphor-bright";
  return (
    <>
      <button
        className={`truncate text-left hover:text-phosphor hover:underline ${colour}`}
        onClick={() => marks.onSelect(id)}
        title={node?.alias}
        type="button"
      >
        {node?.name ?? id}
      </button>
      {problems ? <FindingDot {...problems} /> : null}
    </>
  );
}

/** Faint grey, or label on the selected row, where faint falls below 4.5:1. */
const quiet = (on: boolean) => (on ? "text-label" : "text-faint");

/** Content items of the type across the site, which is not what sits under this row. */
function Count({ value, on }: { value: number | undefined; on: boolean }) {
  return value === undefined ? null : (
    <span className={`ml-auto shrink-0 pl-3 font-mono text-2xs ${quiet(on)}`}>
      {value.toLocaleString()}
      <span className="sr-only"> content items of this type</span>
    </span>
  );
}

const ROW = (on: boolean) => (on ? "bg-accent" : "hover:bg-accent/50");

/** A row and the rows under it, so the markup nests the way the tree does. */
export type Branch = { row: TreeRow; children: Branch[] };

/**
 * The flat, depth-first rows as nested branches. Nested lists are what tells a
 * screen reader how deep a row is; a flat list read every row as level 1.
 */
export function nest(rows: TreeRow[]): Branch[] {
  const top: Branch[] = [];
  const path: Branch[] = [];
  for (const row of rows) {
    const branch: Branch = { row, children: [] };
    path.length = row.depth;
    (path[path.length - 1]?.children ?? top).push(branch);
    path.push(branch);
  }
  return top;
}

/** What every row in one render shares. */
type Shared = {
  tree: Tree;
  filtering: boolean;
  onToggle: (key: string) => void;
  marks: Marks;
  /** The row a type first appears on, the one that shows its content count. */
  first: Map<string, string>;
};

function Branches({
  branches,
  shared,
}: {
  branches: Branch[];
  shared: Shared;
}) {
  return (
    <ul>
      {branches.map((branch) => (
        <TreeItem branch={branch} key={branch.row.key} shared={shared} />
      ))}
    </ul>
  );
}

/** The fold arrow, or a spacer where the row has nothing to fold. */
function Toggle({
  branch,
  shared,
  on,
}: {
  branch: Branch;
  shared: Shared;
  on: boolean;
}) {
  const { row } = branch;
  // A filtered row whose children all fell out has nothing to fold.
  const empty = shared.filtering && branch.children.length === 0;
  if (!row.expandable || empty)
    return <span aria-hidden className="w-4 shrink-0" />;
  return (
    <button
      aria-expanded={row.open}
      aria-label={`Show what ${shared.marks.names.get(row.id)?.name} can create`}
      className={`w-4 shrink-0 hover:text-phosphor-bright disabled:opacity-50 ${quiet(on)}`}
      disabled={shared.filtering}
      onClick={() => shared.onToggle(row.key)}
      type="button"
    >
      {row.open ? "▾" : "▸"}
    </button>
  );
}

/**
 * The type's content count on its first row. A type under three parents is three
 * rows of one type, so the repeats say so instead of tripling the number.
 */
function RowCount({
  row,
  shared,
  on,
}: {
  row: TreeRow;
  shared: Shared;
  on: boolean;
}) {
  const count = shared.marks.countOf(row.id);
  if (count === undefined || shared.first.get(row.id) === row.key)
    return <Count on={on} value={count} />;
  return (
    <span
      className={`ml-auto shrink-0 pl-3 text-2xs ${quiet(on)}`}
      title="Counted on this type's first row above"
    >
      same type
    </span>
  );
}

function TreeItem({ branch, shared }: { branch: Branch; shared: Shared }) {
  const { row } = branch;
  const on = row.id === shared.marks.selected;
  const allowed = shared.tree.children.get(row.id)?.length ?? 0;
  return (
    <li>
      <div className={`flex items-stretch pr-2 ${ROW(on)}`}>
        {/* One guide per level, so depth reads down the page and not only by indent. */}
        {Array.from({ length: row.depth }, (_, level) => (
          <span
            aria-hidden
            className="ml-2 w-3 shrink-0 border-line border-l"
            // biome-ignore lint/suspicious/noArrayIndexKey: a guide is its level.
            key={level}
          />
        ))}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
          <Toggle branch={branch} on={on} shared={shared} />
          <TypeName id={row.id} marks={shared.marks} />
          {row.recursive ? (
            <span className={`shrink-0 text-2xs ${quiet(on)}`}>
              ↻ already above in this branch
            </span>
          ) : null}
          {row.expandable ? (
            <span
              className={`shrink-0 text-2xs ${quiet(on)}`}
              title={plural(allowed, "allowed child type")}
            >
              <span className="font-mono">{allowed}</span> allowed
            </span>
          ) : null}
          <RowCount on={on} row={row} shared={shared} />
        </div>
      </div>
      {branch.children.length > 0 ? (
        <Branches branches={branch.children} shared={shared} />
      ) : null}
    </li>
  );
}

function Unreachable({
  tree,
  matched,
  marks,
}: {
  tree: Tree;
  matched: ReadonlySet<string> | null;
  marks: Marks;
}) {
  const shown = tree.unreachable.filter(
    (entry) => matched === null || matched.has(entry.id)
  );
  const excluded = exclusionLine(tree.excluded);
  return (
    <section className="mt-6">
      <Heading count={tree.unreachable.length}>
        Not reachable from any root
      </Heading>
      {excluded ? <p className="mb-2 text-label text-xs">{excluded}</p> : null}
      <ul>
        {shown.map((entry) => (
          <li
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-1 pr-2 pl-1 ${ROW(entry.id === marks.selected)}`}
            key={entry.id}
          >
            <TypeName id={entry.id} marks={marks} />
            <span className="text-label text-xs">
              {entry.parents.length === 0
                ? "no allowed parent"
                : "allowed under"}
            </span>
            {entry.parents.length > 0 ? (
              <TypeChips
                chips={chips(entry.parents, marks.names, marks.countOf)}
                limit={4}
                onSelect={marks.onSelect}
              />
            ) : null}
            <Count
              on={entry.id === marks.selected}
              value={marks.countOf(entry.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One line for whichever reason the tree is short: nothing allowed at root,
 * nothing matching the filter or the focus, or the row limit. Empty otherwise.
 */
function shortBecause(at: {
  roots: number;
  rows: number;
  filtering: boolean;
  query: string;
  truncated: boolean;
}): string {
  if (at.roots === 0)
    return "No Document Type is allowed at root, so an editor cannot create any content.";
  if (at.truncated)
    return `Stopped after ${at.rows} rows. Collapse a branch or filter to see the rest.`;
  if (!at.filtering || at.rows > 0) return "";
  return at.query.trim() === ""
    ? "None of the focused types is under a root."
    : `No type under a root matches “${at.query}”.`;
}

export function CreationTree(props: ListProps) {
  const { graph, usage, findings, query, onQuery } = props;
  const tree = useMemo(() => creationTree(graph), [graph]);
  const names = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );
  const countOf = useMemo(
    () => contentCountOf(usage, names, graph.edges ?? []),
    [usage, names, graph.edges]
  );
  const problems = useProblemMarks(findings);
  // Roots start open: a closed list of three names says less than the level below.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(tree.roots)
  );
  // In focus mode the scope filters like a query, which opens every path down to
  // the focused types, so the focused type is shown without expanding by hand.
  const matched = useMatches(graph, query, props.scope);
  const filtering = matched !== null;
  const { rows, truncated } = useMemo(
    () => treeRows(tree, expanded, matched ?? undefined),
    [tree, expanded, matched]
  );
  const branches = useMemo(() => nest(rows), [rows]);
  const first = useMemo(() => {
    const at = new Map<string, string>();
    for (const row of rows) if (!at.has(row.id)) at.set(row.id, row.key);
    return at;
  }, [rows]);
  const marks: Marks = {
    names,
    selected: props.selected,
    onSelect: props.onSelect,
    countOf,
    problems,
  };

  const toggle = (key: string) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col bg-background font-sans text-[13px] text-prose leading-normal">
      <div className="flex flex-wrap items-center gap-3 border-line border-b px-4 py-2">
        <FilterField onQuery={onQuery} query={query} />
        <Button
          className={READING}
          disabled={filtering}
          onClick={() => setExpanded(openEverything(tree))}
          size="sm"
          variant="outline"
        >
          Expand all
        </Button>
        <Button
          className={READING}
          disabled={filtering}
          onClick={() => setExpanded(new Set())}
          size="sm"
          variant="outline"
        >
          Collapse all
        </Button>
      </div>

      <Scroller label="Creation tree">
        <div className="max-w-240 px-4 py-3.5">
          <div className="flex items-baseline justify-between pr-2">
            <Heading count={tree.roots.length} trace="structure">
              Allowed at root
            </Heading>
            {/* Not what sits under the row: Article under every parent shows the
                same site-wide number, so the header says whose count it is. */}
            {usage ? (
              <span className="text-2xs text-faint">
                Content of this type, site-wide
              </span>
            ) : null}
          </div>
          <Branches
            branches={branches}
            shared={{ filtering, first, marks, onToggle: toggle, tree }}
          />
          <p className="mt-2 text-label text-xs empty:hidden">
            {shortBecause({
              filtering,
              query,
              roots: tree.roots.length,
              rows: rows.length,
              truncated,
            })}
          </p>

          <Unreachable marks={marks} matched={matched} tree={tree} />
        </div>
      </Scroller>
    </div>
  );
}
