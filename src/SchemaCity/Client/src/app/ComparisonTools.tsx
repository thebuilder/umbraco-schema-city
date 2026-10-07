import { Button } from "@/components/ui/button";
import type { ChangeGroups, ChangeKind } from "../model/changes";
import type { SchemaGraph } from "../model/types";
import { plural } from "./a11y";
import { Comparison } from "./Comparison";

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
const KEY: { kind: ChangeKind | "none"; label: string; swatch: string }[] = [
  { kind: "added", label: "added", swatch: "bg-azure" },
  { kind: "changed", label: "changed", swatch: "bg-amber" },
  { kind: "side effect", label: "side effect", swatch: "bg-amber/45" },
  {
    kind: "removed",
    label: "removed, outline",
    swatch: "border border-signal",
  },
  { kind: "none", label: "unchanged", swatch: "bg-phosphor-dim/40" },
];

export function ComparisonLegend({
  changes,
}: {
  changes: ChangeGroups | null;
}) {
  if (!changes) return null;
  const counts = new Map<ChangeKind, number>();
  for (const kind of changes.kinds.values())
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return (
    <ul
      aria-label="Change layer"
      className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-panel px-3 py-2 font-sans text-label text-xs"
    >
      {KEY.map(({ kind, label, swatch }) => (
        <li className="flex items-center gap-1.5" key={kind}>
          <span aria-hidden className={`size-2.5 shrink-0 ${swatch}`} />
          {kind === "none" ? null : (
            <span className="font-mono text-prose">
              {counts.get(kind) ?? 0}
            </span>
          )}
          {label}
        </li>
      ))}
      <li className="text-faint">Baseline positions</li>
    </ul>
  );
}
