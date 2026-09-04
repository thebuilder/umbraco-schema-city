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
  type FindingSeverity,
} from "../model/findings";
import type { SchemaNode } from "../model/types";

const SEVERITY_TITLE: Record<FindingSeverity, string> = {
  problem: "Problems",
  note: "Notes",
};

/**
 * One finding. Clicking it selects the type it is about, which for a broken block
 * reference is the host type: the missing Element Type has no building to select.
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
      className="w-full border border-line border-b-0 bg-panel-sunken px-2 py-1.5 text-left last:border-b hover:border-line-strong hover:bg-accent/60"
      onClick={() => onSelect(finding.nodeId)}
      type="button"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-phosphor text-xs">
          {name}
        </span>
        <span className="shrink-0 text-3xs text-phosphor-dim uppercase tracking-terminal">
          {FINDING_LABEL[finding.kind]}
        </span>
      </span>
      <span className="block text-muted-foreground text-3xs">
        {finding.summary}
      </span>
    </button>
  );
}

/**
 * The findings drawer, and the toolbar button that opens it. The filter is a set of
 * kinds, and an empty set means every kind, which is the ordinary way a row of
 * filter chips behaves.
 */
export function Findings({
  findings,
  nodesById,
  onSelect,
}: {
  findings: Finding[];
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<FindingKind[]>([]);

  const countOf = (kind: FindingKind) =>
    findings.filter((finding) => finding.kind === kind).length;
  const present = FINDING_KINDS.filter((kind) => countOf(kind) > 0);
  const matched =
    kinds.length === 0
      ? findings
      : findings.filter((finding) => kinds.includes(finding.kind));
  const problems = findings.filter(
    (finding) => finding.severity === "problem"
  ).length;

  const pick = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <Sheet onOpenChange={setOpen} open={open}>
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
          <p className="mt-1 text-muted-foreground text-xs">
            {matched.length} matched / {findings.length} total
          </p>
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
            {(["problem", "note"] as const).map((severity) => {
              const rows = matched.filter(
                (finding) => finding.severity === severity
              );
              if (rows.length === 0) return null;
              return (
                <section key={severity}>
                  <h3 className="mb-1 font-bold text-3xs text-phosphor-dim uppercase tracking-terminal-xl">
                    {SEVERITY_TITLE[severity]} ({rows.length})
                  </h3>
                  {rows.map((finding) => (
                    <Row
                      finding={finding}
                      key={finding.id}
                      name={
                        nodesById.get(finding.nodeId)?.name ?? "a deleted type"
                      }
                      onSelect={pick}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
