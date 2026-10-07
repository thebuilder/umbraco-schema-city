import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { dayOf } from "../model/dates";
import {
  compareSchemas,
  createSnapshot,
  readSnapshotFile,
  snapshotFileName,
} from "../model/snapshots";
import type { SchemaGraph } from "../model/types";
import { ComparisonResults } from "./ComparisonResults";

/** Saves the snapshot and returns the file name it was saved under. */
function downloadSnapshot(graph: SchemaGraph): string {
  const snapshot = createSnapshot(graph);
  const name = snapshotFileName(window.location.hostname, snapshot.capturedAt);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

/** The file the last export saved, and the last import's error. */
function Status({
  error,
  saved,
}: {
  error: string | null;
  saved: string | null;
}) {
  return (
    <>
      {saved ? (
        <p className="mt-2 text-phosphor text-xs" role="status">
          Exported {saved}.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-signal text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** The two snapshot dates. An epoch date is a placeholder, so it is left out. */
function datesLine(generatedAt: string, baselineCapturedAt: string | null) {
  const current = dayOf(generatedAt);
  return `Current graph${current ? `: ${current}` : ""} · baseline ${dayOf(baselineCapturedAt) ?? "loaded"}`;
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
  const [saved, setSaved] = useState<string | null>(null);
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
              onClick={() => setSaved(downloadSnapshot(graph))}
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
          <Status error={error} saved={saved} />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {comparison ? (
            <div className="space-y-3 px-3 py-4">
              <p className="text-3xs text-phosphor-dim">
                {datesLine(graph.generatedAt, baselineCapturedAt)}
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
