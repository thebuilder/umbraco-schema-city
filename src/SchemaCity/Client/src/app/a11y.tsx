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
import type { SchemaGraph, SchemaNode } from "../model/types";

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

/**
 * The open inspector's heading, from anywhere inside the app. A dialog that picked a
 * type returns focus here rather than to its own trigger, since the inspector is
 * what the pick opened.
 */
const inspectorHeading = (from: Element | null | undefined) =>
  appRoot(from)?.querySelector<HTMLElement>("[data-inspector-heading]") ?? null;

/**
 * For a dialog whose rows open the inspector. `chose` marks that a row was picked,
 * and `finalFocus`, given to the dialog, then sends focus to the inspector heading
 * rather than back to the trigger. Closing without a pick returns to the trigger.
 * `from` is any element inside the app.
 */
export function useHandOff(from: RefObject<Element | null>) {
  const picked = useRef(false);
  return {
    chose: () => {
      picked.current = true;
    },
    finalFocus: (): HTMLElement | true => {
      const chose = picked.current;
      picked.current = false;
      const heading = chose ? inspectorHeading(from.current) : null;
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

/**
 * How many districts the city draws: one per top-level folder that holds a type, and
 * one for the unfiled types, or the four role districts when nothing is filed. The
 * same partition as cityDistricts in layout/city.ts, counted without running the
 * layout, which loads with the scene; a test holds the two together.
 */
export function districtCount(graph: SchemaGraph): number {
  const folders = graph.folders ?? [];
  const parentOf = new Map(
    folders.map((folder) => [folder.id, folder.parentId])
  );
  // Bounded by the folder count, so a parent cycle cannot recurse for ever.
  const topOf = (id: string, hops = folders.length): string => {
    const parent = parentOf.get(id);
    return parent && hops > 0 ? topOf(parent, hops - 1) : id;
  };
  const filed = graph.nodes.filter(
    (node) => node.folderId !== null && parentOf.has(node.folderId)
  );
  if (filed.length === 0) return districtsByRole(graph);
  const tops = new Set(filed.map((node) => topOf(node.folderId ?? "")));
  return tops.size + (filed.length < graph.nodes.length ? 1 : 0);
}

/** Types a root can reach down the allowed-child rules, the roots included. */
function reachedFromRoots(graph: SchemaGraph): Set<string> {
  const children = new Map<string, string[]>();
  for (const edge of graph.edges ?? [])
    if (edge.kind === "allowedChild")
      children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  const reached = new Set(
    graph.nodes
      .filter((node) => node.allowedAsRoot && !node.isElement)
      .map((node) => node.id)
  );
  // A Set visits what is added while it is walked, so this is breadth first.
  for (const id of reached)
    for (const child of children.get(id) ?? []) reached.add(child);
  return reached;
}

/** Pages reached from a root, compositions, Element Types, and the rest. */
function districtsByRole(graph: SchemaGraph): number {
  const reached = reachedFromRoots(graph);
  const composed = new Set<string>();
  for (const edge of graph.edges ?? [])
    if (edge.kind === "composition") composed.add(edge.to);
  const roleOf = (node: SchemaNode) => {
    if (node.isElement) return "elements";
    if (reached.has(node.id)) return "structure";
    return composed.has(node.id) ? "compositions" : "unplaced";
  };
  return new Set(graph.nodes.map(roleOf)).size;
}

/** The canvas's one-line reading, since the buildings themselves say nothing. */
export const citySummary = (graph: SchemaGraph) =>
  `3D city of ${plural(graph.nodes.length, "Document Type")} in ${plural(districtCount(graph), "district")}. The List view has the same types as a table.`;
