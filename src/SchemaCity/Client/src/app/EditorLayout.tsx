// The editor view: the selected type drawn the way an editor meets it in Umbraco,
// tabs across the top and groups as panels, so an overloaded tab or a long run of
// composed fields is visible before anyone opens the backoffice editor.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  type EditorPanel,
  type EditorTab,
  editorLabel,
  editorLayout,
  editorSummary,
  MIXED,
  panelSource,
} from "../model/editor-layout";
import { type Finding, TAB_LIMIT } from "../model/findings";
import type { Role } from "../model/inspector";
import type { SchemaNode, SchemaProperty } from "../model/types";
import { FindingDot, READING, RoleBadges } from "./InspectorChips";
import { InspectorChecks } from "./InspectorDiagnostics";

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
          <Kbd>⌘K</Kbd>
        </Button>
      </div>
    );
  // Keyed, so each new type opens on its first tab.
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
}: {
  property: SchemaProperty;
  nodesById: Lookup;
  quiet: boolean;
  /** The panel mixes origins, so this row names its own. */
  mixed: boolean;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,14rem)] items-baseline gap-x-4 border-line/40 border-t px-3 py-1.5 first:border-t-0">
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
          stays one hover away. */}
      <span
        className="truncate text-label text-xs"
        title={editorLabel(property)}
      >
        {property.dataTypeName ?? property.editorAlias}
        {property.variesByCulture ? (
          <span className="text-faint"> · varies by culture</span>
        ) : null}
      </span>
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
}: {
  panel: EditorPanel;
  nodesById: Lookup;
  open: boolean;
  onToggle: () => void;
  overloaded: boolean;
}) {
  const source = panelSource(panel);
  const composed = borrowed(panel);
  const rows = (
    <ul>
      {panel.properties.map((property) => (
        <PropertyItem
          key={`${property.fromCompositionId ?? ""}:${property.alias}`}
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
  const [open, setOpen] = useState(tabs[0]?.key);
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

      <div className="min-h-0 flex-1 overflow-auto">
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
              aria-label="Tabs"
              className="flex flex-wrap border-line border-b"
              role="tablist"
            >
              {tabs.map((tab) => (
                <button
                  aria-selected={tab === shown}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pt-3 pb-2 ${
                    tab === shown
                      ? "border-phosphor text-prose"
                      : "border-transparent text-label hover:text-prose"
                  }`}
                  key={tab.key}
                  onClick={() => setOpen(tab.key)}
                  role="tab"
                  type="button"
                >
                  {tab.name}
                  <span className="font-mono text-2xs text-faint">
                    {tab.count}
                  </span>
                  {tab.count > TAB_LIMIT ? (
                    <FindingDot severity="note" title={OVERLOADED} />
                  ) : null}
                </button>
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

        <div className={`${COLUMN} space-y-2 py-3`}>
          {shown ? null : (
            <p className="text-faint text-xs">This type has no properties.</p>
          )}
          {shown?.panels.map((panel) => (
            <Panel
              key={panel.key}
              nodesById={nodesById}
              onToggle={() => flip(panel.key)}
              open={isOpen(panel)}
              overloaded={!tabRow && panel.properties.length > TAB_LIMIT}
              panel={panel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
