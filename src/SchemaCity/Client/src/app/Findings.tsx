import { ChevronRightIcon } from "lucide-react";
import { use, useId, useRef, useState } from "react";
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
import { isReviewed } from "../model/review";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import {
  DATA_TYPE_HEADING,
  plural,
  useAnnounce,
  useAnnounceChange,
  useHandOff,
} from "./a11y";
import { DataTypeLinks, READING, SpokenCount } from "./InspectorChips";
import { ReviewControl, Reviews, subjectName } from "./Review";
import { saveFile } from "./save-file";

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

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * "2026-10-07 08:41" in the reader's own time zone, so the minute reads as the clock
 * on their wall, or null for a missing timestamp or the epoch a snapshot carries when
 * nothing set its date. The footer and the Findings drawer both say it this way.
 */
export function snapshotDate(iso: string | undefined): string | null {
  const at = new Date(iso ?? "");
  if (!(at.getUTCFullYear() >= 2000)) return null;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** "Schema read 2026-10-20 17:43, usage counted 2026-10-21 19:27", or less. */
export function snapshotTimes(graph: SchemaGraph, usage?: UsageReport) {
  return [
    ["Schema read", snapshotDate(graph.generatedAt)],
    ["usage counted", snapshotDate(usage?.generatedAt)],
  ]
    .filter(([, date]) => date !== null)
    .map(([what, date]) => `${what} ${date}`)
    .join(", ");
}

/**
 * One finding. The group above it carries the kind and what it means, so the row
 * is the type and what is particular to it. Clicking selects the type, which for a
 * broken block reference is the host: the missing Element Type has no building. The
 * name is green and a chevron ends the row, the way every other link that goes
 * somewhere reads, since a plain name read as text nobody thought to click. A
 * finding about a Data Type alone opens that Data Type's page instead, and the Data
 * Types a type's finding names are links under it. Its review status and action
 * sit at the bottom.
 */
function Row({
  finding,
  name,
  onSelect,
  onDataType,
  onReviewed,
}: {
  finding: Finding;
  name: string;
  onSelect: (id: string) => void;
  onDataType: (id: string) => void;
  onReviewed: (id: string) => void;
}) {
  const { nodeId, dataTypeIds = [] } = finding;
  return (
    <div className="border-line/40 border-t first:border-t-0">
      <button
        className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
        onClick={() =>
          nodeId ? onSelect(nodeId) : onDataType(dataTypeIds[0] ?? "")
        }
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-phosphor group-hover:text-phosphor-bright group-hover:underline">
            {name}
          </span>
          <span className="block text-label text-xs">{finding.summary}</span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-faint group-hover:text-phosphor"
        />
      </button>
      {nodeId && dataTypeIds.length > 0 ? (
        <p className="flex flex-wrap gap-x-2 px-3 pb-1.5 text-faint text-xs">
          Data Types:
          {dataTypeIds.map((id) => (
            <DataTypeLinkTo id={id} key={id} onOpen={onDataType} />
          ))}
        </p>
      ) : null}
      <div className="px-3 pb-2 empty:hidden">
        <ReviewControl
          finding={finding}
          onChange={() => onReviewed(finding.id)}
          subject={name}
        />
      </div>
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
 * The findings of one kind under a header. Problems start open and notes closed;
 * picking a note's chip opens it, since that is a request to read it. What the kind
 * means and what to do wait behind Why?, as on the inspector's check cards, so an
 * open group leads with its types rather than a paragraph above them.
 */
function Group({
  kind,
  open,
  rows,
  nodesById,
  onSelect,
  onDataType,
  onReviewed,
}: {
  kind: FindingKind;
  open: boolean;
  rows: Finding[];
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
  onDataType: (id: string) => void;
  onReviewed: (id: string) => void;
}) {
  const tone = TONE[rows[0]?.severity ?? "note"];
  const links = use(DataTypeLinks);
  const nameOf = (finding: Finding) => subjectName(finding, nodesById, links);
  const [expanded, setExpanded] = useOpenWhenAsked(open);
  const [why, setWhy] = useState(false);
  const rowsId = useId();
  const whyId = useId();
  return (
    <section className={`border-l-2 bg-muted ${tone.border}`}>
      <div className="flex items-baseline gap-2 px-3 py-2.5">
        <button
          aria-controls={rowsId}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {/* Notes start closed, so the header has to say it opens. */}
          <ChevronRightIcon
            aria-hidden
            className={`size-3.5 shrink-0 self-center text-faint transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
          />
          <span className={`font-semibold ${tone.text}`}>
            {FINDING_LABEL[kind]}
          </span>
          <span className="font-mono text-2xs text-faint">{rows.length}</span>
          <span className={`ml-auto text-xs ${tone.text}`}>{tone.word}</span>
        </button>
        <button
          aria-controls={whyId}
          aria-expanded={why}
          className="shrink-0 text-faint text-xs hover:text-prose"
          onClick={() => setWhy(!why)}
          type="button"
        >
          {why ? "Hide" : "Why?"}
        </button>
      </div>
      {why ? <KindWhy id={whyId} kind={kind} /> : null}
      {expanded ? (
        <div className="border-line/40 border-t bg-panel" id={rowsId}>
          {rows.map((finding) => (
            <Row
              finding={finding}
              key={finding.id}
              name={nameOf(finding)}
              onDataType={onDataType}
              onReviewed={onReviewed}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A group's open state, which also opens when `open` turns true later, as the open
 * attribute did on a details element: picking a chip is a request to read the
 * group. Unpicking it leaves the group as the reader left it.
 */
function useOpenWhenAsked(open: boolean) {
  const [expanded, setExpanded] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setExpanded(true);
  }
  return [expanded, setExpanded] as const;
}

/** What a kind means and what to do about it, behind the group's Why?. */
function KindWhy({ id, kind }: { id: string; kind: FindingKind }) {
  return (
    <div className="space-y-2 px-3 pb-2.5 text-label text-xs" id={id}>
      <p>{KIND_EXPLANATION[kind]}</p>
      <p>
        <span className="block font-medium text-prose">Next step</span>
        {KIND_NEXT_STEP[kind]}
      </p>
    </div>
  );
}

/**
 * What follows the problem count: " and 10 notes to review." after problems, " 12
 * notes to review." after "No problems.", and the end of the sentence otherwise.
 * Problems lead, because "12 findings, 0 reviewed, 12 open, 0 open problems" made the
 * reader add up four numbers to learn nothing needed fixing.
 */
function notesLine(problems: number, notes: number) {
  if (problems > 0)
    return notes > 0 ? ` and ${plural(notes, "note")} to review.` : " to fix.";
  return notes > 0 ? ` ${plural(notes, "note")} to review.` : " Nothing open.";
}

/**
 * The drawer's title, its counts, when the snapshots were taken, and the export.
 * Reviewed findings are decided and current; the rest, reopened ones included, are
 * open, and the problem count is of the open ones.
 */
function Header({
  findings,
  open,
  shown,
  graph,
  usage,
  failed,
  onExport,
}: {
  findings: Finding[];
  open: Finding[];
  shown: number;
  graph: SchemaGraph;
  usage?: UsageReport;
  failed?: string | null;
  onExport: () => void;
}) {
  const problems = problemCount(open);
  const reviewed = findings.length - open.length;
  return (
    <div className="border-line border-b px-4 pt-4 pb-3">
      <SheetTitle className="font-sans font-semibold text-[17px] text-foreground">
        Findings
      </SheetTitle>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-label">
          {problems > 0 ? (
            <span className="text-signal">{plural(problems, "problem")}</span>
          ) : (
            "No problems."
          )}
          {notesLine(problems, open.length - problems)}
          {reviewed > 0 ? ` ${reviewed.toLocaleString()} reviewed.` : null}
          {shown === findings.length || shown === open.length
            ? null
            : ` ${shown.toLocaleString()} shown.`}
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
        {snapshotTimes(graph, usage)}
      </p>
      {usage ? null : (
        <p className="mt-1 text-faint text-xs">
          Usage snapshot unavailable; usage-dependent checks are omitted.
        </p>
      )}
      {failed ? (
        <p className="mt-1 text-signal text-xs">
          Review decisions did not load. {failed}
        </p>
      ) : null}
    </div>
  );
}

/** A filter chip, which reads as pressed while its filter is on. */
const CHIP =
  "inline-flex items-baseline gap-1 border border-line bg-muted px-1.5 py-0.5 text-prose text-xs hover:border-phosphor hover:text-phosphor aria-pressed:border-phosphor aria-pressed:bg-accent aria-pressed:text-phosphor-bright";

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
            className={CHIP}
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
  kinds: FindingKind[],
  review: Parameters<typeof findingsCsv>[4]
) {
  saveFile(
    findingsCsv(rows, graph, usage, kinds, review),
    "schema-city-findings.csv",
    "text/csv;charset=utf-8"
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
  open: isOpen,
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
  const reviewing = use(Reviews);
  const [hideReviewed, setHideReviewed] = useState(true);
  // Rows reviewed while the drawer is open stay in view until it closes, so the
  // row a keyboard user just saved does not vanish from under them.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const reviewed = (finding: Finding) =>
    isReviewed(reviewing?.reviewOf(finding));
  const open = findings.filter((finding) => !reviewed(finding));
  const listed = hideReviewed
    ? findings.filter((finding) => !reviewed(finding) || kept.has(finding.id))
    : findings;
  const { active, matched } = filterFindings(listed, kinds);
  // findFindings already sorts rows inside a kind strongest first, so grouping
  // keeps that.
  const groups = findingGroups(matched);
  const problems = problemCount(open);
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
  const announce = useAnnounce();
  const toggleReviewed = () => {
    const hide = !hideReviewed;
    setHideReviewed(hide);
    announce(hide ? "Reviewed findings hidden" : "Reviewed findings shown");
  };
  const setOpen = (next: boolean) => {
    setKept(new Set());
    onOpenChange(next);
  };

  const trigger = useRef<HTMLButtonElement>(null);
  // A chosen row opens the inspector, so focus goes to its heading.
  const handOff = useHandOff(trigger);
  const pick = (id: string) => {
    handOff.chose();
    onSelect(id);
    setOpen(false);
  };
  // A Data Type opens its page, so focus goes to that page's heading.
  const links = use(DataTypeLinks);
  const pickDataType = (id: string) => {
    handOff.chose(DATA_TYPE_HEADING);
    links?.open(id);
    setOpen(false);
  };

  return (
    <Sheet onOpenChange={setOpen} open={isOpen}>
      <SheetTrigger
        ref={trigger}
        render={<Button data-trigger size="sm" variant="outline" />}
      >
        Findings
        {/* The badge counts open problems, the findings that need a fix. Notes
            only show in it, quietly, once no problem is left. */}
        <Badge variant={problems > 0 ? "signal" : "outline"}>
          <span aria-hidden>{problems > 0 ? problems : open.length}</span>
          <span className="sr-only">
            {plural(open.length, "open finding")},{" "}
            {plural(problems, "open problem")}
          </span>
        </Badge>
      </SheetTrigger>
      <SheetContent
        className="w-full gap-0 p-0 font-sans text-[13px] text-prose leading-normal sm:max-w-md"
        finalFocus={handOff.finalFocus}
      >
        <Header
          failed={reviewing?.failed}
          findings={findings}
          graph={graph}
          onExport={() =>
            downloadCsv(
              matched,
              graph,
              usage,
              active,
              reviewing
                ? { of: reviewing.reviewOf, hidden: hideReviewed }
                : undefined
            )
          }
          open={open}
          shown={matched.length}
          usage={usage}
        />
        {reviewing ? (
          <div className="px-4 pt-3">
            <button
              aria-pressed={hideReviewed}
              className={CHIP}
              onClick={toggleReviewed}
              type="button"
            >
              Hide reviewed
              <span className="font-mono text-2xs text-faint">
                {findings.length - open.length}
              </span>
            </button>
          </div>
        ) : null}
        <KindChips active={active} findings={listed} onToggle={toggle} />

        <ScrollArea
          className="min-h-0 flex-1"
          viewport={{ "aria-label": "Findings list" }}
        >
          <div className="space-y-2 px-4 pb-4">
            <p className="text-faint text-xs empty:hidden">
              {emptyLine(findings.length, listed.length, matched.length)}
            </p>
            {groups.map(({ kind, rows }) => (
              <Group
                key={kind}
                kind={kind}
                nodesById={nodesById}
                onDataType={pickDataType}
                onReviewed={(id) => setKept((ids) => new Set(ids).add(id))}
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
function emptyLine(total: number, listed: number, shown: number) {
  if (shown > 0) return "";
  if (total === 0) return "Nothing to report about this schema.";
  return listed === 0
    ? "Every finding is reviewed. Turn off Hide reviewed to see them."
    : "No finding of those kinds.";
}
