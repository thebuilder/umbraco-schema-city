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
import { problemLabels } from "../model/findings";
import { chips, contentCountOf } from "../model/inspector";
import type { SchemaNode } from "../model/types";
import { FindingDot, Heading, READING, TypeChips } from "./InspectorChips";
import { FilterField, type ListProps, useMatches } from "./TypeTable";

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
  problems: Map<string, string>;
};

/**
 * The type's name, quieter when the usage snapshot counts no content of it, so the
 * branches where content lives stand out. A pink dot names its problems.
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
      {problems ? <FindingDot title={problems} /> : null}
    </>
  );
}

function Count({ value }: { value: number | undefined }) {
  return value === undefined ? null : (
    <span className="ml-auto shrink-0 pl-3 font-mono text-2xs text-faint">
      {value.toLocaleString()}
    </span>
  );
}

const ROW = (on: boolean) => (on ? "bg-accent" : "hover:bg-accent/50");

function TreeItem({
  row,
  tree,
  filtering,
  onToggle,
  marks,
}: {
  row: TreeRow;
  tree: Tree;
  filtering: boolean;
  onToggle: (key: string) => void;
  marks: Marks;
}) {
  const allowed = tree.children.get(row.id)?.length ?? 0;
  return (
    <li className={`flex items-stretch pr-2 ${ROW(row.id === marks.selected)}`}>
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
        {row.expandable ? (
          <button
            aria-expanded={row.open}
            aria-label={`Show what ${marks.names.get(row.id)?.name} can create`}
            className="w-4 shrink-0 text-faint hover:text-phosphor-bright disabled:opacity-50"
            disabled={filtering}
            onClick={() => onToggle(row.key)}
            type="button"
          >
            {row.open ? "▾" : "▸"}
          </button>
        ) : (
          <span aria-hidden className="w-4 shrink-0" />
        )}
        <TypeName id={row.id} marks={marks} />
        {row.recursive ? (
          <span className="shrink-0 text-2xs text-faint">
            ↻ already above in this branch
          </span>
        ) : null}
        {row.expandable ? (
          <span
            className="shrink-0 text-2xs text-faint"
            title={`${allowed} allowed child ${allowed === 1 ? "type" : "types"}`}
          >
            <span className="font-mono">{allowed}</span> allowed
          </span>
        ) : null}
        <Count value={marks.countOf(row.id)} />
      </div>
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
            <Count value={marks.countOf(entry.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
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
  const problems = useMemo(() => problemLabels(findings), [findings]);
  // Roots start open: a closed list of three names says less than the level below.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(tree.roots)
  );
  const matched = useMatches(graph, query);
  const filtering = matched !== null;
  const { rows, truncated } = useMemo(
    () => treeRows(tree, expanded, matched ?? undefined),
    [tree, expanded, matched]
  );
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

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-240 px-4 py-3.5">
          <div className="flex items-baseline justify-between pr-2">
            <Heading count={tree.roots.length} trace="structure">
              Allowed at root
            </Heading>
            {usage ? (
              <span className="text-2xs text-faint">Content items</span>
            ) : null}
          </div>
          <ul>
            {rows.map((row) => (
              <TreeItem
                filtering={filtering}
                key={row.key}
                marks={marks}
                onToggle={toggle}
                row={row}
                tree={tree}
              />
            ))}
          </ul>
          {/* One line for whichever reason the list above is short: nothing allowed
              at root, nothing matching the filter, or the row limit. */}
          <p className="mt-2 text-label text-xs empty:hidden">
            {tree.roots.length === 0
              ? "No Document Type is allowed at root, so an editor cannot create any content."
              : ""}
            {filtering && rows.length === 0
              ? `No type under a root matches “${query}”.`
              : ""}
            {truncated
              ? `Stopped after ${rows.length} rows. Collapse a branch or filter to see the rest.`
              : ""}
          </p>

          <Unreachable marks={marks} matched={matched} tree={tree} />
        </div>
      </div>
    </div>
  );
}
