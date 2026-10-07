// Presentation mode's own chrome: the slim bar that replaces the toolbar, and the
// caption card that replaces the inspector until the presenter asks for Details.
import { XIcon } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { INSPECTOR_INSET } from "./Inspector";
import { READING, ROLE } from "./InspectorChips";
import { InspectorFocusControls } from "./InspectorFocusControls";
import type { View } from "./url";
import { ViewSwitcher } from "./Views";

/**
 * How much larger presenting draws text: the names over and on the city, and through
 * CSS zoom the 2D views, the inspector and the overlays. 1.4 takes the 10 px chrome
 * type to 14 px, which is what reads on a projector from the back of a room.
 */
const PRESENT_SCALE = 1.4;

/** How long the bar stays after the pointer stops moving. */
const BAR_HIDE_MS = 2500;

/**
 * What differs on the way in: the root's marker and `--present`, the zoom the 2D
 * views, the overlays and Details take, the scene's text scale, and no inset for a
 * panel the caption card replaces.
 */
const PRESENTING = {
  marker: "",
  style: { "--present": PRESENT_SCALE } as CSSProperties,
  textScale: PRESENT_SCALE,
  panelInset: "",
};
const RESTING = {
  marker: undefined,
  style: undefined,
  textScale: 1,
  panelInset: INSPECTOR_INSET,
};

/**
 * Presentation mode's state, and what the app root needs for it. `onToggle` runs on
 * the way in and out, which App uses to frame the city again for the new canvas.
 */
export function usePresentation(initial: boolean, onToggle: () => void) {
  const [presenting, setPresenting] = useState(initial);
  // The full inspector over the view while presenting, opened from the caption card.
  const [details, setDetails] = useState(false);
  const root = useRef<HTMLElement>(null);
  // Whether this app asked for the fullscreen the document is in, so the browser's
  // own way out of it, Escape or its exit button, leaves presentation as well.
  const ownsFullscreen = useRef(false);
  const toggled = useRef(onToggle);
  toggled.current = onToggle;

  const set = (on: boolean) => {
    setPresenting(on);
    setDetails(false);
    toggled.current();
  };

  /**
   * Into presentation, full screen where the page may have it. A backoffice in a
   * frame without permission, or a link opened with present=1 and no key press
   * behind it, is refused, and the app fills the window instead.
   */
  const present = (on: boolean) => {
    set(on);
    if (!on) {
      if (ownsFullscreen.current) {
        ownsFullscreen.current = false;
        document.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    root.current
      ?.requestFullscreen?.()
      .then(() => {
        ownsFullscreen.current = true;
        // Held, so Escape reaches the app and closes Search or Details first; holding
        // it still leaves full screen. Chromium only, and nothing is lost without it.
        return (
          navigator as Navigator & {
            keyboard?: { lock?: (keys: string[]) => Promise<void> };
          }
        ).keyboard?.lock?.(["Escape"]);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement || !ownsFullscreen.current) return;
      ownsFullscreen.current = false;
      setPresenting(false);
      setDetails(false);
      toggled.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const mode = presenting ? PRESENTING : RESTING;
  return {
    presenting,
    details,
    setDetails,
    present,
    /** Spread on the app root: the element full screen asks for, and the zoom. */
    rootProps: { ref: root, "data-present": mode.marker, style: mode.style },
    /** How much larger the scene draws its names. */
    textScale: mode.textScale,
    /** The inset a 2D view takes for the open inspector, none for the caption card. */
    panelInset: mode.panelInset,
    /** Whether the camera leaves room for the panel; the caption card needs none. */
    panelOpen: (open: boolean) => open && !presenting,
    /** Closing the inspector, which while presenting is closing Details. */
    closeInspector: (done: () => void) =>
      presenting ? () => setDetails(false) : done,
  };
}

/**
 * The caption card and Details while presenting, with the inspector as
 * Details; otherwise the inspector as it is. Zoomed, and Details is the container its
 * widths are read from, so the panel takes the narrow width a zoomed area has room for.
 */
export function PresentationLayer({
  presenting,
  card,
  details,
  children,
}: {
  presenting: boolean;
  card: Omit<Parameters<typeof CaptionCard>[0], "node" | "neighbourhood"> & {
    node?: SchemaNode;
    neighbourhood?: Neighbourhood;
  };
  details: boolean;
  /** The inspector, or nothing when no type is selected. */
  children: ReactNode;
}) {
  if (!presenting) return children;
  return (
    <>
      <CaptionLayer {...card} />
      {details ? (
        <div className="@container pointer-events-none absolute inset-0 z-20 [zoom:var(--present)] *:pointer-events-auto">
          {children}
        </div>
      ) : null}
    </>
  );
}

/** The caption card on a zoomed layer of its own, while a type is selected. */
function CaptionLayer({
  node,
  neighbourhood,
  ...card
}: Parameters<typeof PresentationLayer>[0]["card"]) {
  if (!(node && neighbourhood)) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 [zoom:var(--present)] *:pointer-events-auto">
      <CaptionCard {...card} neighbourhood={neighbourhood} node={node} />
    </div>
  );
}

/**
 * Keeps `--caption-space` on the app root at the room the card takes from the bottom
 * of the view, which the 2D views pad themselves by so their last rows scroll clear
 * of it. Read in the zoomed layer's own pixels, which the views share.
 */
function useCaptionSpace(card: RefObject<HTMLElement | null>) {
  useEffect(() => {
    // Set by the time an effect runs: the card is mounted with its layer around it.
    const element = card.current as HTMLElement;
    const layer = element.parentElement as HTMLElement;
    const root = element.closest<HTMLElement>("[data-schema-city]");
    if (!root) return;
    const measure = () =>
      root.style.setProperty(
        "--caption-space",
        `${(layer.getBoundingClientRect().bottom - element.getBoundingClientRect().top) / PRESENT_SCALE}px`
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(layer);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--caption-space");
    };
  }, [card]);
}

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

/** Where the card stands: the corner, the corner above the change legend, or a strip. */
const CORNER = "left-3 w-[min(22rem,calc(100%-1.5rem))] p-3";
const PLACE = {
  corner: `${CORNER} bottom-3`,
  raised: `${CORNER} bottom-16`,
  docked:
    "inset-x-0 bottom-0 flex flex-wrap items-center gap-x-6 gap-y-1 border-x-0 border-b-0 px-4 py-2 *:mt-0",
};

/**
 * The inspector cut down to what an audience reads at a glance: the name, its role,
 * how much content it has and how many types it touches, each way. Details opens the
 * full inspector over the view; closing the card puts the type down but keeps focus.
 */
function CaptionCard({
  node,
  neighbourhood,
  usageReport,
  focused,
  raised,
  docked,
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
  /**
   * Over a 2D view, where it is a strip along the bottom instead: a card in the
   * corner left the Matrix one row at 1280x720 once the view scrolled clear of it.
   */
  docked: boolean;
  onToggleFocus: () => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  usePanelFocus(card, heading, node.id);
  useCaptionSpace(card);
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
      className={`absolute border border-line-strong bg-panel font-sans text-prose text-sm shadow-panel ${PLACE[docked ? "docked" : raised ? "raised" : "corner"]}`}
      ref={card}
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
