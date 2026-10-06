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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  FINDING_KINDS,
  FINDING_LABEL,
  type Finding,
  type FindingKind,
  findingGroups,
  KIND_EXPLANATION,
} from "../model/findings";
import { findingsCsv } from "../model/findings-export";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";

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
      className="block w-full border-line border-b bg-panel-sunken px-2 py-1.5 text-left hover:border-line-strong hover:bg-accent/60"
      onClick={() => onSelect(finding.nodeId)}
      type="button"
    >
      <span className="block truncate text-phosphor text-xs">{name}</span>
      <span className="block text-muted-foreground text-3xs">
        {finding.summary}
      </span>
    </button>
  );
}

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
  const severity = rows[0]?.severity;
  return (
    <details open={open}>
      <summary className="flex cursor-pointer items-baseline gap-2 py-1">
        <span className="font-bold text-3xs text-phosphor uppercase tracking-terminal-xl">
          {FINDING_LABEL[kind]}
        </span>
        <span className="text-3xs text-phosphor-dim">{rows.length}</span>
        <span
          className={`ml-auto text-3xs uppercase tracking-terminal ${severity === "problem" ? "text-signal" : "text-phosphor-dim"}`}
        >
          {severity}
        </span>
      </summary>
      <p className="mb-1 text-3xs text-muted-foreground">
        {KIND_EXPLANATION[kind]}
      </p>
      {rows.map((finding) => (
        <Row
          finding={finding}
          key={finding.id}
          name={nodesById.get(finding.nodeId)?.name ?? "a deleted type"}
          onSelect={onSelect}
        />
      ))}
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

  const pick = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  const exportCsv = () => {
    const blob = new Blob([findingsCsv(matched, graph, usage)], {
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
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <div className="border-line border-b px-4 py-3">
          <SheetTitle className="text-sm uppercase tracking-terminal-lg">
            Findings
          </SheetTitle>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {matched.length} matched / {findings.length} total
            </p>
            <Button onClick={exportCsv} size="sm" variant="outline">
              Export CSV
            </Button>
          </div>
          {usage ? null : (
            <p className="mt-1 text-3xs text-amber">
              Usage snapshot unavailable; usage-dependent checks are omitted.
            </p>
          )}
        </div>

        {present.length > 0 ? (
          <ToggleGroup
            aria-label="Filter findings by kind"
            // The group primitive paints bg-line under a 1px padding, so the gaps
            // between chips read as hairlines. That only works while the chips cover
            // the box: these wrap, and the short last line left the bare bg-line
            // showing as a lit rectangle. Transparent here, so the chips are the only
            // thing with a background and the gaps show the panel behind them.
            className="m-3 flex-wrap bg-transparent"
            multiple
            onValueChange={(value) => setKinds(value as FindingKind[])}
            size="sm"
            value={kinds}
          >
            {present.map((kind) => (
              <ToggleGroupItem key={kind} value={kind}>
                {FINDING_LABEL[kind]} {countOf(kind)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-3 pb-4">
            {matched.length === 0 ? (
              <p className="text-muted-foreground text-xs">
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
