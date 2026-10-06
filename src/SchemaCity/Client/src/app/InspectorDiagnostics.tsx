import {
  FINDING_LABEL,
  type Finding,
  KIND_EXPLANATION,
} from "../model/findings";
import type { SchemaEdge, SchemaNode } from "../model/types";
import { FindingRelations } from "./FindingRelations";
import {
  connectionKey,
  describeRelationship,
  uniqueConnections,
} from "./relationship";

type Lookup = Map<string, SchemaNode>;

/** The findings about this type, problems first as findFindings sorts them. */
export function InspectorChecks({
  findings,
  nodesById,
  onSelect,
}: {
  findings: Finding[];
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  if (findings.length === 0)
    return <p className="text-faint text-xs">No checks flagged this type.</p>;
  return (
    <ul className="space-y-2">
      {findings.map((finding) => {
        const problem = finding.severity === "problem";
        return (
          <li
            className={`border-l-2 bg-muted px-3 py-2.5 ${problem ? "border-signal" : "border-label"}`}
            key={finding.id}
          >
            <p
              className={`font-semibold text-2xs uppercase tracking-terminal-xs ${problem ? "text-signal" : "text-label"}`}
            >
              {problem ? "Problem" : "Note"} · {FINDING_LABEL[finding.kind]}
            </p>
            <p className="mt-0.5 text-prose">{finding.summary}</p>
            <p className="mt-1.5 text-faint text-xs">
              {KIND_EXPLANATION[finding.kind]}
            </p>
            <FindingRelations
              finding={finding}
              nodesById={nodesById}
              onSelect={onSelect}
            />
          </li>
        );
      })}
    </ul>
  );
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
  return (
    <details className="py-3.5">
      <summary className="cursor-pointer text-phosphor text-xs hover:text-phosphor-bright">
        Explain {connections.length}{" "}
        {connections.length === 1 ? "connection" : "connections"}
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
