// The tree view: what an editor can create where, from each root down the
// allowed-child rules, and the Document Types no root reaches. Plain markup, so it
// works where the canvas does not.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  creationTree,
  type CreationTree as Tree,
  type TreeRow,
  treeRows,
} from "../model/creation-tree";
import type { SchemaGraph, SchemaNode } from "../model/types";
import { FilterField, useMatches } from "./TypeTable";

const HEADING =
  "font-bold text-2xs text-phosphor-dim uppercase tracking-terminal";

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

function TypeButton({
  id,
  names,
  onSelect,
}: {
  id: string;
  names: Names;
  onSelect: (id: string) => void;
}) {
  const node = names.get(id);
  return (
    <button
      className="truncate text-left text-phosphor hover:text-phosphor-bright hover:underline"
      onClick={() => onSelect(id)}
      title={node?.alias}
      type="button"
    >
      {node?.name ?? id}
    </button>
  );
}

function TreeItem({
  row,
  names,
  tree,
  filtering,
  selected,
  onToggle,
  onSelect,
}: {
  row: TreeRow;
  names: Names;
  tree: Tree;
  filtering: boolean;
  selected: string | null;
  onToggle: (key: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <li
      className={`flex items-center gap-1.5 py-0.5 ${
        row.id === selected ? "bg-accent" : "hover:bg-accent/50"
      }`}
      style={{ paddingLeft: `${row.depth * 1.25}rem` }}
    >
      {row.expandable ? (
        <button
          aria-expanded={row.open}
          aria-label={`Show what ${names.get(row.id)?.name} can create`}
          className="w-4 shrink-0 text-phosphor-dim hover:text-phosphor-bright disabled:opacity-50"
          disabled={filtering}
          onClick={() => onToggle(row.key)}
          type="button"
        >
          {row.open ? "▾" : "▸"}
        </button>
      ) : (
        <span aria-hidden className="w-4 shrink-0" />
      )}
      <TypeButton id={row.id} names={names} onSelect={onSelect} />
      {row.recursive ? (
        <span className="shrink-0 text-3xs text-amber">
          ↻ already above in this branch
        </span>
      ) : null}
      {row.expandable ? (
        <span className="shrink-0 text-3xs text-phosphor-dim">
          {tree.children.get(row.id)?.length} allowed
        </span>
      ) : null}
    </li>
  );
}

function Unreachable({
  tree,
  names,
  matched,
  selected,
  onSelect,
}: {
  tree: Tree;
  names: Names;
  matched: ReadonlySet<string> | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const shown = tree.unreachable.filter(
    (entry) => matched === null || matched.has(entry.id)
  );
  return (
    <>
      <h2 className={`${HEADING} mt-6`}>
        Not reachable from any root ({tree.unreachable.length})
      </h2>
      <p className="mt-1 text-muted-foreground">
        Leaves out {tree.excluded.elements} Element Types and{" "}
        {tree.excluded.compositions} compositions that nothing can create,
        because neither is created in the content tree.
      </p>
      <ul className="mt-1.5">
        {shown.map((entry) => (
          <li
            className={`flex flex-wrap items-baseline gap-x-2 py-0.5 ${
              entry.id === selected ? "bg-accent" : "hover:bg-accent/50"
            }`}
            key={entry.id}
          >
            <TypeButton id={entry.id} names={names} onSelect={onSelect} />
            <span className="text-3xs text-phosphor-dim">
              {entry.parents.length === 0
                ? "no allowed parent"
                : "allowed under"}
            </span>
            {entry.parents.map((parent) => (
              <span className="text-3xs" key={parent}>
                <TypeButton id={parent} names={names} onSelect={onSelect} />
              </span>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

export function CreationTree({
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
  const tree = useMemo(() => creationTree(graph), [graph]);
  const names = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );
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

  const toggle = (key: string) =>
    setExpanded((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-line border-b px-4 py-2">
        <FilterField onQuery={onQuery} query={query} />
        <Button
          disabled={filtering}
          onClick={() => setExpanded(openEverything(tree))}
          size="sm"
          variant="outline"
        >
          Expand all
        </Button>
        <Button
          disabled={filtering}
          onClick={() => setExpanded(new Set())}
          size="sm"
          variant="outline"
        >
          Collapse all
        </Button>
        <p className="text-muted-foreground text-2xs">
          {tree.roots.length} allowed at root · {tree.unreachable.length}{" "}
          unreachable
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs">
        <h2 className={HEADING}>Allowed at root, and what each can create</h2>
        <ul className="mt-1.5">
          {rows.map((row) => (
            <TreeItem
              filtering={filtering}
              key={row.key}
              names={names}
              onSelect={onSelect}
              onToggle={toggle}
              row={row}
              selected={selected}
              tree={tree}
            />
          ))}
        </ul>
        {/* One line for whichever reason the list above is short: nothing allowed
            at root, nothing matching the filter, or the row limit. */}
        <p className="mt-2 text-amber empty:hidden">
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

        <Unreachable
          matched={matched}
          names={names}
          onSelect={onSelect}
          selected={selected}
          tree={tree}
        />
      </div>
    </div>
  );
}
