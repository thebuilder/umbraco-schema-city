// The view switcher and the 2D views it chooses between. Kept out of App so the
// toolbar there only places the switcher.
import { type ReactNode, useState } from "react";
import { toggleVariants } from "@/components/ui/toggle";
import type { Finding } from "../model/findings";
import { type Role, roleOf } from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import { reachableWithin } from "../model/reach";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { plural, roving, useAnnounceChange } from "./a11y";
import { CreationTree } from "./CreationTree";
import { DataTypes, type DataTypesProps } from "./DataTypes";
import { EditorLayout } from "./EditorLayout";
import { ImpactView, type ImpactViewProps } from "./Impact";
import { TextButton } from "./InspectorChips";
import { Matrix } from "./Matrix";
import { type ListProps, TypeTable } from "./TypeTable";
import { TYPE_PAGES, type View } from "./url";

/**
 * The switcher's entries, the views over the whole schema, and the single key that
 * toggles each one. Data Types has none: D pans the camera and no free letter says
 * Data Types.
 */
export const VIEW_TABS: { value: View; label: string; key?: string }[] = [
  { value: "city", label: "City" },
  { value: "list", label: "List", key: "l" },
  { value: "tree", label: "Tree", key: "t" },
  { value: "matrix", label: "Matrix", key: "m" },
  { value: "datatypes", label: "Data Types" },
];

/**
 * The pages about the selected type, which open from the inspector or their key
 * rather than the switcher: without a type they would be empty.
 */
export const PAGE_TABS: { value: View; label: string; key: string }[] = [
  { value: "editor", label: "Editor", key: "e" },
  { value: "impact", label: "Impact", key: "i" },
];

const labelOf = (view: View) =>
  [...VIEW_TABS, ...PAGE_TABS].find((tab) => tab.value === view)?.label ??
  "City";

/**
 * The schema-wide view a type page goes back to: the view on now, or while a type
 * page is on, the one before it.
 */
export const backFrom = (view: View, back: View) =>
  TYPE_PAGES.includes(view) ? back : view;

/**
 * The type the page on screen is about. The trace keeps its own start while a click
 * on one of its rows selects another type; the editor shows the selection.
 */
export const aboutOf = (
  view: View,
  selected: string | null,
  traced: string | null
) => (view === "impact" ? (traced ?? selected) : selected);

/**
 * What E, I and the inspector's Editor and Impact do: go back when that page is
 * already on this type, or has no type, open it on the selection, or with nothing
 * selected, say so.
 */
export function pageStep(
  page: View,
  view: View,
  selected: string | null,
  about: string | null
): "back" | "open" | "nudge" {
  if (view === page && (!selected || about === selected)) return "back";
  return selected ? "open" : "nudge";
}

/**
 * The type pages' state: which schema-wide view they go back to, what the one on
 * screen is about, and how many times E or I found nothing to open. A type page
 * whose type was put down goes back rather than standing empty.
 */
export function useTypePages(
  view: View,
  setView: (view: View) => void,
  selected: string | null,
  traced: string | null,
  openImpact: (id: string | null) => void
) {
  const [back, setBack] = useState<View>(() => backFrom(view, "city"));
  if (backFrom(view, back) !== back) setBack(backFrom(view, back));
  const [nudge, setNudge] = useState(0);
  const about = aboutOf(view, selected, traced);
  if (TYPE_PAGES.includes(view) && !about) setView(back);
  const steps = {
    back: () => setView(back),
    nudge: () => setNudge((count) => count + 1),
    open: (page: View) =>
      page === "impact" ? openImpact(selected) : setView(page),
  };
  return {
    back,
    nudge,
    /** Opens the page on the selection, or goes back from it. */
    toggle: (page: View) => steps[pageStep(page, view, selected, about)](page),
    /** Whether `page` is on screen about `id`, which presses its button. */
    isOn: (page: View, id: string) => view === page && about === id,
  };
}

const ITEM = `${toggleVariants({ size: "sm", variant: "outline" })} min-w-0 border-0 bg-secondary px-3 focus-visible:z-10 focus-visible:outline-offset-[-2px]`;

/**
 * The canvas view and the 2D views that replace it, as a radio group: one choice,
 * arrow keys to move it, and the chosen view as the one tab stop. Built from
 * buttons with radio roles rather than base-ui's toggle group, whose roving focus
 * stayed on the item last pressed when L, T or M switched the view, and rather
 * than native radios, which would swallow those keys as typing in a field.
 */
export function ViewSwitcher({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  // On a type page no radio is checked, and the first one is the tab stop.
  const current = VIEW_TABS.some((tab) => tab.value === view) ? view : null;
  return (
    <div
      aria-label="View"
      className="flex w-fit items-center gap-px bg-line p-px"
      onKeyDown={roving}
      role="radiogroup"
    >
      {VIEW_TABS.map((tab, index) => {
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
            tabIndex={on || (current === null && index === 0) ? 0 : -1}
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
  lit = null,
  presenting = false,
}: {
  selected: string | null;
  view: View;
  presenting?: boolean;
  layers: string[];
  focus: FocusScope | null;
  nodesById: Map<string, SchemaNode>;
  /** What Show in city lit, as "types using Textstring". */
  lit?: string | null;
}) {
  const name = (id: string | null | undefined) =>
    nodesById.get(id ?? "")?.name ?? "";
  useAnnounceChange(
    selected ? `${name(selected)} selected` : "Selection cleared"
  );
  useAnnounceChange(`${labelOf(view)} view`);
  useAnnounceChange(`Layers on: ${layers.join(", ") || "none"}`);
  useAnnounceChange(
    lit
      ? `${lit.charAt(0).toUpperCase()}${lit.slice(1)} lit in the city`
      : "City lighting cleared"
  );
  useAnnounceChange(
    focus
      ? `Focus on ${name(focus.around)}, ${plural(focus.ids.size, "type")}`
      : "Focus off"
  );
  useAnnounceChange(
    presenting
      ? "Presentation mode on. Escape leaves it"
      : "Presentation mode off"
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
const LISTS: Partial<Record<View, (props: ListProps) => ReactNode>> = {
  list: TypeTable,
  tree: CreationTree,
  matrix: Matrix,
};

type FlatViewProps = {
  /** What the Impact view needs beyond the lists' props. */
  impact: Pick<ImpactViewProps, "start" | "alias" | "onAlias" | "onShowInCity">;
  /** Opens the Impact view on a property of the type the editor view shows. */
  onImpact?: (alias: string, from: string | null) => void;
  /** What the Data Types view needs beyond the lists' props. */
  dataTypes: Pick<
    DataTypesProps,
    "selected" | "onChoose" | "onOpenDataType" | "onShowInCity"
  >;
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
  /** The schema-wide view a type page goes back to, and the way there. */
  back?: { view: View; onBack: () => void };
};

type PageProps = FlatViewProps & { roleFor: (node: SchemaNode) => Role };

/**
 * The views that are pages of their own rather than lists. Focus does not narrow
 * them: Data Types are not types, and the editor and impact pages are about one.
 */
const PAGES: Partial<Record<View, (props: PageProps) => ReactNode>> = {
  datatypes: (props) => (
    <DataTypes
      {...props.dataTypes}
      findings={props.findings}
      graph={props.graph}
      nodesById={props.nodesById}
      onSelect={props.onSelect}
      roleOf={props.roleFor}
      usage={props.usage}
    />
  ),
  editor: (props) => (
    <EditorLayout
      findings={props.findings}
      nodesById={props.nodesById}
      onImpact={props.onImpact}
      onPick={props.onPick}
      onSelect={props.onSelect}
      roleOf={props.roleFor}
      selected={props.selected}
    />
  ),
  impact: (props) => (
    <ImpactView
      {...props.impact}
      graph={props.graph}
      nodesById={props.nodesById}
      onPick={props.onPick}
      onSelect={props.onSelect}
      usage={props.usage}
    />
  ),
};

export function FlatView(props: FlatViewProps) {
  const page = PAGES[props.view];
  if (!page) return <Lists {...props} />;
  const body = page({
    ...props,
    roleFor: (node) => roleOf(node, props.neighbourhoodById.get(node.id)),
  });
  if (!(props.back && TYPE_PAGES.includes(props.view))) return body;
  const about = props.view === "impact" ? props.impact.start : props.selected;
  return (
    <div className="flex h-full flex-col bg-background">
      <Crumb
        back={props.back}
        name={props.nodesById.get(about ?? "")?.name ?? ""}
        page={props.view}
      />
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

/**
 * Where a type page sits, as "Home › Editor", and the way back to the schema-wide
 * view it was opened from, with the selection kept.
 */
function Crumb({
  back,
  name,
  page,
}: {
  back: NonNullable<FlatViewProps["back"]>;
  name: string;
  page: View;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-baseline gap-x-2 border-line border-b bg-panel px-4 py-1.5 font-sans text-label text-xs"
    >
      <TextButton onClick={back.onBack}>
        ← Back to {labelOf(back.view)}
      </TextButton>
      <ol className="flex min-w-0 items-baseline gap-1.5">
        <li className="truncate text-prose">{name}</li>
        <li aria-hidden>›</li>
        <li aria-current="page" className="text-foreground">
          {labelOf(page)}
        </li>
      </ol>
    </nav>
  );
}

function Lists({
  view,
  graph,
  usage,
  query,
  onQuery,
  selected,
  onSelect,
  nodesById,
  findings,
  scope = null,
  onShowAll = () => undefined,
}: FlatViewProps) {
  const List = LISTS[view] ?? TypeTable;
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
