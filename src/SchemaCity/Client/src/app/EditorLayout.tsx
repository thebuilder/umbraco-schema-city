// The editor view: the selected type drawn the way an editor meets it in Umbraco,
// tabs across the top and groups as panels, so an overloaded tab or a long run of
// composed fields is visible before anyone opens the backoffice editor.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { type EditorTab, editorLayout } from "../model/editor-layout";
import type { SchemaNode, SchemaProperty } from "../model/types";

type Lookup = Map<string, SchemaNode>;

/**
 * Only a type with real tabs gets a tab row. Its root groups then sit in the
 * generic tab; without tabs they are the whole page, as in Umbraco.
 */
export const hasTabRow = (tabs: EditorTab[]) =>
  tabs.some((tab) => tab.key !== "");

export function EditorLayout({
  selected,
  nodesById,
  onPick,
}: {
  selected: string | null;
  nodesById: Lookup;
  /** Opens the search palette, the one type picker the app already has. */
  onPick: () => void;
}) {
  const node = nodesById.get(selected ?? "");
  if (!node)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <p className="font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
          No type selected
        </p>
        <p className="text-muted-foreground text-xs">
          Pick a Document Type to see its tabs, groups and properties as an
          editor sees them.
        </p>
        <Button onClick={onPick} size="sm">
          Find a type
          <Kbd>⌘K</Kbd>
        </Button>
      </div>
    );
  // Keyed, so each new type opens on its first tab.
  return <Layout key={node.id} node={node} nodesById={nodesById} />;
}

function Header({ node, tabs }: { node: SchemaNode; tabs: EditorTab[] }) {
  const properties = tabs.flatMap((tab) =>
    tab.panels.flatMap((panel) => panel.properties)
  );
  const mandatory = properties.filter((property) => property.mandatory);
  return (
    <header className="border-line border-b px-4 py-2.5">
      <p className="font-bold text-phosphor-bright text-sm">{node.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="mr-1 font-mono text-2xs text-phosphor-dim">
          {node.alias}
        </span>
        {node.isElement ? <Badge variant="amber">Element</Badge> : null}
        {node.variesByCulture ? (
          <Badge variant="azure">Varies by culture</Badge>
        ) : null}
        <Badge variant="outline">
          {properties.length} properties · {node.ownPropertyCount} own ·{" "}
          {node.composedPropertyCount} composed
        </Badge>
        <Badge variant="outline">{mandatory.length} mandatory</Badge>
        {hasTabRow(tabs) ? (
          <Badge variant="outline">
            {tabs.length} {tabs.length === 1 ? "tab" : "tabs"}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}

function PropertyItem({
  property,
  nodesById,
}: {
  property: SchemaProperty;
  nodesById: Lookup;
}) {
  const source = property.fromCompositionId;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-line border-b px-3 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-phosphor text-xs">
          {property.name}
          {property.mandatory ? (
            <span className="text-signal" title="Mandatory">
              {" "}
              *
            </span>
          ) : null}
        </p>
        <p className="truncate font-mono text-3xs text-phosphor-dim">
          {property.alias} · {property.editorUiAlias ?? property.editorAlias}
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-end gap-1">
        {property.variesByCulture ? (
          <Badge variant="azure">Culture</Badge>
        ) : null}
        {source ? (
          <Badge variant="outline">
            from {nodesById.get(source)?.name ?? "deleted type"}
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

function Layout({ node, nodesById }: { node: SchemaNode; nodesById: Lookup }) {
  const tabs = editorLayout(node);
  const [open, setOpen] = useState(tabs[0]?.key);
  const shown = tabs.find((tab) => tab.key === open) ?? tabs[0];

  return (
    <div className="flex h-full flex-col bg-background">
      <Header node={node} tabs={tabs} />

      {hasTabRow(tabs) ? (
        <div
          aria-label="Tabs"
          className="flex shrink-0 flex-wrap border-line border-b px-4"
          role="tablist"
        >
          {tabs.map((tab) => (
            <button
              aria-selected={tab === shown}
              className={`-mb-px border-b-2 px-3 py-2 text-xs ${
                tab === shown
                  ? "border-phosphor text-phosphor-bright"
                  : "border-transparent text-phosphor-dim hover:text-phosphor"
              }`}
              key={tab.key}
              onClick={() => setOpen(tab.key)}
              role="tab"
              type="button"
            >
              {tab.name}
              <span className="ml-1.5 text-3xs text-phosphor-dim">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
        {shown ? null : (
          <p className="text-muted-foreground text-xs">
            This type has no properties.
          </p>
        )}
        {shown?.panels.map((panel) => (
          <section className="border border-line" key={panel.key}>
            {panel.name === null ? null : (
              <h3 className="flex items-baseline justify-between border-line border-b bg-panel-sunken px-3 py-1.5 text-phosphor text-xs">
                {panel.name}
                <span className="text-3xs text-phosphor-dim">
                  {panel.properties.length}
                </span>
              </h3>
            )}
            <ul>
              {panel.properties.map((property) => (
                <PropertyItem
                  key={`${property.fromCompositionId ?? ""}:${property.alias}`}
                  nodesById={nodesById}
                  property={property}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
