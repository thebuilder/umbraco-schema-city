// What a screen reader or a keyboard needs that the views share: one polite status
// line, arrow keys across a row of tabs or radios, and the platform's search key.
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PortalContainer } from "@/portal";
import type { SchemaGraph } from "../model/types";
import type { Grouping } from "./layout/city";

const Announce = createContext<(message: string) => void>(() => undefined);

/**
 * The app's one live region. Messages sent in the same task are read as one line,
 * so selecting a type and entering focus with it is a single announcement. It also
 * provides the portal container, so App wraps its tree in one provider, not two.
 */
export function LiveRegion({
  children,
  portal,
}: {
  children: ReactNode;
  portal: RefObject<HTMLElement | null>;
}) {
  const [message, setMessage] = useState("");
  const batch = useRef<string[]>([]);
  const announce = useCallback((text: string) => {
    batch.current.push(text);
    if (batch.current.length > 1) return;
    queueMicrotask(() => {
      setMessage(batch.current.join(". "));
      batch.current = [];
    });
  }, []);
  return (
    <PortalContainer value={portal}>
      <Announce value={announce}>
        {children}
        <p className="sr-only" role="status">
          {message}
        </p>
      </Announce>
    </PortalContainer>
  );
}

/**
 * Announces `message` whenever it changes, but not on mount: a view that opens is
 * not news, a filter that narrows it is. Null says nothing.
 */
export function useAnnounceChange(message: string | null) {
  const announce = use(Announce);
  const last = useRef(message);
  useEffect(() => {
    if (message === last.current) return;
    last.current = message;
    if (message) announce(message);
  }, [message, announce]);
}

const ARROWS: Partial<Record<string, (at: number, last: number) => number>> = {
  ArrowLeft: (at, last) => (at === 0 ? last : at - 1),
  ArrowUp: (at, last) => (at === 0 ? last : at - 1),
  ArrowRight: (at, last) => (at === last ? 0 : at + 1),
  ArrowDown: (at, last) => (at === last ? 0 : at + 1),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * Arrow keys, Home and End across the tabs or radios inside the element this is on,
 * moving focus and choosing as they go, as the ARIA patterns for both describe. The
 * items are found by the role of the one that has focus.
 */
export function roving(event: KeyboardEvent<HTMLElement>) {
  const move = ARROWS[event.key];
  const from = event.target as HTMLElement;
  const role = from.getAttribute("role");
  if (!(move && role)) return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`),
  ];
  const next = items[move(items.indexOf(from), items.length - 1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
  next.click();
}

/** "⌘K" where Command is the key, "Ctrl K" everywhere else. */
export const SEARCH_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘K"
    : "Ctrl K";

/** The element that really has focus, looking inside shadow roots. */
function deepActive(): Element | null {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

/**
 * Nothing in particular has focus: the body, or a shadow host whose focused child
 * was just removed, which is where focus lands when a panel closes under it.
 */
const focusLost = (at = deepActive()) =>
  !at || at === document.body || Boolean(at.shadowRoot);

/** The app's root, marked so a dialog or a panel can find its way around it. */
const appRoot = (from: Element | null | undefined) =>
  from?.closest("[data-schema-city]");

/** The open inspector's heading, which a pick of a type hands focus to. */
const INSPECTOR_HEADING = "[data-inspector-heading]";

/** The Data Type page's heading, which a pick of a Data Type hands focus to. */
export const DATA_TYPE_HEADING = "[data-data-type-heading]";

/**
 * For a dialog whose rows open the inspector or a Data Type page. `chose` marks
 * that a row was picked and which heading it opened, and `finalFocus`, given to the
 * dialog, then sends focus to that heading rather than back to the trigger. Closing
 * without a pick returns to the trigger. `from` is any element inside the app.
 */
export function useHandOff(from: RefObject<Element | null>) {
  const picked = useRef<string | null>(null);
  return {
    chose: (heading = INSPECTOR_HEADING) => {
      picked.current = heading;
    },
    finalFocus: (): HTMLElement | true => {
      const chose = picked.current;
      picked.current = null;
      const heading = chose
        ? appRoot(from.current)?.querySelector<HTMLElement>(chose)
        : null;
      return heading ?? true;
    },
  };
}

/**
 * Focus for a panel over the view. Its heading takes focus when the panel opens
 * from inside the app or changes subject, so following a link inside it never drops
 * focus to the page. When it closes with focus in it, focus goes back to whatever
 * opened it, or to the view (marked data-focus-home) when that is gone.
 */
export function usePanelFocus(
  panel: RefObject<HTMLElement | null>,
  heading: RefObject<HTMLElement | null>,
  subject: string
) {
  useEffect(() => {
    const root = appRoot(panel.current);
    const opener = deepActive();
    return () => {
      if (!focusLost()) return;
      const back =
        opener?.isConnected && !focusLost(opener)
          ? opener
          : root?.querySelector("[data-focus-home]");
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    };
  }, [panel]);

  const opened = useRef(false);
  useEffect(() => {
    const at = deepActive();
    const inApp = at !== null && Boolean(appRoot(panel.current)?.contains(at));
    // On the first open, only a reader already working in the app is moved, so a
    // page that loads with a type selected leaves focus where the host put it.
    if (inApp || (opened.current && focusLost(at)))
      heading.current?.focus({ preventScroll: true });
    opened.current = true;
  }, [panel, heading, subject]);
}

/** "1 property", "2 properties". */
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** The canvas's one-line reading, since the buildings themselves say nothing. */
export const citySummary = (graph: SchemaGraph, grouping: Grouping) =>
  `3D city of ${plural(graph.nodes.length, "Document Type")}, grouped by ${grouping === "folders" ? "folder" : "what editors can create where"}. The List view has the same types as a table.`;
