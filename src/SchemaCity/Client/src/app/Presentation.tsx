// Presentation mode's own chrome: the slim bar that replaces the toolbar, and the
// caption card that replaces the inspector until the presenter asks for Details.
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  connectionGroups,
  roleOf,
  usageLine,
  usageState,
} from "../model/inspector";
import type { Neighbourhood } from "../model/neighbourhood";
import type { SchemaNode, UsageReport } from "../model/types";
import { SEARCH_KEY, usePanelFocus } from "./a11y";
import { READING, ROLE } from "./InspectorChips";
import { InspectorFocusControls } from "./InspectorFocusControls";
import type { View } from "./url";
import { ViewSwitcher } from "./Views";

/**
 * How much larger presenting draws text: the names over and on the city, and through
 * CSS zoom the 2D views, the inspector and the overlays. 1.4 takes the 10 px chrome
 * type to 14 px, which is what reads on a projector from the back of a room.
 */
export const PRESENT_SCALE = 1.4;

/** How long the bar stays after the pointer stops moving. */
const BAR_HIDE_MS = 2500;

/**
 * The toolbar while presenting: the view switcher, Search and the way out, over the
 * top right of the canvas. It shows on any pointer move and fades after the pointer
 * rests, and stays while the pointer or keyboard focus is in it. Hidden is opacity
 * only, so Tab still reaches it and showing it is what focus does.
 */
export function PresentBar({
  view,
  onView,
  onSearch,
  onLeave,
}: {
  view: View;
  onView: (view: View) => void;
  onSearch: () => void;
  onLeave: () => void;
}) {
  // Shown on entry, so the presenter sees where the way out is before it fades.
  const [shown, setShown] = useState(true);
  useEffect(() => {
    let timer = setTimeout(() => setShown(false), BAR_HIDE_MS);
    const wake = () => {
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), BAR_HIDE_MS);
    };
    window.addEventListener("pointermove", wake, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, []);
  return (
    <nav
      aria-label="Presentation"
      className={`absolute top-2 right-2 z-30 flex flex-wrap items-center justify-end gap-2 border border-line-strong bg-background/90 p-1.5 shadow-panel transition-opacity duration-300 focus-within:pointer-events-auto focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`}
      data-present-bar=""
    >
      <ViewSwitcher onView={onView} view={view} />
      <Button data-trigger onClick={onSearch} size="sm">
        Search
        <Kbd>{SEARCH_KEY}</Kbd>
      </Button>
      <Button
        aria-keyshortcuts="P Escape"
        onClick={onLeave}
        size="sm"
        variant="outline"
      >
        Leave presentation
        <Kbd>Esc</Kbd>
      </Button>
    </nav>
  );
}

/**
 * The inspector cut down to what an audience reads at a glance: the name, its role,
 * how much content it has and how many types it touches, each way. Details opens the
 * full inspector over the view; closing the card puts the type down but keeps focus.
 */
export function CaptionCard({
  node,
  neighbourhood,
  usageReport,
  focused,
  raised,
  onToggleFocus,
  onDetails,
  onClose,
}: {
  node: SchemaNode;
  neighbourhood: Neighbourhood;
  usageReport?: UsageReport;
  focused: boolean;
  /** Whether the change layer's legend holds the corner, so the card sits above it. */
  raised: boolean;
  onToggleFocus: () => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  usePanelFocus(card, heading, node.id);
  const role = ROLE[roleOf(node, neighbourhood)];
  const usage = usageState(
    node,
    neighbourhood,
    usageReport,
    usageReport?.byType[node.id]
  );
  return (
    <aside
      aria-label="Caption"
      className={`absolute left-3 w-[min(22rem,calc(100%-1.5rem))] border border-line-strong bg-panel p-3 font-sans text-prose text-sm shadow-panel ${raised ? "bottom-16" : "bottom-3"}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate font-semibold text-foreground text-lg leading-tight outline-none"
            data-inspector-heading=""
            ref={heading}
            tabIndex={-1}
          >
            {node.name}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-label text-xs">
            <span
              aria-hidden
              className="size-2 shrink-0"
              style={{ background: role.colour }}
            />
            {role.label}
            <span aria-hidden>·</span>
            <span className="truncate font-mono">{node.alias}</span>
          </p>
        </div>
        <Button
          aria-label="Close the caption"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
      <p className="mt-2 text-label">{usageLine(usage)}</p>
      <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {connectionGroups(node, neighbourhood).map((group) => (
          <div className="flex gap-1" key={group.kind}>
            <dt className="text-label">{group.label}</dt>
            <dd className="font-mono text-foreground">{group.count}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        <InspectorFocusControls
          className={READING}
          focused={focused}
          onToggleFocus={onToggleFocus}
        />
        <Button
          className={READING}
          onClick={onDetails}
          size="sm"
          variant="outline"
        >
          Details
        </Button>
      </div>
    </aside>
  );
}
