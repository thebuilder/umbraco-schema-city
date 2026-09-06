import { Button } from "@/components/ui/button";
import type { SchemaComparison } from "../model/snapshots";
import type { SchemaGraph } from "../model/types";
import { Comparison } from "./Comparison";

export function ComparisonTools({
  baseline,
  comparison,
  graph,
  open,
  onOpenChange,
  onBaselineChange,
  onSelect,
}: {
  baseline: SchemaGraph | null;
  comparison: SchemaComparison | null;
  graph: SchemaGraph;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBaselineChange: (baseline: SchemaGraph | null) => void;
  onSelect: (id: string) => void;
}) {
  const count = comparison
    ? comparison.added.length +
      comparison.removed.length +
      comparison.changed.length
    : null;
  return (
    <>
      <Button
        data-trigger
        onClick={() => onOpenChange(true)}
        size="sm"
        variant={baseline ? "signal" : "outline"}
      >
        Compare {count}
      </Button>
      <Comparison
        baseline={baseline}
        graph={graph}
        onBaselineChange={onBaselineChange}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        open={open}
      />
    </>
  );
}
export function ComparisonLegend({
  comparison,
}: {
  comparison: SchemaComparison | null;
}) {
  if (!comparison) return null;
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-3 border border-line bg-panel px-3 py-2 text-2xs">
      <span className="text-azure">+ {comparison.added.length} added</span>
      <span className="text-amber">△ {comparison.changed.length} changed</span>
      <span>{comparison.removed.length} removed · see Compare</span>
      <span className="text-muted-foreground">Baseline positions</span>
    </div>
  );
}
