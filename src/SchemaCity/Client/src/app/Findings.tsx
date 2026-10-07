import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  FINDING_KINDS,
  FINDING_LABEL,
  type Finding,
  type FindingKind,
  type FindingSeverity,
  findingGroups,
  KIND_EXPLANATION,
  KIND_NEXT_STEP,
} from "../model/findings";
import { findingsCsv } from "../model/findings-export";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { READING } from "./InspectorChips";

/**
 * One finding. The group above it carries the kind and what it means, so the row
 * is the type and what is particular to it. Clicking selects the type, which for a
 * broken block reference is the host: the missing Element Type has no building.
 */
function Row({
  finding,
  name,
  onSelect,
}: {
  finding: Finding;
  name: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className="group block w-full border-line/40 border-t px-3 py-1.5 text-left first:border-t-0 hover:bg-accent/50"
      onClick={() => onSelect(finding.nodeId)}
      type="button"
    >
      <span className="block truncate text-prose group-hover:text-phosphor">
        {name}
      </span>
      <span className="block text-label text-xs">{finding.summary}</span>
    </button>
  );
}

/** Pink for a problem and grey for a note, as the inspector's checks draw them. */
const TONE: Record<
  FindingSeverity,
  { border: string; text: string; word: string }
> = {
  problem: { border: "border-signal", text: "text-signal", word: "Problem" },
  note: { border: "border-label", text: "text-label", word: "Note" },
};

/**
 * The findings of one kind under a header that says once what they mean. Problems
 * start open and notes closed; picking a note's chip opens it, since that is a
 * request to read it.
 */
function Group({
  kind,
  open,
  rows,
  nodesById,
  onSelect,
}: {
  kind: FindingKind;
  open: boolean;
  rows: Finding[];
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
}) {
  const tone = TONE[rows[0]?.severity ?? "note"];
  return (
    <details className={`border-l-2 bg-muted ${tone.border}`} open={open}>
      <summary className="flex cursor-pointer items-baseline gap-2 px-3 pt-2.5 pb-1">
        <span className={`font-semibold ${tone.text}`}>
          {FINDING_LABEL[kind]}
        </span>
        <span className="font-mono text-2xs text-faint">{rows.length}</span>
        <span className={`ml-auto text-xs ${tone.text}`}>{tone.word}</span>
      </summary>
      <p className="px-3 pb-2 text-label text-xs">{KIND_EXPLANATION[kind]}</p>
      <p className="px-3 pb-2 text-label text-xs">
        What to do: {KIND_NEXT_STEP[kind]}
      </p>
      <div className="border-line/40 border-t bg-panel">
        {rows.map((finding) => (
          <Row
            finding={finding}
            key={finding.id}
            name={nodesById.get(finding.nodeId)?.name ?? "a deleted type"}
            onSelect={onSelect}
          />
        ))}
      </div>
    </details>
  );
}

/**
 * The findings drawer, and the toolbar button that opens it. The filter is a set of
 * kinds, and an empty set means every kind, which is the ordinary way a row of
 * filter chips behaves.
 */
export function Findings({
  graph,
  findings,
  nodesById,
  onSelect,
  open,
  onOpenChange,
  usage,
}: {
  graph: SchemaGraph;
  findings: Finding[];
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usage?: UsageReport;
}) {
  const [kinds, setKinds] = useState<FindingKind[]>([]);

  const countOf = (kind: FindingKind) =>
    findings.filter((finding) => finding.kind === kind).length;
  const present = FINDING_KINDS.filter((kind) => countOf(kind) > 0);
  const matched =
    kinds.length === 0
      ? findings
      : findings.filter((finding) => kinds.includes(finding.kind));
  // findFindings already sorts rows inside a kind strongest first, so grouping
  // keeps that.
  const groups = findingGroups(matched);
  const problems = findings.filter(
    (finding) => finding.severity === "problem"
  ).length;
  const toggle = (kind: FindingKind) =>
    setKinds(
      kinds.includes(kind)
        ? kinds.filter((picked) => picked !== kind)
        : [...kinds, kind]
    );

  const pick = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  const exportCsv = () => {
    const blob = new Blob([findingsCsv(matched, graph, usage, kinds)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "schema-city-findings.csv";
    document.body.append(link);
    link.click();
    link.remove();
    // Downloads consume the URL asynchronously, after the click task has ended.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetTrigger
        render={<Button data-trigger size="sm" variant="outline" />}
      >
        Findings
        <Badge variant={problems > 0 ? "signal" : "outline"}>
          {findings.length}
        </Badge>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 font-sans text-[13px] text-prose leading-normal sm:max-w-md">
        <div className="border-line border-b px-4 pt-4 pb-3">
          <SheetTitle className="font-sans font-semibold text-[17px] text-foreground">
            Findings
          </SheetTitle>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-label">
              <span className="font-mono">{findings.length}</span> findings,{" "}
              <span
                className={`font-mono ${problems > 0 ? "text-signal" : ""}`}
              >
                {problems}
              </span>{" "}
              {problems === 1 ? "problem" : "problems"}
              {matched.length === findings.length ? null : (
                <>
                  , <span className="font-mono">{matched.length}</span> shown
                </>
              )}
            </p>
            <Button
              className={READING}
              onClick={exportCsv}
              size="sm"
              variant="outline"
            >
              Export CSV
            </Button>
          </div>
          {usage ? null : (
            <p className="mt-1 text-faint text-xs">
              Usage snapshot unavailable; usage-dependent checks are omitted.
            </p>
          )}
        </div>

        {present.length > 0 ? (
          // Chips like the inspector's: none picked means every kind.
          <fieldset
            aria-label="Filter findings by kind"
            className="flex flex-wrap gap-1 px-4 py-3"
          >
            {present.map((kind) => {
              const on = kinds.includes(kind);
              const problem = findings.some(
                (finding) =>
                  finding.kind === kind && finding.severity === "problem"
              );
              return (
                <button
                  aria-pressed={on}
                  className={`inline-flex items-baseline gap-1 border px-1.5 py-0.5 text-xs ${
                    on
                      ? "border-phosphor bg-accent text-phosphor-bright"
                      : "border-line bg-muted text-prose hover:border-phosphor hover:text-phosphor"
                  }`}
                  key={kind}
                  onClick={() => toggle(kind)}
                  type="button"
                >
                  {FINDING_LABEL[kind]}
                  <span
                    className={`font-mono text-2xs ${problem ? "text-signal" : "text-faint"}`}
                  >
                    {countOf(kind)}
                  </span>
                </button>
              );
            })}
          </fieldset>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 px-4 pb-4">
            {matched.length === 0 ? (
              <p className="text-faint text-xs">
                {findings.length === 0
                  ? "Nothing to report about this schema."
                  : "No finding of those kinds."}
              </p>
            ) : null}
            {groups.map(({ kind, rows }) => (
              <Group
                key={kind}
                kind={kind}
                nodesById={nodesById}
                onSelect={pick}
                open={rows[0]?.severity === "problem" || kinds.includes(kind)}
                rows={rows}
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
