import { XIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Finding } from "../model/findings";
import type { Neighbourhood, PropertyTargets } from "../model/neighbourhood";
import type {
  PropertyGroup,
  SchemaEdge,
  SchemaNode,
  TypeUsage,
  UsageReport,
} from "../model/types";
import { InspectorDiagnostics } from "./InspectorDiagnostics";
import {
  FocusExpansionRow,
  InspectorFocusControls,
} from "./InspectorFocusControls";
import { iconMask } from "./scene/icons";

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

function TypeLink({
  id,
  nodesById,
  onSelect,
}: {
  id: string;
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  const node = nodesById.get(id);
  if (!node) {
    // A block editor still names an Element Type key that has been deleted. The
    // backend reports it rather than dropping the edge, so the panel says so too.
    return <span className="text-signal text-xs">missing element type</span>;
  }
  return (
    <button
      className="block w-full truncate text-left text-phosphor text-xs hover:text-phosphor-bright hover:underline"
      onClick={() => onSelect(id)}
      type="button"
    >
      {node.name}
    </button>
  );
}

function TypeList({
  ids,
  nodesById,
  onSelect,
}: {
  ids: string[];
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <TypeLink id={id} nodesById={nodesById} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function GroupedTypeList({
  groups,
  nodesById,
  onSelect,
}: {
  groups: PropertyTargets[];
  nodesById: Lookup;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div className="mb-1.5 last:mb-0" key={group.propertyAlias}>
          <p className="font-mono text-3xs text-phosphor-dim">
            {group.propertyAlias}
          </p>
          <TypeList ids={group.ids} nodesById={nodesById} onSelect={onSelect} />
        </div>
      ))}
    </>
  );
}

function Properties({
  group,
  nodesById,
}: {
  group: PropertyGroup;
  nodesById: Lookup;
}) {
  return (
    <ul>
      {group.properties.map((property) => (
        <li className="py-px" key={property.alias}>
          <span className="text-phosphor text-xs">{property.name}</span>
          {property.mandatory ? (
            <span className="text-signal" title="Mandatory">
              *
            </span>
          ) : null}
          {/* The dot binds to the alias with a no-break space, so a row that wraps
              breaks before the separator instead of leaving it dangling. */}
          <span className="text-3xs text-phosphor-dim">
            {" · "}
            {property.editorUiAlias ?? property.editorAlias}
          </span>
          {/* A whole group can come from one composition, and then the group header
              already says so, so only a property that differs repeats it. */}
          {property.fromCompositionId &&
          property.fromCompositionId !== group.fromCompositionId ? (
            <span className="block text-3xs text-phosphor-dim">
              composed from{" "}
              {nodesById.get(property.fromCompositionId)?.name ??
                "a deleted type"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Floors({ node, nodesById }: { node: SchemaNode; nodesById: Lookup }) {
  const groups = node.groups ?? [];
  // A tab holds its groups. Anything whose parent alias resolves to nothing is
  // drawn at the top level rather than hidden.
  const nested = (parent: PropertyGroup) =>
    groups.filter((group) => group.parentAlias === parent.alias);
  const top = groups.filter(
    (group) =>
      group.parentAlias === null ||
      !groups.some((candidate) => candidate.alias === group.parentAlias)
  );

  const origin = (group: PropertyGroup) =>
    group.fromCompositionId ? (
      <span className="text-3xs text-phosphor-dim">
        {" "}
        composed from{" "}
        {nodesById.get(group.fromCompositionId)?.name ?? "a deleted type"}
      </span>
    ) : null;

  return (
    <Section title="Floors">
      {top.map((group, index) => (
        <details
          className="mb-1 border border-line last:mb-0"
          key={group.id}
          open={index === 0}
        >
          <summary className="cursor-pointer bg-panel-sunken px-2 py-1 text-phosphor text-xs">
            {group.name}
            {group.type === "Tab" ? (
              <span className="text-3xs text-phosphor-dim"> tab</span>
            ) : null}
            {origin(group)}
          </summary>
          <div className="px-2 py-1">
            <Properties group={group} nodesById={nodesById} />
            {nested(group).map((child) => (
              <div className="mt-1 border-line border-l pl-2" key={child.id}>
                <p className="text-phosphor text-xs">
                  {child.name}
                  {origin(child)}
                </p>
                <Properties group={child} nodesById={nodesById} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </Section>
  );
}

/** What the usage report says about this one type. Absent until the report arrives. */
function Usage({ usage }: { usage: TypeUsage }) {
  const rows: [string, string][] = [
    ["Total", usage.total.toLocaleString()],
    ["Published", usage.published.toLocaleString()],
    ["Drafts", usage.drafts.toLocaleString()],
    ["Trashed", usage.trashed.toLocaleString()],
    ["Root instances", usage.rootInstances.toLocaleString()],
    [
      "Cultures",
      usage.cultures.length > 0 ? usage.cultures.join(", ") : "none",
    ],
    // The date half of the timestamp, not a formatted local date, so the panel
    // reads the same on every machine the backoffice runs on.
    ["Last edited", usage.lastEdited ? usage.lastEdited.slice(0, 10) : "never"],
  ];

  return (
    <Section title="Usage">
      <dl className="grid grid-cols-[auto_1fr] gap-x-2">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-3xs text-phosphor-dim">{label}</dt>
            <dd className="justify-self-end truncate text-phosphor text-xs">
              {value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </Section>
  );
}

/**
 * The type's Umbraco icon, painted as a CSS mask in the panel's own colour. A mask
 * rather than inline SVG, because the icon is markup from the host and markup put
 * into the document can carry an event handler with it.
 */
function TypeIcon({ svg }: { svg?: string }) {
  if (!svg)
    return (
      <span aria-hidden className="mt-0.5 size-4 shrink-0 border border-line" />
    );
  const mask = iconMask(svg);
  return (
    <span
      aria-hidden
      className="mt-0.5 size-4 shrink-0 bg-phosphor"
      style={{
        maskImage: mask,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: mask,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

/**
 * How much of the canvas the open panel covers, in CSS pixels. It is `w-80` below and
 * the `pr-80` the list view is inset by; the camera frames the city in the part of
 * the canvas this leaves, so the number has to be readable outside the stylesheet.
 */
export const INSPECTOR_WIDTH = 320;

function TypeSummary({
  node,
  properties,
}: {
  node: SchemaNode;
  properties: number;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-line border-b px-3 py-2">
      {node.isElement ? <Badge variant="amber">Element</Badge> : null}
      {node.allowedAsRoot ? <Badge>Root</Badge> : null}
      {node.variesByCulture ? (
        <Badge variant="azure">Varies by culture</Badge>
      ) : null}
      <Badge variant="outline">
        {properties} properties ({node.ownPropertyCount} own ·{" "}
        {node.composedPropertyCount} composed)
      </Badge>
    </div>
  );
}

export function Inspector({
  focused,
  icons,
  neighbourhood,
  node,
  nodesById,
  onClose,
  onOpenType,
  onSelect,
  onToggleFocus,
  findings = [],
  usageReport,
  usage,
  edges,
  focusDepth,
  focusCount,
  onExpandFocus,
  canExpandFocus = false,
}: {
  focused: boolean;
  /** Umbraco icon name to SVG, the same map the scene puts on the roofs. */
  icons?: Record<string, string>;
  neighbourhood: Neighbourhood;
  node: SchemaNode;
  nodesById: Lookup;
  onClose: () => void;
  onOpenType?: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleFocus: () => void;
  findings?: Finding[];
  usageReport?: UsageReport;
  usage?: TypeUsage;
  edges?: SchemaEdge[];
  focusDepth?: number;
  focusCount?: number;
  onExpandFocus?: () => void;
  canExpandFocus?: boolean;
}) {
  const list = (ids: string[]) => (
    <TypeList ids={ids} nodesById={nodesById} onSelect={onSelect} />
  );
  const grouped = (groups: PropertyTargets[]) => (
    <GroupedTypeList
      groups={groups}
      nodesById={nodesById}
      onSelect={onSelect}
    />
  );
  const properties = node.ownPropertyCount + node.composedPropertyCount;

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-80 flex-col border-line-strong border-l bg-panel shadow-panel">
      <header className="flex items-start gap-2 border-line border-b px-3 py-2.5">
        {/* The roofs cull their icons by size; this one is here at any zoom. */}
        <TypeIcon svg={icons?.[node.icon]} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-phosphor-bright text-sm">
            {node.name}
          </p>
          <p className="truncate font-mono text-2xs text-phosphor-dim">
            {node.alias}
          </p>
        </div>
        <InspectorFocusControls
          focused={focused}
          onToggleFocus={onToggleFocus}
        />
        <Button
          aria-label="Close inspector"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </header>
      {focused && focusCount !== undefined && onExpandFocus ? (
        <FocusExpansionRow
          canExpand={canExpandFocus}
          count={focusCount}
          depth={focusDepth ?? 1}
          onExpand={onExpandFocus}
        />
      ) : null}

      <TypeSummary node={node} properties={properties} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-3 py-3">
          {usage ? <Usage usage={usage} /> : null}
          <InspectorDiagnostics
            edges={edges}
            findings={findings}
            neighbourhood={neighbourhood}
            nodeId={node.id}
            nodesById={nodesById}
            onSelect={onSelect}
            usage={usageReport}
          />
          {neighbourhood.compositions.length > 0 ? (
            <Section title="Compositions">
              {list(neighbourhood.compositions)}
            </Section>
          ) : null}
          {neighbourhood.inherits.length > 0 ? (
            <Section title="Inherits">{list(neighbourhood.inherits)}</Section>
          ) : null}
          {neighbourhood.allowedParents.length > 0 ? (
            <Section title="Allowed parents">
              {list(neighbourhood.allowedParents)}
            </Section>
          ) : null}
          {neighbourhood.allowedChildren.length > 0 ? (
            <Section title="Allowed children">
              {list(neighbourhood.allowedChildren)}
            </Section>
          ) : null}
          {node.isElement && neighbourhood.blockHosts.length > 0 ? (
            <Section title="Block hosts">
              {list(neighbourhood.blockHosts)}
            </Section>
          ) : null}
          {neighbourhood.blockTargets.length > 0 ? (
            <Section title="Block targets">
              {grouped(neighbourhood.blockTargets)}
            </Section>
          ) : null}
          {neighbourhood.referencesOut.length > 0 ||
          neighbourhood.referencesIn.length > 0 ? (
            <Section title="References">
              {grouped(neighbourhood.referencesOut)}
              {neighbourhood.referencesIn.length > 0 ? (
                <>
                  <p className="mt-1.5 text-3xs text-phosphor-dim">
                    referenced by
                  </p>
                  {list(neighbourhood.referencesIn)}
                </>
              ) : null}
            </Section>
          ) : null}
          {node.templates.length > 0 ? (
            <Section title="Templates">
              <ul>
                {node.templates.map((template) => (
                  <li className="text-phosphor text-xs" key={template.id}>
                    {template.name}
                    {template.isDefault ? (
                      <span className="text-3xs text-phosphor-dim">
                        {" "}
                        default
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {node.groups.length > 0 ? (
            <Floors node={node} nodesById={nodesById} />
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-line border-t p-3">
        <Button
          className="w-full"
          onClick={() => onOpenType?.(node.id)}
          size="sm"
          variant="primary"
        >
          Open in editor
        </Button>
      </div>
    </aside>
  );
}
