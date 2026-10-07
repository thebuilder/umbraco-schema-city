import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  type ChangeGroups,
  type ComparedSides,
  changesCsv,
  changesMarkdown,
  sideLabel,
} from "../model/changes";
import {
  createSnapshot,
  readSnapshotFile,
  snapshotFileName,
} from "../model/snapshots";
import type { SchemaGraph } from "../model/types";
import { useHandOff } from "./a11y";
import { ComparisonResults } from "./ComparisonResults";
import { READING } from "./InspectorChips";
import { saveFile } from "./save-file";

/** Where the loaded baseline came from: its host, or its file name when it has none. */
type BaselineSource = { capturedAt: string; from: string };

/** Saves the snapshot and returns the file name it was saved under. */
function downloadSnapshot(graph: SchemaGraph): string {
  const snapshot = createSnapshot(graph, window.location.hostname);
  const name = snapshotFileName(window.location.hostname, snapshot.capturedAt);
  saveFile(JSON.stringify(snapshot, null, 2), name, "application/json");
  return name;
}

/** The last export or copy, and the last import's error. */
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
          {saved}
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

/** Copy as Markdown and Export CSV, both with the plan as it stands. */
function ExportButtons({
  changes,
  planned,
  sides,
  onDone,
}: {
  changes: ChangeGroups;
  planned: ReadonlySet<string>;
  sides: ComparedSides;
  onDone: (message: string) => void;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        changesMarkdown(changes, planned, sides)
      );
      onDone("Copied the changes as Markdown.");
    } catch {
      onDone("The browser did not allow copying. Export CSV instead.");
    }
  };
  const exportCsv = () => {
    const name = snapshotFileName(
      window.location.hostname,
      new Date().toISOString(),
      "changes.csv"
    );
    saveFile(
      changesCsv(changes, planned, sides),
      name,
      "text/csv;charset=utf-8"
    );
    onDone(`Exported ${name}.`);
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        className={READING}
        onClick={() => void copy()}
        size="sm"
        variant="outline"
      >
        Copy as Markdown
      </Button>
      <Button
        className={READING}
        onClick={exportCsv}
        size="sm"
        variant="outline"
      >
        Export CSV
      </Button>
    </div>
  );
}

export function Comparison({
  baseline,
  changes,
  graph,
  onBaselineChange,
  onOpenChange,
  onSelect,
  open,
}: {
  baseline: SchemaGraph | null;
  changes: ChangeGroups | null;
  graph: SchemaGraph;
  onBaselineChange: (graph: SchemaGraph | null) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  open: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [source, setSource] = useState<BaselineSource | null>(null);
  // The causes marked planned. It lives as long as the baseline does, and a new
  // import starts a new review.
  const [planned, setPlanned] = useState<ReadonlySet<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const importSequence = useRef(0);
  // Inspecting a type closes the drawer, so focus goes to the inspector heading.
  const handOff = useHandOff(input);

  const sides: ComparedSides = {
    baseline: source
      ? sideLabel(source.from, source.capturedAt)
      : "the loaded snapshot",
    current: sideLabel(window.location.hostname, graph.generatedAt),
  };

  const startOver = (next: BaselineSource | null) => {
    setSource(next);
    setPlanned(new Set());
    setError(null);
  };

  const importSnapshot = async (file: File) => {
    const sequence = ++importSequence.current;
    const parsed = await readSnapshotFile(file);
    if (sequence !== importSequence.current) return;
    if (!parsed.snapshot) {
      setError(parsed.error);
      return;
    }
    startOver({
      capturedAt: parsed.snapshot.capturedAt,
      from: parsed.snapshot.host ?? file.name,
    });
    onBaselineChange(parsed.snapshot.graph);
  };

  const exportCurrent = () => {
    setSaved(`Exported ${downloadSnapshot(graph)}.`);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full gap-0 p-0 font-sans text-[13px] text-prose leading-normal sm:max-w-lg"
        finalFocus={handOff.finalFocus}
      >
        <div className="border-line border-b px-4 pt-4 pb-3">
          <SheetTitle className="font-sans font-semibold text-[17px] text-foreground">
            Compare schema
          </SheetTitle>
          <p className="mt-1 text-label text-xs">
            Load a saved schema snapshot to see what changed since. This
            compares schema configuration only and never changes Umbraco.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              className={READING}
              onClick={() => input.current?.click()}
              size="sm"
              variant="outline"
            >
              Import snapshot
            </Button>
            <Button
              className={READING}
              onClick={exportCurrent}
              size="sm"
              variant="outline"
            >
              Export current
            </Button>
            {baseline ? (
              <Button
                className={READING}
                onClick={() => {
                  importSequence.current += 1;
                  onBaselineChange(null);
                  startOver(null);
                }}
                size="sm"
                variant="ghost"
              >
                Clear
              </Button>
            ) : null}
            <input
              accept="application/json,.json"
              aria-label="Snapshot file"
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
          {changes ? (
            <>
              <p className="mt-3 text-faint text-xs">
                Baseline {sides.baseline}. Current {sides.current}.
              </p>
              <ExportButtons
                changes={changes}
                onDone={setSaved}
                planned={planned}
                sides={sides}
              />
            </>
          ) : null}
          <Status error={error} saved={saved} />
        </div>
        <ScrollArea
          className="min-h-0 flex-1"
          viewport={{ "aria-label": "Schema changes" }}
        >
          {changes ? (
            <div className="px-4 py-4">
              <ComparisonResults
                changes={changes}
                onPlanned={setPlanned}
                onSelect={(id) => {
                  handOff.chose();
                  onSelect(id);
                }}
                planned={planned}
              />
            </div>
          ) : (
            <p className="px-4 py-4 text-label text-xs">
              Export this schema first, or import a previous snapshot to begin a
              comparison.
            </p>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
