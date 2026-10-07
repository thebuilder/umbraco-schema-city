import { Fragment, type ReactNode } from "react";
import type { Finding } from "../model/findings";
import {
  type Chip,
  type ConnectionGroup,
  chips,
  directUsageRows,
  emptyKindsLine,
  type Field,
  observedReferences,
  type ThroughUsage,
  type UsageState,
} from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import type { SchemaEdge, SchemaNode, UsageReport } from "../model/types";
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
  usage: UsageState;
  /** The content count a type's chip shows, or nothing for a type that holds none. */
  countOf: (id: string) => number | undefined;
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

/** What reaches a composition through the types that compose it, with a bar. */
function Through({ through }: { through: ThroughUsage }) {
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

function Usage({ usage }: { usage: UsageState }) {
  if (usage.kind === "direct")
    return <Values rows={directUsageRows(usage.usage)} />;
  if (usage.kind === "through") return <Through through={usage.through} />;
  return (
    <Muted>
      {usage.kind === "loading"
        ? "Content usage has not loaded yet."
        : "No content of this type in the usage snapshot."}
    </Muted>
  );
}

/**
 * One connection kind under its heading. A plain list is chips; a per-property kind
 * is whatever the tab makes of its fields.
 */
function GroupSection({
  countOf,
  group,
  limit,
  nodesById,
  onSelect,
  renderFields,
}: Pick<TabProps, "countOf" | "nodesById" | "onSelect"> & {
  group: ConnectionGroup;
  limit: number;
  renderFields: (fields: Field[]) => ReactNode;
}) {
  return (
    <Section>
      <Heading count={group.count} trace={group.trace}>
        {group.label}
      </Heading>
      {"ids" in group ? (
        <TypeChips
          chips={chips(group.ids, nodesById, countOf, group.via)}
          limit={limit}
          onSelect={onSelect}
        />
      ) : (
        renderFields(group.fields)
      )}
    </Section>
  );
}

function Templates({ node }: { node: SchemaNode }) {
  if (node.templates.length === 0) return null;
  return (
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
  );
}

function EmptyKinds({ groups, node }: Pick<TabProps, "groups" | "node">) {
  const empty = emptyKindsLine(node, groups);
  return empty ? (
    <Section>
      <Muted>{empty}</Muted>
    </Section>
  ) : null;
}

export function Overview({
  findings,
  onShowConnections,
  ...props
}: TabProps & { findings: Finding[]; onShowConnections: () => void }) {
  const { groups, nodesById, onSelect } = props;
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
        <Usage usage={props.usage} />
      </Section>
      {groups.map((group) => (
        <GroupSection
          {...props}
          group={group}
          key={group.kind}
          limit={8}
          // Per-property lists need the room, so the overview only counts them.
          renderFields={(fields) => (
            <div className="flex flex-wrap items-baseline gap-x-1">
              <Muted>
                Across {fields.length}{" "}
                {fields.length === 1 ? "property" : "properties"}.
              </Muted>
              <TextButton onClick={onShowConnections}>
                See Connections
              </TextButton>
            </div>
          )}
        />
      ))}
      <Templates node={props.node} />
      <EmptyKinds {...props} />
    </>
  );
}

function ObservedList({
  chipList,
  label,
  onSelect,
}: {
  chipList: Chip[];
  label: string;
  onSelect: (id: string) => void;
}) {
  if (chipList.length === 0) return null;
  const total = chipList.reduce((sum, chip) => sum + (chip.count ?? 0), 0);
  return (
    <div className="mt-2.5">
      <p className="mb-1 text-label text-xs">
        {label} <span className="font-mono">{total.toLocaleString()}</span>
      </p>
      <TypeChips chips={chipList} limit={12} onSelect={onSelect} />
    </div>
  );
}

function ObservedSection({ children }: { children: ReactNode }) {
  return (
    <Section>
      <Heading>Observed in content</Heading>
      <Muted>
        References counted between content items in the usage snapshot, not read
        from configuration.
      </Muted>
      {children}
    </Section>
  );
}

function Observed({
  node,
  nodesById,
  onSelect,
  usageReport,
}: Pick<TabProps, "node" | "nodesById" | "onSelect" | "usageReport">) {
  if (!usageReport)
    return (
      <ObservedSection>
        <p className="mt-2 text-faint text-xs">
          Content usage has not loaded yet.
        </p>
      </ObservedSection>
    );
  const observed = observedReferences(node.id, usageReport, nodesById);
  return (
    <ObservedSection>
      {observed.out.length + observed.in.length === 0 ? (
        <p className="mt-2 text-faint text-xs">None counted.</p>
      ) : null}
      <ObservedList
        chipList={observed.out}
        label="Its content references"
        onSelect={onSelect}
      />
      <ObservedList
        chipList={observed.in}
        label="Referenced by content"
        onSelect={onSelect}
      />
    </ObservedSection>
  );
}

export function Connections({
  edges,
  ...props
}: TabProps & { edges: SchemaEdge[] }) {
  const { countOf, groups, node, nodesById, onSelect } = props;
  return (
    <>
      {groups.map((group) => (
        <GroupSection
          {...props}
          group={group}
          key={group.kind}
          limit={12}
          renderFields={(fields) =>
            fields.map((field) => (
              <div className="mb-2.5 last:mb-0" key={field.propertyAlias}>
                <p className="mb-1 truncate font-mono text-label text-xs">
                  {field.propertyAlias}
                  <span className="font-sans text-faint">
                    {field.dataType ? ` · ${field.dataType}` : ""}
                  </span>
                </p>
                <TypeChips
                  chips={chips(field.ids, nodesById, countOf)}
                  limit={6}
                  onSelect={onSelect}
                />
              </div>
            ))
          }
        />
      ))}
      <EmptyKinds {...props} />
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
