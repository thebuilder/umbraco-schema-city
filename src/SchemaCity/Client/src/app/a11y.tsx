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

/** useAnnounceChange for a component that has nothing to render. */
export function Say({ message }: { message: string | null }) {
  useAnnounceChange(message);
  return null;
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
export function deepActive(): Element | null {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

/** Marks the app's root, so a dialog can find the inspector to hand focus to. */
export const APP_ROOT = "data-schema-city";
export const INSPECTOR_HEADING = "data-inspector-heading";
/** Where focus goes when the element that opened the inspector is gone. */
export const FOCUS_HOME = "data-focus-home";

/**
 * The open inspector's heading, from anywhere inside the app. A dialog that picked a
 * type returns focus here rather than to its own trigger, since the inspector is
 * what the pick opened.
 */
export const inspectorHeading = (from: Element | null | undefined) =>
  from
    ?.closest(`[${APP_ROOT}]`)
    ?.querySelector<HTMLElement>(`[${INSPECTOR_HEADING}]`) ?? null;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

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
  const topOf = (id: string) => {
    let at = id;
    for (let hops = folders.length; hops > 0; hops--) {
      const parent = parentOf.get(at);
      if (parent === null || parent === undefined) break;
      at = parent;
    }
    return at;
  };
  const tops = new Set(
    graph.nodes.map((node) =>
      node.folderId !== null && parentOf.has(node.folderId)
        ? topOf(node.folderId)
        : null
    )
  );
  if ([...tops].some((top) => top !== null)) return tops.size;
  return districtsByRole(graph);
}

/** Pages reached from a root, compositions, Element Types, and the rest. */
function districtsByRole(graph: SchemaGraph): number {
  const known = new Set(graph.nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const composed = new Set<string>();
  for (const edge of graph.edges ?? []) {
    if (!(known.has(edge.from) && known.has(edge.to))) continue;
    if (edge.kind === "composition") composed.add(edge.to);
    if (edge.kind === "allowedChild")
      children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  const reached = new Set(
    graph.nodes
      .filter((node) => node.allowedAsRoot && !node.isElement)
      .map((node) => node.id)
  );
  for (const id of reached)
    for (const child of children.get(id) ?? []) reached.add(child);
  const roles = new Set(
    graph.nodes.map((node) => {
      if (node.isElement) return "elements";
      if (reached.has(node.id)) return "structure";
      return composed.has(node.id) ? "compositions" : "unplaced";
    })
  );
  return roles.size;
}

/** The canvas's one-line reading, since the buildings themselves say nothing. */
export const citySummary = (graph: SchemaGraph) =>
  `3D city of ${plural(graph.nodes.length, "Document Type")} in ${plural(districtCount(graph), "district")}. The List view has the same types as a table.`;
