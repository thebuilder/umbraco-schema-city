import { use } from "react";
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

/** One check: its kind, what it means, what to do, and its review. */
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
  // A reviewed check drops its pink and its bright summary for the quiet grey its
  // dot in the List takes, so the open checks are what the eye lands on.
  let tone = { border: "border-label", text: "text-label" };
  if (reviewed) tone = { border: "border-line", text: "text-label" };
  else if (problem) tone = { border: "border-signal", text: "text-signal" };
  return (
    <li className={`border-l-2 bg-muted px-3 py-2.5 ${tone.border}`}>
      <p
        className={`font-semibold text-2xs uppercase tracking-terminal-xs ${tone.text}`}
      >
        {problem ? "Problem" : "Note"} · {FINDING_LABEL[finding.kind]}
        {reviewed ? " · Reviewed" : ""}
      </p>
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
      <p className={`mt-0.5 ${reviewed ? "text-label" : "text-prose"}`}>
        {finding.summary}
      </p>
      <p className="mt-1.5 text-faint text-xs">
        {KIND_EXPLANATION[finding.kind]}
      </p>
      <p className="mt-1 text-faint text-xs">
        What to do: {KIND_NEXT_STEP[finding.kind]}
      </p>
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
