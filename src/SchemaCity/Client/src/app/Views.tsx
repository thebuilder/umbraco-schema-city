// The view switcher and the 2D views it chooses between. Kept out of App so the
// toolbar there only places the switcher.
import { toggleVariants } from "@/components/ui/toggle";
import type { Finding } from "../model/findings";
import { roleOf } from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import { reachableWithin } from "../model/reach";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { plural, roving, useAnnounceChange } from "./a11y";
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

/** In focus mode, the focused type and its neighbours, which the lists narrow to. */
export type FocusScope = { ids: ReadonlySet<string>; around: string };

export const focusScope = (
  graph: SchemaGraph,
  focus: string | null,
  depth: number
): FocusScope | null =>
  focus ? { ids: reachableWithin(graph, focus, depth), around: focus } : null;

/**
 * What the live region says as the app changes around a screen reader: the
 * selection, the view, the layers that are on, and focus with how many types it
 * shows. Each speaks when it changes, not when the app opens.
 */
export function Announcements({
  selected,
  view,
  layers,
  focus,
  nodesById,
}: {
  selected: string | null;
  view: View;
  layers: string[];
  focus: FocusScope | null;
  nodesById: Map<string, SchemaNode>;
}) {
  const name = (id: string | null | undefined) =>
    nodesById.get(id ?? "")?.name ?? "";
  useAnnounceChange(
    selected ? `${name(selected)} selected` : "Selection cleared"
  );
  useAnnounceChange(
    `${VIEW_TABS.find((tab) => tab.value === view)?.label ?? "City"} view`
  );
  useAnnounceChange(`Layers on: ${layers.join(", ") || "none"}`);
  useAnnounceChange(
    focus
      ? `Focus on ${name(focus.around)}, ${plural(focus.ids.size, "type")}`
      : "Focus off"
  );
  return null;
}

/** The line over a list in focus mode, with the way back to every type. */
function FocusNote({
  scope,
  nodesById,
  onShowAll,
}: {
  scope: FocusScope;
  nodesById: Map<string, SchemaNode>;
  onShowAll: () => void;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1 border-line border-b bg-panel px-4 py-1.5 font-sans text-label text-xs">
      Showing the {plural(scope.ids.size, "type")} around{" "}
      {nodesById.get(scope.around)?.name ?? "the focused type"}.
      <TextButton onClick={onShowAll}>Show all</TextButton>
    </p>
  );
}

/** The List, Tree or Matrix, by the view's name. */
const LISTS = {
  list: TypeTable,
  tree: CreationTree,
  matrix: Matrix,
} as const;

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
  onShowAll = () => undefined,
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
  scope?: FocusScope | null;
  /** Leaves focus, which is how the lists go back to every type. */
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
  const List = LISTS[view === "tree" || view === "matrix" ? view : "list"];
  // One shape in and out of focus, so entering focus keeps the list mounted with
  // its sort, its open branches and the row that has keyboard focus.
  return (
    <div className="flex h-full flex-col bg-background">
      {scope ? (
        <FocusNote nodesById={nodesById} onShowAll={onShowAll} scope={scope} />
      ) : null}
      <div className="min-h-0 flex-1">
        <List
          findings={findings}
          graph={graph}
          onQuery={onQuery}
          onSelect={onSelect}
          query={query}
          scope={scope?.ids ?? null}
          selected={selected}
          usage={usage}
        />
      </div>
    </div>
  );
}
