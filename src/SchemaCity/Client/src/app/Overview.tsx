import { Button } from "@/components/ui/button";
import type { SchemaGraph, UsageReport } from "../model/types";
import type { View } from "./url";

export function Overview({
  graph,
  onFindings,
  onList,
  onSearch,
  selected,
  usage,
  view,
}: {
  graph: SchemaGraph;
  onFindings: () => void;
  onList: () => void;
  onSearch: () => void;
  selected: boolean;
  usage?: UsageReport;
  view: View;
}) {
  if (view === "list" || selected || graph.nodes.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute right-4 bottom-4 left-4 z-10 max-w-sm border border-line-strong bg-panel/95 p-3 shadow-panel sm:right-auto">
      <p className="font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
        Inspect your Umbraco content model
      </p>
      <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
        Buildings are Document Types. Roads show structure, compositions,
        blocks, and picker references. Select a building to inspect its
        properties and direct connections.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={onFindings} size="sm" variant="signal">
          Review findings
        </Button>
        <Button onClick={onList} size="sm" variant="outline">
          Open type list
        </Button>
        <button
          className="text-muted-foreground text-xs underline-offset-2 hover:text-phosphor-bright hover:underline"
          onClick={onSearch}
          type="button"
        >
          Search types
        </button>
        <span className="text-3xs text-muted-foreground">
          {graph.nodes.length} types · {graph.edges?.length ?? 0} connections
        </span>
        <span className="text-3xs text-amber">
          {usage
            ? `Usage snapshot ${usage.generatedAt.slice(0, 10)}`
            : "Usage unavailable; usage-dependent checks are omitted"}
        </span>
      </div>
    </div>
  );
}
