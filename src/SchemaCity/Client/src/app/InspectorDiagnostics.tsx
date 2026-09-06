import { Fragment, type ReactNode } from "react";
import { FINDING_LABEL, type Finding } from "../model/findings";
import type { Neighbourhood } from "../model/neighbourhood";
import type { SchemaNode, UsageReport } from "../model/types";
import { FindingRelations } from "./FindingRelations";

type Lookup = Map<string, SchemaNode>;

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

function Links({
  label,
  ids,
  nodesById,
  onSelect,
}: {
  label: string;
  ids: string[];
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <p className="mt-1 text-3xs text-phosphor-dim">
      {label}{" "}
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 ? ", " : null}
          <button
            className="text-phosphor hover:text-phosphor-bright hover:underline"
            onClick={() => onSelect(id)}
            type="button"
          >
            {nodesById.get(id)?.name ?? "deleted type"}
          </button>
        </span>
      ))}
    </p>
  );
}

export function InspectorDiagnostics({
  findings,
  neighbourhood,
  nodeId,
  nodesById,
  onSelect,
  usage,
}: {
  findings: Finding[];
  neighbourhood: Neighbourhood;
  nodeId: string;
  nodesById: Lookup;
  onSelect: (id: string) => void;
  usage?: UsageReport;
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
        <Links
          ids={neighbourhood.composedBy}
          label="Composed by"
          nodesById={nodesById}
          onSelect={onSelect}
        />
        <Links
          ids={neighbourhood.inheritedBy}
          label="Inherited by"
          nodesById={nodesById}
          onSelect={onSelect}
        />
        <p className="mt-1 text-3xs text-phosphor-dim">
          Connections describe direct schema relationships. Observed references
          are aggregated content relations from the usage snapshot.
        </p>
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
