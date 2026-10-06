// The view switcher and the 2D views it chooses between. Kept out of App so the
// toolbar there only places the switcher.
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Finding } from "../model/findings";
import { roleOf } from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { CreationTree } from "./CreationTree";
import { EditorLayout } from "./EditorLayout";
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

/** The canvas view and the 2D views that replace it. */
export function ViewSwitcher({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <ToggleGroup
      aria-label="View"
      onValueChange={(value) => {
        // Pressing the view that is already on sends no value; keep it.
        const next = VIEW_TABS.find((tab) => tab.value === value[0]);
        if (next) onView(next.value);
      }}
      size="sm"
      value={[FLAT_VIEWS.includes(view) ? view : "city"]}
      variant="outline"
    >
      {VIEW_TABS.map((tab) => (
        <ToggleGroupItem key={tab.value} value={tab.value}>
          {tab.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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
}) {
  const shared = { graph, onQuery, onSelect, query, selected };
  if (view === "tree")
    return <CreationTree {...shared} findings={findings} usage={usage} />;
  if (view === "matrix") return <Matrix {...shared} />;
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
  return <TypeTable {...shared} findings={findings} usage={usage} />;
}
