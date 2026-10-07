// The editor view: the selected type drawn the way an editor meets it in Umbraco,
// tabs across the top and groups as panels, so an overloaded tab or a long run of
// composed fields is visible before anyone opens the backoffice editor.
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  type EditorPanel,
  type EditorTab,
  editorLabel,
  editorLayout,
  editorSummary,
  firstOwnTab,
  MIXED,
  panelSource,
} from "../model/editor-layout";
import { type Finding, TAB_LIMIT } from "../model/findings";
import type { Role } from "../model/inspector";
import type { SchemaNode, SchemaProperty } from "../model/types";
import { plural, roving, SEARCH_KEY } from "./a11y";
import {
  FindingDot,
  READING,
  RoleBadges,
  SpokenCount,
  TabButton,
} from "./InspectorChips";
import { InspectorChecks } from "./InspectorDiagnostics";
import { Scroller } from "./TypeTable";

type Lookup = Map<string, SchemaNode>;

/**
 * Only a type with real tabs gets a tab row. Its root groups then sit in the
 * generic tab; without tabs they are the whole page, as in Umbraco.
 */
export const hasTabRow = (tabs: EditorTab[]) =>
  tabs.some((tab) => tab.key !== "");

/** A column of reading width, so a row's name and its Data Type stay in one glance. */
const COLUMN = "mx-auto w-full max-w-240 px-4";

/** A named group whose properties all come from one composition, which can fold. */
function borrowed(panel: EditorPanel) {
  const source = panelSource(panel);
  return panel.name !== null && source !== null && source !== MIXED;
}

const OVERLOADED = `More than ${TAB_LIMIT} properties, see the Overloaded tab note`;

/** A property row's key, the same one the panel renders it under. */
const rowKey = (property: SchemaProperty) =>
  `${property.fromCompositionId ?? ""}:${property.alias}`;

/**
 * What the type's findings say about single property rows, by row key: both rows
 * of a duplicate alias, a block property that lists a deleted Element Type, and a
 * property whose culture variance the invariant type ignores. Only kinds the
 * findings report are marked, so the rows never say more than the checks above.
 */
export function propertyFlags(
  node: SchemaNode,
  findings: Finding[],
  nodesById: Lookup
): Map<string, string> {
  const kinds = new Set(findings.map((finding) => finding.kind));
  const properties = node.groups.flatMap((group) => group.properties);
  const flags = new Map<string, string[]>();
  const flag = (property: SchemaProperty, text: string) =>
    flags.set(rowKey(property), [...(flags.get(rowKey(property)) ?? []), text]);
  const source = (property: SchemaProperty) =>
    property.fromCompositionId
      ? (nodesById.get(property.fromCompositionId)?.name ?? "a deleted type")
      : "this type";
  const editor = (property: SchemaProperty) =>
    property.dataTypeName ?? property.editorAlias;

  if (kinds.has("duplicateAlias"))
    for (const property of properties) {
      const others = properties.filter(
        (other) =>
          other.alias === property.alias &&
          other.fromCompositionId !== property.fromCompositionId
      );
      if (others.length === 0) continue;
      const differ = others.filter(
        (other) => other.dataTypeId !== property.dataTypeId
      );
      flag(
        property,
        `Duplicate alias: ${property.alias} also comes from ${others.map(source).join(", ")}${
          differ.length > 0
            ? `, with a different editor (${differ.map(editor).join(", ")})`
            : ""
        }`
      );
    }

  if (kinds.has("brokenBlock"))
    for (const property of properties)
      if (
        property.targets.some(
          (target) => target.role !== "picker" && !nodesById.has(target.nodeId)
        )
      )
        flag(
          property,
          "Broken block: lists an Element Type that no longer exists"
        );

  if (kinds.has("cultureMismatch") && !node.variesByCulture)
    for (const property of properties) {
      if (property.variesByCulture)
        flag(
          property,
          "Culture mismatch: varies by culture on a type that does not"
        );
      const variant = property.targets.filter(
        (target) =>
          target.role !== "picker" &&
          nodesById.get(target.nodeId)?.variesByCulture
      );
      if (variant.length > 0)
        flag(
          property,
          `Culture mismatch: lists ${[...new Set(variant.map((target) => nodesById.get(target.nodeId)?.name))].join(", ")}, which varies by culture`
        );
    }

  return new Map([...flags].map(([key, texts]) => [key, texts.join(". ")]));
}

export function EditorLayout({
  selected,
  nodesById,
  onPick,
  onSelect,
  findings,
  roleOf,
}: {
  selected: string | null;
  nodesById: Lookup;
  /** Opens the search palette, the one type picker the app already has. */
  onPick: () => void;
  onSelect: (id: string) => void;
  /** Every finding; the view shows the selected type's. */
  findings: Finding[];
  roleOf: (node: SchemaNode) => Role;
}) {
  const node = nodesById.get(selected ?? "");
  if (!node)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center font-sans">
        <p className="font-semibold text-[17px] text-foreground">
          No type selected
        </p>
        <p className="text-label text-sm">
          Pick a Document Type to see its tabs, groups and properties as an
          editor sees them.
        </p>
        <Button className={READING} onClick={onPick} size="sm">
          Find a type
          <Kbd>{SEARCH_KEY}</Kbd>
        </Button>
      </div>
    );
  // Keyed, so each new type opens on the tab where its own properties start.
  return (
    <Layout
      findings={findings.filter((finding) => finding.nodeId === node.id)}
      key={node.id}
      node={node}
      nodesById={nodesById}
      onSelect={onSelect}
      role={roleOf(node)}
    />
  );
}

/** "from Seo Composition", in the colour the city draws composition links. */
function From({ id, nodesById }: { id: string; nodesById: Lookup }) {
  return (
    <span className="text-azure text-xs">
      from {nodesById.get(id)?.name ?? "a deleted type"}
    </span>
  );
}

function PropertyItem({
  property,
  nodesById,
  quiet,
  mixed,
  flag,
}: {
  property: SchemaProperty;
  nodesById: Lookup;
  quiet: boolean;
  /** The panel mixes origins, so this row names its own. */
  mixed: boolean;
  /** What a check found on this row, if anything. */
  flag?: string;
}) {
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_minmax(0,14rem)] items-baseline gap-x-4 border-line/40 border-t border-l-2 px-3 py-1.5 first:border-t-0 ${flag ? "border-l-signal" : "border-l-transparent"}`}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className={quiet ? "text-label" : "text-prose"}>
          {property.name}
          {property.mandatory ? (
            <span className="text-signal" title="Mandatory">
              {" *"}
            </span>
          ) : null}
        </span>
        <span className="truncate font-mono text-faint text-xs">
          {property.alias}
        </span>
        {mixed && property.fromCompositionId ? (
          <From id={property.fromCompositionId} nodesById={nodesById} />
        ) : null}
      </div>
      {/* The Data Type is what an editor recognises; the editor alias behind it
          is on hover for a mouse and read after it for a screen reader. */}
      <span
        className="truncate text-label text-xs"
        title={editorLabel(property)}
      >
        {property.dataTypeName ?? property.editorAlias}
        {property.dataTypeName ? (
          <span className="sr-only">
            , editor {property.editorUiAlias ?? property.editorAlias}
          </span>
        ) : null}
        {property.variesByCulture ? (
          <span className="text-faint"> · varies by culture</span>
        ) : null}
      </span>
      {flag ? <p className="col-span-2 text-signal text-xs">{flag}</p> : null}
    </li>
  );
}

/**
 * One group. A group from a composition is what the type borrows, so it is drawn
 * quieter and can fold to its header; the type's own groups are what it adds.
 */
function Panel({
  panel,
  nodesById,
  open,
  onToggle,
  overloaded,
  flags,
}: {
  panel: EditorPanel;
  nodesById: Lookup;
  open: boolean;
  onToggle: () => void;
  overloaded: boolean;
  flags: Map<string, string>;
}) {
  const source = panelSource(panel);
  const composed = borrowed(panel);
  const flagged = panel.properties.filter((property) =>
    flags.has(rowKey(property))
  ).length;
  const rows = (
    <ul>
      {panel.properties.map((property) => (
        <PropertyItem
          flag={flags.get(rowKey(property))}
          key={rowKey(property)}
          mixed={source === MIXED}
          nodesById={nodesById}
          property={property}
          quiet={composed}
        />
      ))}
    </ul>
  );
  // Properties on a tab outside any group have no header to fold under.
  if (panel.name === null)
    return <section className="border border-line">{rows}</section>;
  return (
    <section className="border border-line">
      <h3>
        <button
          aria-expanded={open}
          className="flex w-full items-baseline gap-2 bg-muted px-3 py-1.5 text-left hover:bg-accent/50"
          onClick={onToggle}
          type="button"
        >
          <span aria-hidden className="w-3 shrink-0 text-faint text-xs">
            {open ? "▾" : "▸"}
          </span>
          <span
            className={`truncate font-medium ${composed ? "text-label" : "text-prose"}`}
          >
            {panel.name}
          </span>
          <span className="font-mono text-2xs text-faint">
            {panel.properties.length}
          </span>
          {overloaded ? (
            <FindingDot severity="note" title={OVERLOADED} />
          ) : null}
          {/* A folded group still says a row inside it was flagged. */}
          {flagged > 0 ? (
            <FindingDot
              title={`${flagged} flagged ${flagged === 1 ? "property" : "properties"}`}
            />
          ) : null}
          {composed && source ? (
            <span className="ml-auto shrink-0">
              <From id={source} nodesById={nodesById} />
            </span>
          ) : null}
        </button>
      </h3>
      {open ? <div className="border-line border-t">{rows}</div> : null}
    </section>
  );
}

function Layout({
  node,
  nodesById,
  onSelect,
  findings,
  role,
}: {
  node: SchemaNode;
  nodesById: Lookup;
  onSelect: (id: string) => void;
  findings: Finding[];
  role: Role;
}) {
  const tabs = editorLayout(node);
  const tabRow = hasTabRow(tabs);
  const base = useId();
  const flags = propertyFlags(node, findings, nodesById);
  const [open, setOpen] = useState(firstOwnTab(tabs)?.key);
  // Composed groups start folded; a key here is one the reader turned the other way.
  const [allComposed, setAllComposed] = useState(false);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const shown = tabs.find((tab) => tab.key === open) ?? tabs[0];
  const folding = tabs.some((tab) => tab.panels.some(borrowed));
  const isOpen = (panel: EditorPanel) =>
    !borrowed(panel) || allComposed !== flipped.has(panel.key);
  const flip = (key: string) =>
    setFlipped((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex h-full flex-col bg-background font-sans text-[13px] text-prose leading-normal">
      <header className="border-line border-b pt-4 pb-3">
        <div className={COLUMN}>
          <h2 className="font-semibold text-[17px] text-foreground leading-tight">
            {node.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-mono text-faint text-xs">{node.alias}</span>
            <RoleBadges node={node} role={role} />
          </div>
          <p className="mt-2 text-label">{editorSummary(tabs)}</p>
        </div>
      </header>

      <Scroller label={`${node.name} as an editor sees it`}>
        {findings.length > 0 ? (
          <div className={`${COLUMN} pt-3`}>
            <InspectorChecks
              findings={findings}
              nodesById={nodesById}
              onSelect={onSelect}
            />
          </div>
        ) : null}

        <div
          className={`${COLUMN} flex flex-wrap items-end justify-between gap-x-4`}
        >
          {tabRow ? (
            <div
              aria-label={`${node.name} tabs`}
              className="flex flex-wrap border-line border-b"
              onKeyDown={roving}
              role="tablist"
            >
              {tabs.map((tab, index) => (
                <TabButton
                  className="px-2.5 pt-3 pb-2"
                  id={`${base}-${index}`}
                  key={tab.key}
                  onPick={() => setOpen(tab.key)}
                  panel={`${base}-panel`}
                  selected={tab === shown}
                >
                  {tab.name}
                  <SpokenCount
                    count={tab.count}
                    spoken={plural(tab.count, "property", "properties")}
                  />
                  {tab.count > TAB_LIMIT ? (
                    <FindingDot severity="note" title={OVERLOADED} />
                  ) : null}
                </TabButton>
              ))}
            </div>
          ) : (
            <span />
          )}
          {folding ? (
            <button
              className="py-2 text-phosphor text-xs hover:text-phosphor-bright hover:underline"
              onClick={() => {
                setAllComposed(!allComposed);
                setFlipped(new Set());
              }}
              type="button"
            >
              {allComposed
                ? "Collapse composed groups"
                : "Expand composed groups"}
            </button>
          ) : null}
        </div>

        <div
          className={`${COLUMN} space-y-2 py-3`}
          id={`${base}-panel`}
          // A tab panel only when there is a tab row to label it.
          {...(tabRow && shown
            ? {
                role: "tabpanel",
                "aria-labelledby": `${base}-${tabs.indexOf(shown)}`,
              }
            : {})}
        >
          {shown ? null : (
            <p className="text-faint text-xs">This type has no properties.</p>
          )}
          {shown?.panels.map((panel) => (
            <Panel
              flags={flags}
              key={panel.key}
              nodesById={nodesById}
              onToggle={() => flip(panel.key)}
              open={isOpen(panel)}
              overloaded={!tabRow && panel.properties.length > TAB_LIMIT}
              panel={panel}
            />
          ))}
        </div>
      </Scroller>
    </div>
  );
}
