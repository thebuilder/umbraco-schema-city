import { use, useRef, useState } from "react";
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
import {
  DATA_TYPE_HEADING,
  plural,
  useAnnounceChange,
  useHandOff,
} from "./a11y";
import { DataTypeLinks, READING, SpokenCount } from "./InspectorChips";

/**
 * The chips to offer and the rows they leave. A picked kind that has no rows any
 * more, such as No template once usage arrives and the unused rule takes those
 * types, counts as not picked, so its chip can never vanish while pressed and
 * hide every row.
 */
export function filterFindings(findings: Finding[], kinds: FindingKind[]) {
  const countOf = (kind: FindingKind) =>
    findings.filter((finding) => finding.kind === kind).length;
  const present = FINDING_KINDS.filter((kind) => countOf(kind) > 0);
  const active = kinds.filter((kind) => present.includes(kind));
  const matched =
    active.length === 0
      ? findings
      : findings.filter((finding) => active.includes(finding.kind));
  return { countOf, present, active, matched };
}

/**
 * "2026-10-07 08:41" from an ISO timestamp, or null for a missing one or for the
 * epoch a snapshot carries when nothing set its date.
 */
export function snapshotDate(iso: string | undefined): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  if (new Date(iso).getUTCFullYear() < 2000) return null;
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * One finding. The group above it carries the kind and what it means, so the row
 * is the type and what is particular to it. Clicking selects the type, which for a
 * broken block reference is the host: the missing Element Type has no building. A
 * finding about a Data Type alone opens that Data Type's page instead, and the Data
 * Types a type's finding names are links under it.
 */
function Row({
  finding,
  name,
  onSelect,
  onDataType,
}: {
  finding: Finding;
  name: string;
  onSelect: (id: string) => void;
  onDataType: (id: string) => void;
}) {
  const { nodeId, dataTypeIds = [] } = finding;
  return (
    <div className="border-line/40 border-t first:border-t-0">
      <button
        className="group block w-full px-3 py-1.5 text-left hover:bg-accent/50"
        onClick={() =>
          nodeId ? onSelect(nodeId) : onDataType(dataTypeIds[0] ?? "")
        }
        type="button"
      >
        <span className="block truncate text-prose group-hover:text-phosphor">
          {name}
        </span>
        <span className="block text-label text-xs">{finding.summary}</span>
      </button>
      {nodeId && dataTypeIds.length > 0 ? (
        <p className="flex flex-wrap gap-x-2 px-3 pb-1.5 text-faint text-xs">
          Data Types:
          {dataTypeIds.map((id) => (
            <DataTypeLinkTo id={id} key={id} onOpen={onDataType} />
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** A Data Type link that also closes the drawer, which the shared link cannot know about. */
function DataTypeLinkTo({
  id,
  onOpen,
}: {
  id: string;
  onOpen: (id: string) => void;
}) {
  const links = use(DataTypeLinks);
  return (
    <button
      className="max-w-48 truncate text-phosphor hover:text-phosphor-bright hover:underline"
      onClick={() => onOpen(id)}
      type="button"
    >
      {links?.nameOf(id) ?? id}
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
  onDataType,
}: {
  kind: FindingKind;
  open: boolean;
  rows: Finding[];
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
  onDataType: (id: string) => void;
}) {
  const tone = TONE[rows[0]?.severity ?? "note"];
  const links = use(DataTypeLinks);
  const nameOf = (finding: Finding) =>
    finding.nodeId
      ? (nodesById.get(finding.nodeId)?.name ?? "a deleted type")
      : (links?.nameOf(finding.dataTypeIds?.[0] ?? "") ?? "a Data Type");
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
            name={nameOf(finding)}
            onDataType={onDataType}
            onSelect={onSelect}
          />
        ))}
      </div>
    </details>
  );
}

/** The drawer's title, its counts, when the snapshots were taken, and the export. */
function Header({
  findings,
  shown,
  graph,
  usage,
  onExport,
}: {
  findings: Finding[];
  shown: number;
  graph: SchemaGraph;
  usage?: UsageReport;
  onExport: () => void;
}) {
  const problems = problemCount(findings);
  const dates = [
    ["Schema read", snapshotDate(graph.generatedAt)],
    ["usage counted", snapshotDate(usage?.generatedAt)],
  ].filter(([, date]) => date !== null);
  return (
    <div className="border-line border-b px-4 pt-4 pb-3">
      <SheetTitle className="font-sans font-semibold text-[17px] text-foreground">
        Findings
      </SheetTitle>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-label">
          {plural(findings.length, "finding")},{" "}
          <span className={problems > 0 ? "text-signal" : ""}>
            {plural(problems, "problem")}
          </span>
          {shown === findings.length ? null : `, ${shown} shown`}
        </p>
        <Button
          className={READING}
          onClick={onExport}
          size="sm"
          variant="outline"
        >
          Export CSV
        </Button>
      </div>
      <p className="mt-1 text-faint text-xs empty:hidden">
        {dates.map(([what, date]) => `${what} ${date}`).join(", ")}
      </p>
      {usage ? null : (
        <p className="mt-1 text-faint text-xs">
          Usage snapshot unavailable; usage-dependent checks are omitted.
        </p>
      )}
    </div>
  );
}

/** One chip per kind that has rows. None pressed means every kind. */
function KindChips({
  findings,
  active,
  onToggle,
}: {
  findings: Finding[];
  active: FindingKind[];
  onToggle: (kind: FindingKind) => void;
}) {
  const { countOf, present } = filterFindings(findings, active);
  if (present.length === 0) return null;
  return (
    <fieldset
      aria-label="Filter findings by kind"
      className="flex flex-wrap gap-1 px-4 py-3"
    >
      {present.map((kind) => {
        const on = active.includes(kind);
        const problem = findings.some(
          (finding) => finding.kind === kind && finding.severity === "problem"
        );
        return (
          <button
            aria-pressed={on}
            className="inline-flex items-baseline gap-1 border border-line bg-muted px-1.5 py-0.5 text-prose text-xs hover:border-phosphor hover:text-phosphor aria-pressed:border-phosphor aria-pressed:bg-accent aria-pressed:text-phosphor-bright"
            key={kind}
            onClick={() => onToggle(kind)}
            type="button"
          >
            {FINDING_LABEL[kind]}
            <SpokenCount
              count={countOf(kind)}
              problem={problem}
              spoken={plural(countOf(kind), problem ? "problem" : "note")}
              tone={on ? "text-prose" : undefined}
            />
          </button>
        );
      })}
    </fieldset>
  );
}

const problemCount = (findings: Finding[]) =>
  findings.filter((finding) => finding.severity === "problem").length;

/** Saves the rows as a CSV file, with the snapshot dates and each kind's meaning. */
function downloadCsv(
  rows: Finding[],
  graph: SchemaGraph,
  usage: UsageReport | undefined,
  kinds: FindingKind[]
) {
  const blob = new Blob([findingsCsv(rows, graph, usage, kinds)], {
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
  const { active, matched } = filterFindings(findings, kinds);
  // findFindings already sorts rows inside a kind strongest first, so grouping
  // keeps that.
  const groups = findingGroups(matched);
  const problems = problemCount(findings);
  const toggle = (kind: FindingKind) =>
    setKinds(
      active.includes(kind)
        ? active.filter((other) => other !== kind)
        : [...active, kind]
    );
  useAnnounceChange(
    active.length > 0
      ? `${matched.length} of ${plural(findings.length, "finding")} shown`
      : "All findings shown"
  );

  const trigger = useRef<HTMLButtonElement>(null);
  // A chosen row opens the inspector, so focus goes to its heading.
  const handOff = useHandOff(trigger);
  const pick = (id: string) => {
    handOff.chose();
    onSelect(id);
    onOpenChange(false);
  };
  // A Data Type opens its page, so focus goes to that page's heading.
  const links = use(DataTypeLinks);
  const pickDataType = (id: string) => {
    handOff.chose(DATA_TYPE_HEADING);
    links?.open(id);
    onOpenChange(false);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetTrigger
        ref={trigger}
        render={<Button data-trigger size="sm" variant="outline" />}
      >
        Findings
        <Badge variant={problems > 0 ? "signal" : "outline"}>
          <span aria-hidden>{findings.length}</span>
          <span className="sr-only">
            {plural(findings.length, "finding")}, {plural(problems, "problem")}
          </span>
        </Badge>
      </SheetTrigger>
      <SheetContent
        className="w-full gap-0 p-0 font-sans text-[13px] text-prose leading-normal sm:max-w-md"
        finalFocus={handOff.finalFocus}
      >
        <Header
          findings={findings}
          graph={graph}
          onExport={() => downloadCsv(matched, graph, usage, active)}
          shown={matched.length}
          usage={usage}
        />
        <KindChips active={active} findings={findings} onToggle={toggle} />

        <ScrollArea
          className="min-h-0 flex-1"
          viewport={{ "aria-label": "Findings list" }}
        >
          <div className="space-y-2 px-4 pb-4">
            <p className="text-faint text-xs empty:hidden">
              {emptyLine(findings.length, matched.length)}
            </p>
            {groups.map(({ kind, rows }) => (
              <Group
                key={kind}
                kind={kind}
                nodesById={nodesById}
                onDataType={pickDataType}
                onSelect={pick}
                open={rows[0]?.severity === "problem" || active.includes(kind)}
                rows={rows}
              />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/** Why the list is empty, or nothing when it is not. */
function emptyLine(total: number, shown: number) {
  if (shown > 0) return "";
  return total === 0
    ? "Nothing to report about this schema."
    : "No finding of those kinds.";
}
