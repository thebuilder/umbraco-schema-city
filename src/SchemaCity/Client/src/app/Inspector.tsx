import { XIcon } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Finding } from "../model/findings";
import {
  connectionGroups,
  contentCountOf,
  roleOf,
  usageLine,
  usageState,
} from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import type {
  SchemaEdge,
  SchemaNode,
  TypeUsage,
  UsageReport,
} from "../model/types";
import { READING, ROLE, RoleBadges } from "./InspectorChips";
import {
  FocusExpansionRow,
  InspectorFocusControls,
} from "./InspectorFocusControls";
import { InspectorProperties } from "./InspectorProperties";
import { Connections, Overview } from "./InspectorTabs";
import { iconMask } from "./scene/icons";

/**
 * The panel is wide where the workspace has room and narrow where it does not,
 * which inside the backoffice is a narrow window or an open sidebar. The breakpoint
 * is the width of the area the panel sits in, a container query rather than a media
 * query, because the backoffice's own chrome takes part of the viewport.
 */
const WIDE_FROM = 1024;
const WIDE = 520;
const NARROW = 340;

/**
 * CSS pixels of canvas the open panel covers, for the camera, which frames the city
 * in the part the panel leaves. It has to agree with the classes below.
 */
export const inspectorWidthFor = (areaWidth: number) =>
  Math.min(areaWidth >= WIDE_FROM ? WIDE : NARROW, areaWidth);

/** The inset a view under the open panel takes, so nothing slides beneath it. */
export const INSPECTOR_INSET = "pr-[min(340px,100%)] @min-[1024px]:pr-[520px]";
const PANEL_WIDTH = "w-[min(340px,100%)] @min-[1024px]:w-[520px]";

const WORDS = /\s+/;

/**
 * The type's Umbraco icon in its role's colour, painted as a CSS mask. A mask rather
 * than inline SVG, because the icon is markup from the host and markup put into the
 * document can carry an event handler with it. Without an icon, the name's initials.
 */
function Glyph({ node, svg }: { node: SchemaNode; svg?: string }) {
  const mask = svg ? iconMask(svg) : null;
  const masked: CSSProperties | undefined = mask
    ? {
        maskImage: mask,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: mask,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }
    : undefined;
  const initials = node.name
    .split(WORDS)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center border border-(--role) bg-(--role)/10 font-mono text-(--role) text-xs"
    >
      {masked ? (
        <span className="size-4 bg-(--role)" style={masked} />
      ) : (
        initials
      )}
    </span>
  );
}

type Tab = "overview" | "properties" | "connections";

function TabButton({
  badge,
  current,
  id,
  label,
  onPick,
  problem = false,
}: {
  badge?: number;
  current: Tab;
  id: Tab;
  label: string;
  onPick: (tab: Tab) => void;
  problem?: boolean;
}) {
  const selected = current === id;
  return (
    <button
      aria-selected={selected}
      className={`-mb-px border-b-2 px-2 pt-2.5 pb-2 ${selected ? "border-phosphor text-prose" : "border-transparent text-label hover:text-prose"}`}
      onClick={() => onPick(id)}
      role="tab"
      type="button"
    >
      {label}
      {badge ? (
        <span
          className={`ml-1 font-mono text-2xs ${problem ? "text-signal" : "text-faint"}`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function Inspector({
  focused,
  icons,
  neighbourhood,
  node,
  nodesById,
  onClose,
  editorLayoutOpen,
  onEditorLayout,
  onOpenType,
  onSelect,
  onToggleFocus,
  findings = [],
  usageReport,
  usage,
  edges = [],
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
  nodesById: Map<string, SchemaNode>;
  onClose: () => void;
  /** Shows the type in the editor view, unless that view is already on. */
  onEditorLayout?: () => void;
  editorLayoutOpen?: boolean;
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
  // The tab is kept with the type it was picked on, so selecting another type
  // starts on Overview without an effect to reset it.
  const [picked, setPicked] = useState<{ id: string; tab: Tab }>({
    id: node.id,
    tab: "overview",
  });
  const tab = picked.id === node.id ? picked.tab : "overview";
  const pick = (next: Tab) => setPicked({ id: node.id, tab: next });

  const kind = roleOf(node, neighbourhood);
  const role = ROLE[kind];
  const groups = connectionGroups(node, neighbourhood);
  const usageNow = usageState(node, neighbourhood, usageReport, usage);
  const countOf = useMemo(
    () => contentCountOf(usageReport, nodesById, edges),
    [usageReport, nodesById, edges]
  );
  const tabProps = {
    countOf,
    groups,
    neighbourhood,
    node,
    nodesById,
    onSelect,
    usage: usageNow,
    usageReport,
  };

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-10 flex ${PANEL_WIDTH} flex-col border-line-strong border-l bg-panel font-sans text-[13px] text-prose leading-normal shadow-panel`}
    >
      <header
        className="border-line border-b px-4 pt-4 pb-3"
        style={{ "--role": role.colour } as CSSProperties}
      >
        <div className="flex items-start gap-2.5">
          {/* The roofs cull their icons by size; this one is here at any zoom. */}
          <Glyph node={node} svg={icons?.[node.icon]} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-[17px] text-foreground leading-tight">
              {node.name}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="truncate font-mono text-faint text-xs">
                {node.alias}
              </span>
              <RoleBadges node={node} role={kind} />
            </div>
          </div>
          <Button
            aria-label="Close inspector"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
        <p className="mt-2.5 text-label">{usageLine(usageNow)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <InspectorFocusControls
            className={READING}
            focused={focused}
            onToggleFocus={onToggleFocus}
          />
          {/* Hidden while the editor view is already showing this type. */}
          {onEditorLayout && !editorLayoutOpen ? (
            <Button
              className={READING}
              onClick={onEditorLayout}
              size="sm"
              variant="outline"
            >
              Editor layout
            </Button>
          ) : null}
          <Button
            className={`ml-auto ${READING} font-semibold`}
            onClick={() => onOpenType?.(node.id)}
            size="sm"
            variant="primary"
          >
            Open in editor
          </Button>
        </div>
        {focused && focusCount !== undefined && onExpandFocus ? (
          <FocusExpansionRow
            buttonClassName={READING}
            canExpand={canExpandFocus}
            count={focusCount}
            depth={focusDepth ?? 1}
            onExpand={onExpandFocus}
          />
        ) : null}
      </header>

      <div className="flex border-line border-b px-2" role="tablist">
        <TabButton
          badge={findings.length}
          current={tab}
          id="overview"
          label="Overview"
          onPick={pick}
          problem={findings.some((finding) => finding.severity === "problem")}
        />
        <TabButton
          badge={node.ownPropertyCount + node.composedPropertyCount}
          current={tab}
          id="properties"
          label="Properties"
          onPick={pick}
        />
        <TabButton
          badge={groups.reduce((sum, group) => sum + group.count, 0)}
          current={tab}
          id="connections"
          label="Connections"
          onPick={pick}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Keyed by type, so a list opened with "+ more" closes again for the next. */}
        <div className="px-4 pb-4" key={node.id} role="tabpanel">
          {tab === "overview" ? (
            <Overview
              {...tabProps}
              findings={findings}
              onShowConnections={() => pick("connections")}
            />
          ) : null}
          {tab === "properties" ? (
            <InspectorProperties node={node} nodesById={nodesById} />
          ) : null}
          {tab === "connections" ? (
            <Connections {...tabProps} edges={edges} />
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
