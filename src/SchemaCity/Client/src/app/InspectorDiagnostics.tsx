import { use, useId, useState } from "react";
import {
  FINDING_LABEL,
  type Finding,
  KIND_EXPLANATION,
  KIND_NEXT_STEP,
} from "../model/findings";
import { checkCounts, isReviewed, splitReviewed } from "../model/review";
import type { SchemaEdge, SchemaNode } from "../model/types";
import { plural } from "./a11y";
import { FindingRelations } from "./FindingRelations";
import { DataTypeLinks } from "./InspectorChips";
import { ReviewControl, Reviews, subjectName } from "./Review";
import {
  connectionKey,
  describeRelationship,
  uniqueConnections,
} from "./relationship";

type Lookup = Map<string, SchemaNode>;

/**
 * The findings about this type, problems first as findFindings sorts them. On a
 * Data Type's page the findings are about several types, so `subjects` names the
 * type each one is on, as a link. Each check carries its review status and action,
 * the same as its row in the findings drawer. Reviewed checks follow the open ones,
 * still there to read and undo, but after what needs attention.
 */
export function InspectorChecks({
  findings,
  nodesById,
  onSelect,
  subjects = false,
  empty = "No checks flagged this type.",
}: {
  findings: Finding[];
  nodesById: Lookup;
  onSelect: (id: string) => void;
  subjects?: boolean;
  empty?: string;
}) {
  const { open, reviewed } = splitReviewed(findings, use(Reviews)?.reviewOf);
  if (findings.length === 0)
    return <p className="text-faint text-xs">{empty}</p>;
  return (
    <ul className="space-y-2">
      {[...open, ...reviewed].map((finding) => (
        <Check
          finding={finding}
          key={finding.id}
          nodesById={nodesById}
          onSelect={onSelect}
          subjects={subjects}
        />
      ))}
    </ul>
  );
}

/**
 * One check: its kind as a title, its summary, what it means and what to do
 * behind Why?, and its review. Only the links that go somewhere are green, so the
 * card has one colour of action.
 */
function Check({
  finding,
  nodesById,
  onSelect,
  subjects,
}: {
  finding: Finding;
  nodesById: Lookup;
  onSelect: (id: string) => void;
  subjects: boolean;
}) {
  const reviewed = isReviewed(use(Reviews)?.reviewOf(finding));
  const subject = subjectName(finding, nodesById, use(DataTypeLinks));
  const problem = finding.severity === "problem";
  const [why, setWhy] = useState(false);
  const whyId = useId();
  return (
    <li
      className={`border-l-2 bg-muted px-3 py-2.5 ${ruleOf(reviewed, problem)}`}
    >
      <CheckTitle
        label={FINDING_LABEL[finding.kind]}
        onWhy={() => setWhy(!why)}
        problem={problem}
        reviewed={reviewed}
        why={why}
        whyId={whyId}
      />
      {subjects && finding.nodeId ? (
        <p className="mt-0.5 text-label text-xs">
          On{" "}
          <button
            className="text-phosphor hover:text-phosphor-bright hover:underline"
            onClick={() => onSelect(finding.nodeId ?? "")}
            type="button"
          >
            {subject}
          </button>
        </p>
      ) : null}
      <p className="mt-0.5 text-label text-xs">{finding.summary}</p>
      {why ? (
        <div className="mt-1.5 space-y-1 text-faint text-xs" id={whyId}>
          <p>{KIND_EXPLANATION[finding.kind]}</p>
          <p>What to do: {KIND_NEXT_STEP[finding.kind]}</p>
        </div>
      ) : null}
      <FindingRelations
        finding={finding}
        nodesById={nodesById}
        onSelect={onSelect}
        quiet={reviewed}
      />
      <ReviewControl finding={finding} subject={subject} />
    </li>
  );
}

/**
 * The left rule carries the severity: pink for a problem, grey for a note, and a
 * fainter grey once reviewed, so the open problems are what the eye lands on.
 */
function ruleOf(reviewed: boolean, problem: boolean): string {
  if (reviewed) return "border-line";
  return problem ? "border-signal" : "border-label";
}

/** The kind as a plain title, with the Why? toggle at its end. */
function CheckTitle({
  label,
  problem,
  reviewed,
  why,
  whyId,
  onWhy,
}: {
  label: string;
  problem: boolean;
  reviewed: boolean;
  why: boolean;
  whyId: string;
  onWhy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <p
        className={`min-w-0 flex-1 font-medium text-sm ${reviewed ? "text-label" : "text-prose"}`}
      >
        <span className="sr-only">{problem ? "Problem" : "Note"}: </span>
        {label}
        {reviewed ? (
          <span className="font-normal text-faint"> · Reviewed</span>
        ) : null}
      </p>
      {/* What the kind means and what to do wait behind Why?, so the card shows
          only what is particular to this type until asked. */}
      <button
        aria-controls={whyId}
        aria-expanded={why}
        className="shrink-0 text-faint text-xs hover:text-prose"
        onClick={onWhy}
        type="button"
      >
        {why ? "Hide" : "Why?"}
      </button>
    </div>
  );
}

/**
 * For a heading above InspectorChecks: how many checks are open, and apart from
 * that count, how many are reviewed.
 */
export function useCheckNote(findings: Finding[]) {
  const { open, reviewed } = checkCounts(findings, use(Reviews)?.reviewOf);
  return { open, note: reviewed > 0 ? `${reviewed} reviewed` : undefined };
}

/** Every direct connection in a sentence, the way a clicked link in the city reads. */
export function ExplainConnections({
  edges,
  nodeId,
  nodesById,
  onSelect,
}: {
  edges: SchemaEdge[];
  nodeId: string;
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  const connections = uniqueConnections(
    edges.filter((edge) => edge.from === nodeId || edge.to === nodeId)
  );
  if (connections.length === 0) return null;
  const types = new Set(
    connections.map((edge) => (edge.from === nodeId ? edge.to : edge.from))
  ).size;
  return (
    <details className="py-3.5">
      <summary className="cursor-pointer text-phosphor text-xs hover:text-phosphor-bright">
        {/* Types and links both, so the number matches the tab's count of types: a
            type reached through two properties, or as both block content and
            settings, is one chip above and two links here. */}
        Explain connections ({plural(types, "type")},{" "}
        {plural(connections.length, "link")})
      </summary>
      <ul className="mt-2 space-y-2">
        {connections.map((edge) => {
          const description = describeRelationship(edge, nodesById, nodeId);
          const related = edge.from === nodeId ? edge.to : edge.from;
          return (
            <li
              className="border-line border-l pl-2.5"
              key={connectionKey(edge)}
            >
              <p className="text-2xs text-faint">
                {description.direction} · {description.label}
              </p>
              <button
                className="block max-w-full truncate text-left text-prose text-xs hover:text-phosphor hover:underline"
                onClick={() => onSelect(related)}
                type="button"
              >
                {nodesById.get(related)?.name ?? "deleted type"}
              </button>
              <p className="text-label text-xs">{description.detail}</p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
