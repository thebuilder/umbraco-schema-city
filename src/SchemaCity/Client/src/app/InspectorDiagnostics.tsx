import { Fragment, type ReactNode } from "react";
import { FINDING_LABEL, type Finding } from "../model/findings";
import type { Neighbourhood } from "../model/neighbourhood";
import type { SchemaEdge, SchemaNode, UsageReport } from "../model/types";
import { FindingRelations } from "./FindingRelations";
import {
  connectionKey,
  describeRelationship,
  uniqueConnections,
} from "./relationship";

type Lookup = Map<string, SchemaNode>;

function connectionsFor(edges: SchemaEdge[] | undefined, nodeId: string) {
  if (!edges) return [];
  return uniqueConnections(
    edges.filter((edge) => edge.from === nodeId || edge.to === nodeId)
  );
}

function ConnectionList({
  connections,
  nodeId,
  nodesById,
  onSelect,
}: {
  connections: SchemaEdge[];
  nodeId: string;
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {connections.map((edge) => {
        const description = describeRelationship(edge, nodesById, nodeId);
        const related = edge.from === nodeId ? edge.to : edge.from;
        return (
          <li className="border-line border-l pl-2" key={connectionKey(edge)}>
            <p className="text-3xs text-phosphor-dim">
              {description.direction} · {description.label}
            </p>
            <button
              className="block max-w-full truncate text-left text-phosphor text-xs hover:underline"
              onClick={() => onSelect(related)}
              type="button"
            >
              {nodesById.get(related)?.name ?? "deleted type"}
            </button>
            <p className="text-3xs text-phosphor-dim">{description.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h2 className="mb-1 font-bold text-3xs text-phosphor-dim uppercase tracking-terminal-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function InspectorDiagnostics({
  findings,
  neighbourhood,
  nodeId,
  nodesById,
  onSelect,
  usage,
  edges,
}: {
  findings: Finding[];
  neighbourhood: Neighbourhood;
  nodeId: string;
  nodesById: Lookup;
  onSelect: (id: string) => void;
  usage?: UsageReport;
  edges?: SchemaEdge[];
}) {
  const incoming = usage?.references
    .filter((reference) => reference.toType === nodeId)
    .reduce((total, reference) => total + reference.count, 0);
  const outgoing = usage?.references
    .filter((reference) => reference.fromType === nodeId)
    .reduce((total, reference) => total + reference.count, 0);
  const rows: [string, string][] = [
    ["Allowed parents", String(neighbourhood.allowedParents.length)],
    ["Allowed children", String(neighbourhood.allowedChildren.length)],
    ["Compositions", String(neighbourhood.compositions.length)],
    [
      "Block targets",
      String(
        new Set(neighbourhood.blockTargets.flatMap((group) => group.ids)).size
      ),
    ],
    ["Composed by", String(neighbourhood.composedBy.length)],
    ["Inherited by", String(neighbourhood.inheritedBy.length)],
    [
      "Observed incoming references",
      incoming?.toLocaleString() ?? "unavailable",
    ],
    [
      "Observed outgoing references",
      outgoing?.toLocaleString() ?? "unavailable",
    ],
  ];
  const connections = connectionsFor(edges, nodeId);
  return (
    <>
      <Section title="Direct schema connections">
        <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-3xs text-phosphor-dim">{label}</dt>
              <dd className="text-right text-phosphor text-xs">{value}</dd>
            </Fragment>
          ))}
        </dl>
        <p className="mt-1 text-3xs text-phosphor-dim">
          Connections describe direct schema relationships. Observed references
          are aggregated content relations from the usage snapshot.
        </p>
        <details className="mt-2 border-line border-t pt-2">
          <summary className="mb-1 font-bold text-3xs text-phosphor-dim uppercase tracking-terminal-xl">
            Explain {connections.length} connections
          </summary>
          <ConnectionList
            connections={connections}
            nodeId={nodeId}
            nodesById={nodesById}
            onSelect={onSelect}
          />
        </details>
      </Section>
      {findings.length > 0 ? (
        <Section title="Schema checks">
          <ul className="space-y-1">
            {findings.map((finding) => (
              <li className="border-line border-l-2 pl-2" key={finding.id}>
                <p className="text-phosphor text-xs">
                  <span className="text-phosphor-dim uppercase tracking-terminal">
                    {finding.severity} · {FINDING_LABEL[finding.kind]}
                  </span>{" "}
                  {finding.summary}
                </p>
                <FindingRelations
                  finding={finding}
                  nodesById={nodesById}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
