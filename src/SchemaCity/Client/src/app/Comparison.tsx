import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  compareSchemas,
  createSnapshot,
  readSnapshotFile,
} from "../model/snapshots";
import type { SchemaGraph } from "../model/types";
import { ComparisonResults } from "./ComparisonResults";

function downloadSnapshot(graph: SchemaGraph) {
  const blob = new Blob([JSON.stringify(createSnapshot(graph), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "schema-city-snapshot.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function Comparison({
  baseline,
  graph,
  onBaselineChange,
  onOpenChange,
  onSelect,
  open,
}: {
  baseline: SchemaGraph | null;
  graph: SchemaGraph;
  onBaselineChange: (graph: SchemaGraph | null) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  open: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [baselineCapturedAt, setBaselineCapturedAt] = useState<string | null>(
    null
  );
  const input = useRef<HTMLInputElement>(null);
  const importSequence = useRef(0);
  const comparison = useMemo(
    () => (baseline ? compareSchemas(baseline, graph) : null),
    [baseline, graph]
  );

  const importSnapshot = async (file: File) => {
    const sequence = ++importSequence.current;
    const parsed = await readSnapshotFile(file);
    if (sequence !== importSequence.current) return;
    if (!parsed.snapshot) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setBaselineCapturedAt(parsed.snapshot.capturedAt);
    onBaselineChange(parsed.snapshot.graph);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <div className="border-line border-b px-4 py-3">
          <SheetTitle className="text-sm uppercase tracking-terminal-lg">
            Compare schema
          </SheetTitle>
          <p className="mt-1 text-muted-foreground text-xs">
            Load a saved schema snapshot to see what changed. This compares
            schema configuration only.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() => input.current?.click()}
              size="sm"
              variant="outline"
            >
              Import snapshot
            </Button>
            <Button
              onClick={() => downloadSnapshot(graph)}
              size="sm"
              variant="outline"
            >
              Export current
            </Button>
            {baseline ? (
              <Button
                onClick={() => {
                  importSequence.current += 1;
                  onBaselineChange(null);
                  setBaselineCapturedAt(null);
                  setError(null);
                }}
                size="sm"
                variant="ghost"
              >
                Clear
              </Button>
            ) : null}
            <input
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSnapshot(file);
                event.target.value = "";
              }}
              ref={input}
              type="file"
            />
          </div>
          {error ? (
            <p className="mt-2 text-signal text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {comparison ? (
            <div className="space-y-3 px-3 py-4">
              <p className="text-3xs text-phosphor-dim">
                Current graph: {graph.generatedAt.slice(0, 10)} · baseline{" "}
                {snapshotDate(baselineCapturedAt)}
              </p>
              <ComparisonResults comparison={comparison} onSelect={onSelect} />
            </div>
          ) : (
            <p className="px-4 py-4 text-muted-foreground text-xs">
              Export this schema first, or import a previous snapshot to begin a
              comparison.
            </p>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function snapshotDate(timestamp: string | null) {
  return timestamp?.slice(0, 10) ?? "loaded";
}
