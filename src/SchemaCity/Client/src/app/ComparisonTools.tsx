import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  type ChangeGroups,
  type ChangeKind,
  groupChanges,
} from "../model/changes";
import { compareSchemas } from "../model/snapshots";
import type { SchemaGraph } from "../model/types";
import { plural } from "./a11y";
import { Comparison } from "./Comparison";
import { changeScale, type LensScale } from "./scene/lens";

export function ComparisonTools({
  baseline,
  changes,
  graph,
  open,
  onOpenChange,
  onBaselineChange,
  onSelect,
}: {
  baseline: SchemaGraph | null;
  changes: ChangeGroups | null;
  graph: SchemaGraph;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBaselineChange: (baseline: SchemaGraph | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <Button
        aria-label={
          changes
            ? `Compare, ${plural(changes.causes.length, "cause")}`
            : "Compare"
        }
        data-trigger
        onClick={() => onOpenChange(true)}
        size="sm"
        variant={baseline ? "signal" : "outline"}
      >
        Compare {changes?.causes.length}
      </Button>
      <Comparison
        baseline={baseline}
        changes={changes}
        graph={graph}
        onBaselineChange={onBaselineChange}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        open={open}
      />
    </>
  );
}

/** The change layer's swatches, each drawn the way the city draws that kind. */
const KEY: {
  kind: ChangeKind | "none";
  one: string;
  many: string;
  swatch: string;
}[] = [
  { kind: "added", one: "added", many: "added", swatch: "bg-azure" },
  { kind: "changed", one: "changed", many: "changed", swatch: "bg-amber" },
  {
    kind: "side effect",
    one: "side effect",
    many: "side effects",
    swatch: "bg-amber/30",
  },
  {
    kind: "removed",
    one: "removed, outline",
    many: "removed, outlines",
    swatch: "border border-signal",
  },
  {
    kind: "none",
    one: "unchanged",
    many: "unchanged",
    swatch: "bg-phosphor-dim/40",
  },
];

/** Each swatch with its words, counted where the comparison has a count. */
function legendEntries(changes: ChangeGroups) {
  const counts = new Map<string, number>();
  for (const kind of changes.kinds.values())
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return KEY.map(({ kind, one, many, swatch }) => ({
    kind,
    swatch,
    text: kind === "none" ? one : plural(counts.get(kind) ?? 0, one, many),
  }));
}

/** The change layer's key, shown while the change layer colours the city. */
export function ComparisonLegend({
  changes,
  scale,
}: {
  changes: ChangeGroups | null;
  scale: LensScale | null;
}) {
  if (!changes || scale?.ramp !== "change") return null;
  return (
    <ul
      aria-label="Change layer"
      className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-panel px-3 py-2 font-sans text-label text-xs"
    >
      {legendEntries(changes).map(({ kind, swatch, text }) => (
        <li className="flex items-center gap-1.5" key={kind}>
          <span aria-hidden className={`size-2.5 shrink-0 ${swatch}`} />
          {text}
        </li>
      ))}
      <li className="text-faint">Baseline positions</li>
    </ul>
  );
}

/**
 * The comparison against the loaded baseline: the flat changes the city lays out
 * by, the same read as causes, what the List needs, and the change layer.
 */
export function useComparison(
  baseline: SchemaGraph | null,
  graph: SchemaGraph
) {
  return useMemo(() => {
    if (!baseline)
      return { comparison: null, changes: null, compare: null, layer: null };
    const comparison = compareSchemas(baseline, graph);
    const changes = groupChanges(comparison);
    return {
      comparison,
      changes,
      compare: { baseline, changes },
      layer: changeScale(graph, changes.kinds),
    };
  }, [baseline, graph]);
}
