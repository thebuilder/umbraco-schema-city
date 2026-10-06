import { Fragment, type ReactNode } from "react";
import type { Finding } from "../model/findings";
import {
  type ConnectionGroup,
  chips,
  emptyKindsLine,
  observedReferences,
  throughUsage,
} from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import type {
  SchemaEdge,
  SchemaNode,
  TypeUsage,
  UsageReport,
} from "../model/types";
import { Heading, TextButton, TypeChips } from "./InspectorChips";
import { ExplainConnections, InspectorChecks } from "./InspectorDiagnostics";

type Lookup = Map<string, SchemaNode>;

export type TabProps = {
  node: SchemaNode;
  neighbourhood: Neighbourhood;
  groups: ConnectionGroup[];
  nodesById: Lookup;
  onSelect: (id: string) => void;
  usageReport?: UsageReport;
  usage?: TypeUsage;
};

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="border-line border-b py-3.5 last:border-b-0">
      {children}
    </section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-faint text-xs">{children}</p>;
}

function Values({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-label text-xs">{label}</dt>
          <dd className="truncate font-mono text-prose text-xs">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Content items per type, once the usage report is in; until then no counts. */
const contentCount = (report?: UsageReport) => (id: string) =>
  report ? (report.byType[id]?.total ?? 0) : undefined;

function Usage({
  neighbourhood,
  node,
  usage,
  usageReport,
}: Pick<TabProps, "neighbourhood" | "node" | "usage" | "usageReport">) {
  if (!usageReport) return <Muted>Content usage has not loaded yet.</Muted>;
  if (usage && usage.total > 0)
    return (
      <Values
        rows={[
          ["Published", usage.published.toLocaleString()],
          ["Drafts", usage.drafts.toLocaleString()],
          ["Trashed", usage.trashed.toLocaleString()],
          ["Root instances", usage.rootInstances.toLocaleString()],
          [
            "Cultures",
            usage.cultures.length > 0 ? usage.cultures.join(", ") : "none",
          ],
          // The date half of the timestamp, not a formatted local date, so the
          // panel reads the same on every machine the backoffice runs on.
          [
            "Last edited",
            usage.lastEdited ? usage.lastEdited.slice(0, 10) : "never",
          ],
        ]}
      />
    );
  if (node.isElement || neighbourhood.composedBy.length === 0)
    return <Muted>No content of this type in the usage snapshot.</Muted>;
  const through = throughUsage(neighbourhood, usageReport);
  if (through.total === 0)
    return (
      <Muted>
        No content of its own, and none in the types that use it either.
      </Muted>
    );
  const share = (count: number) => `${(count / through.total) * 100}%`;
  return (
    <>
      <Muted>No content of its own. Through the types that use it:</Muted>
      <div
        aria-hidden
        className="mt-2 mb-1.5 flex h-1.5 overflow-hidden bg-line"
      >
        <span
          className="bg-phosphor-dim"
          style={{ width: share(through.published) }}
        />
        <span className="bg-amber" style={{ width: share(through.drafts) }} />
        <span className="bg-signal" style={{ width: share(through.trashed) }} />
      </div>
      <Values
        rows={[
          ["Published", through.published.toLocaleString()],
          ["Drafts", through.drafts.toLocaleString()],
          ["Trashed", through.trashed.toLocaleString()],
          ["Types with content", `${through.withContent} of ${through.of}`],
        ]}
      />
    </>
  );
}

export function Overview({
  findings,
  onShowConnections,
  ...props
}: TabProps & { findings: Finding[]; onShowConnections: () => void }) {
  const { groups, node, nodesById, onSelect, usageReport } = props;
  const empty = emptyKindsLine(node, groups);
  return (
    <>
      <Section>
        <Heading>Checks</Heading>
        <InspectorChecks
          findings={findings}
          nodesById={nodesById}
          onSelect={onSelect}
        />
      </Section>
      <Section>
        <Heading>Usage</Heading>
        <Usage {...props} />
      </Section>
      {groups.map((group) => (
        <Section key={group.kind}>
          <Heading count={group.count} trace={group.trace}>
            {group.label}
          </Heading>
          {"ids" in group ? (
            <TypeChips
              chips={chips(group.ids, nodesById, contentCount(usageReport))}
              limit={8}
              onSelect={onSelect}
            />
          ) : (
            // Per-property lists need the room, so the overview only counts them.
            <div className="flex flex-wrap items-baseline gap-x-1">
              <Muted>
                Across {group.fields.length}{" "}
                {group.fields.length === 1 ? "property" : "properties"}.
              </Muted>
              <TextButton onClick={onShowConnections}>
                See Connections
              </TextButton>
            </div>
          )}
        </Section>
      ))}
      {node.templates.length > 0 ? (
        <Section>
          <Heading count={node.templates.length}>Templates</Heading>
          <ul className="text-prose text-xs">
            {node.templates.map((template) => (
              <li key={template.id}>
                {template.name}
                {template.isDefault ? (
                  <span className="text-faint"> default</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {empty ? (
        <Section>
          <Muted>{empty}</Muted>
        </Section>
      ) : null}
    </>
  );
}

function Observed({
  node,
  nodesById,
  onSelect,
  usageReport,
}: Pick<TabProps, "node" | "nodesById" | "onSelect" | "usageReport">) {
  const observed = usageReport
    ? observedReferences(node.id, usageReport, nodesById)
    : null;
  const total = (list: { count?: number }[]) =>
    list.reduce((sum, chip) => sum + (chip.count ?? 0), 0);
  return (
    <Section>
      <Heading>Observed in content</Heading>
      <Muted>
        References counted between content items in the usage snapshot, not read
        from configuration.
      </Muted>
      {observed ? null : (
        <p className="mt-2 text-faint text-xs">
          Content usage has not loaded yet.
        </p>
      )}
      {observed && observed.out.length + observed.in.length === 0 ? (
        <p className="mt-2 text-faint text-xs">None counted.</p>
      ) : null}
      {observed && observed.out.length > 0 ? (
        <div className="mt-2.5">
          <p className="mb-1 text-label text-xs">
            Its content references{" "}
            <span className="font-mono">{total(observed.out)}</span>
          </p>
          <TypeChips chips={observed.out} limit={12} onSelect={onSelect} />
        </div>
      ) : null}
      {observed && observed.in.length > 0 ? (
        <div className="mt-2.5">
          <p className="mb-1 text-label text-xs">
            Referenced by content{" "}
            <span className="font-mono">{total(observed.in)}</span>
          </p>
          <TypeChips chips={observed.in} limit={12} onSelect={onSelect} />
        </div>
      ) : null}
    </Section>
  );
}

export function Connections({
  edges,
  ...props
}: TabProps & { edges: SchemaEdge[] }) {
  const { groups, node, nodesById, onSelect, usageReport } = props;
  const empty = emptyKindsLine(node, groups);
  return (
    <>
      {groups.map((group) => (
        <Section key={group.kind}>
          <Heading count={group.count} trace={group.trace}>
            {group.label}
          </Heading>
          {"ids" in group ? (
            <TypeChips
              chips={chips(group.ids, nodesById, contentCount(usageReport))}
              limit={12}
              onSelect={onSelect}
            />
          ) : (
            group.fields.map((field) => (
              <div className="mb-2.5 last:mb-0" key={field.propertyAlias}>
                <p className="mb-1 truncate font-mono text-label text-xs">
                  {field.propertyAlias}
                  {field.dataType ? (
                    <span className="font-sans text-faint">
                      {" · "}
                      {field.dataType}
                    </span>
                  ) : null}
                </p>
                <TypeChips
                  chips={chips(field.ids, nodesById, contentCount(usageReport))}
                  limit={6}
                  onSelect={onSelect}
                />
              </div>
            ))
          )}
        </Section>
      ))}
      {empty ? (
        <Section>
          <Muted>{empty}</Muted>
        </Section>
      ) : null}
      <Observed {...props} />
      <ExplainConnections
        edges={edges}
        nodeId={node.id}
        nodesById={nodesById}
        onSelect={onSelect}
      />
    </>
  );
}
