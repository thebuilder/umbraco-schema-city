import { XIcon } from "lucide-react";
import { type CSSProperties, useId, useMemo, useRef, useState } from "react";
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
import { plural, roving, usePanelFocus } from "./a11y";
import {
  READING,
  ROLE,
  RoleBadges,
  TabButton,
  TabCount,
} from "./InspectorChips";
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

const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  properties: "Properties",
  connections: "Connections",
};

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
  // Every type opens on Overview, including one shown before: remembering a tab
  // per type made the same click land on different tabs.
  const [tab, setTab] = useState<Tab>("overview");
  const [tabOf, setTabOf] = useState(node.id);
  if (tabOf !== node.id) {
    setTabOf(node.id);
    setTab("overview");
  }
  const base = useId();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  usePanelFocus(panel, heading, node.id);

  const kind = roleOf(node, neighbourhood);
  const role = ROLE[kind];
  const groups = connectionGroups(node, neighbourhood);
  const problems = findings.filter(
    (finding) => finding.severity === "problem"
  ).length;
  // A type in two groups, an Inherits parent that is also composed, is one type.
  const related = new Set(
    groups.flatMap((group) =>
      "ids" in group ? group.ids : group.fields.flatMap((field) => field.ids)
    )
  ).size;
  const total = node.ownPropertyCount + node.composedPropertyCount;
  const counts: Record<
    Tab,
    { count: number; spoken: string; problem: boolean }
  > = {
    overview: {
      count: findings.length,
      spoken: [
        plural(findings.length, "check"),
        problems > 0 ? plural(problems, "problem") : "",
      ]
        .filter(Boolean)
        .join(", "),
      problem: problems > 0,
    },
    properties: {
      count: total,
      spoken: plural(total, "property", "properties"),
      problem: false,
    },
    connections: {
      count: related,
      spoken: plural(related, "type"),
      problem: false,
    },
  };
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
      aria-label="Inspector"
      className={`absolute inset-y-0 right-0 z-10 flex ${PANEL_WIDTH} flex-col border-line-strong border-l bg-panel font-sans text-[13px] text-prose leading-normal shadow-panel`}
      ref={panel}
    >
      <header
        className="border-line border-b px-4 pt-4 pb-3"
        style={{ "--role": role.colour } as CSSProperties}
      >
        <div className="flex items-start gap-2.5">
          {/* The roofs cull their icons by size; this one is here at any zoom. */}
          <Glyph node={node} svg={icons?.[node.icon]} />
          <div className="min-w-0 flex-1">
            {/* Focusable from script only, so opening the panel or following a
                link inside it can put the reader on the type's name. */}
            <h2
              className="truncate font-semibold text-[17px] text-foreground leading-tight outline-none"
              data-inspector-heading=""
              ref={heading}
              tabIndex={-1}
            >
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

      <div
        aria-label={`${node.name} details`}
        className="flex border-line border-b px-2"
        onKeyDown={roving}
        role="tablist"
      >
        {(Object.keys(TAB_LABEL) as Tab[]).map((id) => (
          <TabButton
            className="px-2 pt-2.5 pb-2"
            id={`${base}-${id}`}
            key={id}
            onPick={() => setTab(id)}
            panel={`${base}-panel`}
            selected={tab === id}
          >
            {TAB_LABEL[id]}
            <TabCount
              count={counts[id].count}
              problem={counts[id].problem}
              spoken={counts[id].spoken}
            />
          </TabButton>
        ))}
      </div>

      {/* The viewport is the tab panel, so the one tab stop after the tabs is also
          what scrolls. */}
      <ScrollArea
        className="min-h-0 flex-1"
        viewport={{
          "aria-labelledby": `${base}-${tab}`,
          id: `${base}-panel`,
          role: "tabpanel",
        }}
      >
        {/* Keyed by type, so a list opened with "+ more" closes again for the next. */}
        <div className="px-4 pb-4" key={node.id}>
          {tab === "overview" ? (
            <Overview
              {...tabProps}
              findings={findings}
              onShowConnections={() => setTab("connections")}
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
