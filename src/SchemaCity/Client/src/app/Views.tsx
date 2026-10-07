// The view switcher and the 2D views it chooses between. Kept out of App so the
// toolbar there only places the switcher.
import { toggleVariants } from "@/components/ui/toggle";
import type { Finding } from "../model/findings";
import { roleOf } from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { roving } from "./a11y";
import { CreationTree } from "./CreationTree";
import { EditorLayout } from "./EditorLayout";
import { TextButton } from "./InspectorChips";
import { Matrix } from "./Matrix";
import { TypeTable } from "./TypeTable";
import { FLAT_VIEWS, type View } from "./url";

/** The switcher's entries, and the single key that toggles each one. */
export const VIEW_TABS: { value: View; label: string; key?: string }[] = [
  { value: "city", label: "City" },
  { value: "list", label: "List", key: "l" },
  { value: "tree", label: "Tree", key: "t" },
  { value: "matrix", label: "Matrix", key: "m" },
  { value: "editor", label: "Editor", key: "e" },
];

const ITEM = `${toggleVariants({ size: "sm", variant: "outline" })} min-w-0 border-0 bg-secondary px-3 focus-visible:z-10 focus-visible:outline-offset-[-2px]`;

/**
 * The canvas view and the 2D views that replace it, as a radio group: one choice,
 * arrow keys to move it, and the chosen view as the one tab stop. Built from
 * buttons with radio roles rather than base-ui's toggle group, whose roving focus
 * stayed on the item last pressed when L, T, M or E switched the view, and rather
 * than native radios, which would swallow those keys as typing in a field.
 */
export function ViewSwitcher({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  const current = FLAT_VIEWS.includes(view) ? view : "city";
  return (
    <div
      aria-label="View"
      className="flex w-fit items-center gap-px bg-line p-px"
      onKeyDown={roving}
      role="radiogroup"
    >
      {VIEW_TABS.map((tab) => {
        const on = tab.value === current;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a native radio is a field, and the app's single-key shortcuts stand down inside fields.
          <button
            aria-checked={on}
            aria-keyshortcuts={tab.key?.toUpperCase()}
            className={ITEM}
            data-pressed={on ? "" : undefined}
            key={tab.value}
            onClick={() => onView(tab.value)}
            role="radio"
            tabIndex={on ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function FlatView({
  view,
  graph,
  usage,
  query,
  onQuery,
  selected,
  onSelect,
  nodesById,
  onPick,
  findings,
  neighbourhoodById,
  scope = null,
  onShowAll,
}: {
  view: View;
  graph: SchemaGraph;
  usage?: UsageReport;
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  nodesById: Map<string, SchemaNode>;
  onPick: () => void;
  findings: Finding[];
  neighbourhoodById: Map<string, Neighbourhood>;
  /** In focus mode, the focused type and its neighbours; the lists show only these. */
  scope?: { ids: ReadonlySet<string>; around: string } | null;
  onShowAll?: () => void;
}) {
  if (view === "editor")
    return (
      <EditorLayout
        findings={findings}
        nodesById={nodesById}
        onPick={onPick}
        onSelect={onSelect}
        roleOf={(node) => roleOf(node, neighbourhoodById.get(node.id))}
        selected={selected}
      />
    );
  const shared = {
    graph,
    onQuery,
    onSelect,
    query,
    scope: scope?.ids ?? null,
    selected,
  };
  let list = <TypeTable {...shared} findings={findings} usage={usage} />;
  if (view === "tree")
    list = <CreationTree {...shared} findings={findings} usage={usage} />;
  if (view === "matrix") list = <Matrix {...shared} />;
  if (!scope) return list;
  return (
    <div className="flex h-full flex-col bg-background">
      <p className="flex flex-wrap items-baseline gap-x-1 border-line border-b bg-panel px-4 py-1.5 font-sans text-label text-xs">
        Showing the {scope.ids.size} types around{" "}
        {nodesById.get(scope.around)?.name ?? "the focused type"}.
        <TextButton onClick={() => onShowAll?.()}>Show all</TextButton>
      </p>
      <div className="min-h-0 flex-1">{list}</div>
    </div>
  );
}
