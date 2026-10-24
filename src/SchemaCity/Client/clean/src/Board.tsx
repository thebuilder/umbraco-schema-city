// The clean variant's stage: the schema as a flat diagram you pan and zoom, one card
// per type and one line per relationship. App owns the state; this draws it.

import type { SchemaGraph, SchemaNode } from "@schema-city/core/model/types";
import { iconColour, iconMask } from "@schema-city/core/scene/icons";
import { Button } from "@schema-city/ui/components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@schema-city/ui/components/ui/popover.tsx";
import { inspectorWidthFor } from "@schema-city/ui/Inspector.tsx";
import type { StageProps } from "@schema-city/ui/stage.tsx";
import {
  Background,
  BaseEdge,
  type Edge,
  type EdgeProps,
  getViewportForBounds,
  Handle,
  type InternalNode,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  memo,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type BoardLayout,
  type Box,
  boardEdges,
  boardLayout,
  boardOwnsKey,
  boundsOf,
  CARD_HEIGHT,
  CARD_WIDTH,
  type Card,
  type CardState,
  cardCaption,
  cardKey,
  cardLook,
  cardState,
  cardTitle,
  type Frame,
  keyMove,
  LAYER_DASH,
  LAYER_TOKEN,
  linkPath,
  linkState,
  litBy,
  litLast,
  panelCovers,
  picked,
  rampFill,
  readableView,
  revealCentre,
  sizeBar,
  type ZoomBand,
  zoomBand,
} from "./board-layout";

const MIN_ZOOM = 0.05;
/** A double-click's two presses fall within this, on every common platform's default. */
const DOUBLE_CLICK_MS = 350;
/**
 * The furthest out the board frames itself, where a card's name still reads on two
 * lines (zoomBand). A bigger board opens at its top left, or on the focused type,
 * and the reader zooms out for the rest.
 */
const READ_ZOOM = 0.55;
/**
 * A view move's length, none when the reader asks for reduced motion: the map then
 * jumps to the new view rather than gliding there, as the City places its camera.
 */
const glide = (duration: number) => ({
  duration: matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : duration,
});

type CardData = {
  node: SchemaNode;
  kind: Card["kind"];
  /** The lens's colour, when a lens has something to say about this type. */
  fill?: string;
  /** A lens is on, so a card it says nothing about goes quiet. */
  lensOn?: boolean;
  icon?: string;
  state: CardState;
  removed?: boolean;
};

type FrameData = { name: string; count: number };

type LinkData = { stroke: string; dash?: string };

/**
 * The card whose lines are lit: the selection, or the hovered card with none. A
 * context the lines read rather than a field on every edge, so a hover re-renders
 * the lines and leaves React Flow's edge list alone.
 */
const Touching = createContext<string | null>(null);

/**
 * What a screen reader says on reaching a card. React Flow's default describes
 * dragging and deleting nodes, which the board does not do.
 */
const ARIA_LABELS = {
  "node.a11yDescription.default":
    "Enter selects the type, and Enter again focuses it. Arrow keys move the map. Search finds any type.",
};

/**
 * Lines stay quiet until a card is touched, so the cards read first; then a touched
 * card's own lines come up in full and the rest all but go.
 */
const LINK_STYLE = {
  plain: { strokeWidth: 1.25, opacity: 0.32 },
  lit: { strokeWidth: 1.75, opacity: 1 },
  faded: { strokeWidth: 1.25, opacity: 0.08 },
};

/**
 * The colour an icon is drawn in. A lens speaks through colour, so with one on the
 * icon takes the lens's colour, or goes quiet where the lens says nothing. Without
 * one it takes the type's own icon colour, moved a third of the way to the text
 * colour so a pale named colour like yellow still reads on the tile.
 */
function iconInk(
  node: SchemaNode,
  accent: string,
  fill?: string,
  lensOn = false
) {
  if (fill) return fill;
  if (lensOn) return "var(--faint)";
  return `color-mix(in oklab, ${iconColour(node.iconColor, accent)} 70%, var(--text-mix))`;
}

/**
 * The type's icon in a tile tinted with the card's accent. A type whose icon the
 * backoffice could not give, or the harness, shows its initial instead.
 */
function IconTile({
  node,
  icon,
  tile,
  colour,
}: {
  node: SchemaNode;
  icon?: string;
  tile: string;
  colour: string;
}) {
  return (
    <span
      aria-hidden
      className="board-icon grid size-8 shrink-0 place-items-center rounded-md font-semibold text-xs"
      style={{ background: tile, color: colour }}
    >
      {icon ? (
        <span
          className="size-4.5"
          style={{
            backgroundColor: "currentColor",
            mask: `${iconMask(icon)} center / contain no-repeat`,
          }}
        />
      ) : (
        node.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

const TypeCard = memo(function CardBody({ data }: NodeProps<Node<CardData>>) {
  const { node, kind, fill, lensOn, icon, state, removed } = data;
  const look = cardLook(kind, fill);
  const tile = lensOn && !fill ? "var(--panel-sunken)" : look.tile;
  return (
    <div
      className="board-card relative flex h-full items-center gap-2.5 rounded-lg border border-line bg-(--wash,var(--panel)) px-2.5 pb-2 text-left shadow-xs transition-[opacity,box-shadow,border-color] hover:border-line-strong hover:shadow-sm data-[state=faded]:opacity-30 data-[state=removed]:border-signal data-[state=removed]:border-dashed data-[state=removed]:bg-transparent data-[state=removed]:shadow-none data-[state=selected]:border-phosphor data-[state=selected]:ring-2 data-[state=selected]:ring-phosphor/25"
      data-state={removed ? "removed" : state}
      style={{ "--wash": look.wash, "--tile": tile } as CSSProperties}
      title={cardTitle(node, removed)}
    >
      {/* React Flow draws no edge to a node without handles. These are hidden:
          Link runs its line between the cards' borders instead. */}
      <Handle
        className="invisible"
        isConnectable={false}
        position={Position.Top}
        type="target"
      />
      <Handle
        className="invisible"
        isConnectable={false}
        position={Position.Bottom}
        type="source"
      />
      <IconTile
        colour={iconInk(node, look.accent, fill, lensOn)}
        icon={icon}
        node={node}
        tile={tile}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="board-name truncate font-semibold text-foreground text-xs leading-tight">
          {node.name}
        </span>
        <span className="board-detail truncate text-2xs text-label leading-tight">
          {cardCaption(node, removed)}
        </span>
      </span>
      <SizeBar node={node} />
    </div>
  );
});

/**
 * A card's size along its foot: a segment per property group, as long as its
 * properties (sizeBar), the composed ones fainter. It holds its thickness on screen
 * as the board zooms out, so sizes still compare when the cards are tiles.
 */
function SizeBar({ node }: { node: SchemaNode }) {
  const segments = sizeBar(node);
  if (segments.length === 0) return null;
  return (
    <span
      aria-hidden
      className="board-size absolute inset-x-2.5 bottom-1.5 flex"
    >
      {segments.map((segment) => (
        <span
          className="h-full shrink-0 rounded-full bg-(--bar) data-composed:bg-(--bar-composed)"
          data-composed={segment.composed ? "" : undefined}
          key={segment.id}
          style={{ width: `${segment.share * 100}%` }}
        />
      ))}
    </span>
  );
}

const DistrictFrame = memo(function FrameBody({
  data,
}: NodeProps<Node<FrameData>>) {
  // The name stands above the frame and keeps its size on screen however far the
  // board is zoomed out (styles.css), so the districts still read at an overview.
  return (
    <div className="board-frame pointer-events-none relative h-full rounded-lg border border-line">
      <p className="board-frame-name absolute bottom-full left-0 max-w-full truncate pb-1 font-semibold text-foreground">
        {data.name}
        <span className="ml-1.5 font-normal text-label">{data.count}</span>
      </p>
    </div>
  );
});

const boxOf = (node: InternalNode): Box => ({
  ...node.internals.positionAbsolute,
  width: node.measured.width ?? CARD_WIDTH,
  height: node.measured.height ?? CARD_HEIGHT,
});

/** A curve between the two cards, row to row as a diagram reads (linkPath). */
function Link({ source, target, markerEnd, data }: EdgeProps<Edge<LinkData>>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  const state = linkState({ from: source, to: target }, use(Touching));
  if (!(from && to && data)) return null;
  return (
    <BaseEdge
      markerEnd={markerEnd}
      path={linkPath(boxOf(from), boxOf(to))}
      style={{
        stroke: data.stroke,
        strokeDasharray: data.dash,
        strokeLinecap: "round",
        ...LINK_STYLE[state],
      }}
    />
  );
}

const NODE_TYPES = { card: TypeCard, frame: DistrictFrame };
const EDGE_TYPES = { link: Link };

const frameNode = (frame: Frame): Node<FrameData> => ({
  id: frame.id,
  type: "frame",
  position: { x: frame.x, y: frame.y },
  width: frame.width,
  height: frame.height,
  // The sizes are fixed, so React Flow is told them rather than left to measure,
  // which on every rebuild of the node list dropped and re-measured every card.
  measured: { width: frame.width, height: frame.height },
  data: { name: frame.name, count: frame.count },
  selectable: false,
  focusable: false,
  zIndex: -1,
  // React Flow gives a node's wrapper pointer events whenever hover handlers are set,
  // which on a frame would swallow the clicks on empty space that clear the selection.
  style: { pointerEvents: "none" },
});

const cardNode = (
  card: Card,
  node: SchemaNode,
  data: Omit<CardData, "node" | "kind"> & { tabStop?: boolean }
): Node<CardData> => ({
  id: data.removed ? `removed:${card.id}` : card.id,
  type: "card",
  position: { x: card.x, y: card.y },
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  measured: { width: CARD_WIDTH, height: CARD_HEIGHT },
  ariaLabel: `${node.name}, ${node.isElement ? "Element Type" : "Document Type"}, ${cardCaption(node, data.removed)}`,
  selectable: !data.removed,
  focusable: data.tabStop === true,
  selected: data.state === "selected",
  data: { node, kind: card.kind, ...data },
});

/** The frames, the baseline's removed outlines and the cards, in that paint order. */
function useBoardNodes(
  layout: BoardLayout,
  { graph, baseline, scale, icons, selected, focus, layers }: StageProps,
  hovered: string | null
) {
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph]
  );
  const baselineById = useMemo(
    () => new Map((baseline?.nodes ?? []).map((node) => [node.id, node])),
    [baseline]
  );
  // A hovered card lights its neighbours as a selected one does, which is what
  // answers "what is this joined to" without a click. In focus the lit set is the
  // neighbourhood itself, so clicking through it does not dim the layout you are
  // standing in.
  const touching = hovered ?? (focus ? null : selected);
  const lit = useMemo(
    () =>
      touching
        ? litBy(boardEdges(graph.edges ?? [], layers, layout.shown), touching)
        : null,
    [graph, touching, layers, layout.shown]
  );
  return useMemo<Node[]>(() => {
    const fillOf = (id: string) => {
      const t = scale?.t.get(id);
      return scale && t !== undefined ? rampFill(scale.ramp, t) : undefined;
    };
    // One tab stop for the whole board, on the selection or else the first card in
    // reading order: tabbing through every card would put hundreds of stops between
    // the header and the footer. Search reaches any type from the keyboard.
    const tabStop = layout.cards.some((card) => card.id === selected)
      ? selected
      : layout.cards[0]?.id;
    const cards = layout.cards.flatMap((card) => {
      const node = nodesById.get(card.id);
      return node
        ? [
            cardNode(card, node, {
              fill: fillOf(card.id),
              lensOn: Boolean(scale),
              icon: icons?.[node.icon],
              state: cardState(card.id, selected, lit),
              tabStop: card.id === tabStop,
            }),
          ]
        : [];
    });
    const removed = layout.removed.flatMap((card) => {
      const node = baselineById.get(card.id);
      return node
        ? [cardNode(card, node, { state: "plain", removed: true })]
        : [];
    });
    return [...layout.frames.map(frameNode), ...removed, ...cards];
  }, [layout, nodesById, baselineById, scale, icons, selected, lit]);
}

/**
 * The switched-on layers' lines. Every line stays under the cards; the selection's
 * come last, so they paint over the faded ones rather than over the cards they
 * pass. A hover lights through Touching alone and leaves this list as it is.
 */
function useBoardEdges(
  graph: SchemaGraph,
  layout: BoardLayout,
  layers: StageProps["layers"],
  touching: string | null
) {
  return useMemo<Edge<LinkData>[]>(
    () =>
      litLast(
        boardEdges(graph.edges ?? [], layers, layout.shown),
        touching
      ).map((edge) => {
        const stroke = LAYER_TOKEN[edge.layer];
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "link",
          selectable: false,
          focusable: false,
          data: { stroke, dash: LAYER_DASH[edge.layer] },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: 14,
            height: 14,
          },
        };
      }),
    [graph.edges, layers, layout.shown, touching]
  );
}

/** The band the map's floating toolbar takes at the top of the board. */
const TOOLBAR_BAND = 56;

/**
 * Fits the board into its box below the toolbar, as far as it still reads. The
 * inspector docks beside the board rather than over it (data-docked in styles.css),
 * so the box is all there is to frame.
 */
function frameBoard(
  flow: ReactFlowInstance,
  area: HTMLElement,
  layout: BoardLayout,
  { focus, selected }: StageProps,
  duration: number
) {
  const board = boundsOf(layout);
  const open = {
    width: area.clientWidth,
    height: area.clientHeight - TOOLBAR_BAND,
  };
  const fitted = getViewportForBounds(
    board,
    open.width,
    open.height,
    READ_ZOOM,
    1,
    "48px"
  );
  // The focus, or else the selection, as on a page opened at a type, stays in view.
  const keep = focus ?? selected;
  const card = layout.cards.find((placed) => placed.id === keep);
  const view = readableView(fitted, board, card, open, 48);
  void flow.setViewport({ ...view, y: view.y + TOOLBAR_BAND }, glide(duration));
}

/**
 * Frames the board on first draw, on Home, and whenever what is on it changes, in
 * the room the inspector leaves. A new selection does not reframe: you clicked a
 * card you could already see. The layout knows every card's box, so this frames
 * that rather than waiting for React Flow to measure the cards.
 *
 * The board's box changes size too, when presentation goes full screen or the
 * backoffice's sidebar folds, and it fits again then, unless the reader has moved
 * the map since, which would throw their view away. Returns the handlers that tell
 * a reader's move from the board's own.
 */
function useFraming(
  flow: ReactFlowInstance,
  host: RefObject<HTMLElement | null>,
  layout: BoardLayout,
  props: StageProps
) {
  const { inspectorOpen, reframe = 0 } = props;
  const framed = useRef(false);
  const moved = useRef(false);
  // Whether the panel is docked, read when the board's box changes: the panel
  // opening or closing narrows or widens the board, which is no reason to reframe.
  const docked = useRef(inspectorOpen);
  useLayoutEffect(() => {
    docked.current = inspectorOpen;
  }, [inspectorOpen]);
  // The keys are what reframes, not everything the frame reads.
  useEffect(() => {
    const area = host.current;
    if (!area || layout.cards.length === 0) return;
    frameBoard(flow, area, layout, props, framed.current ? 300 : 0);
    framed.current = true;
    moved.current = false;
  }, [flow, reframe, layout]);
  useEffect(() => {
    const area = host.current;
    if (!area || layout.cards.length === 0) return;
    let size = `${area.clientWidth}x${area.clientHeight}`;
    let panel = docked.current;
    const observer = new ResizeObserver(() => {
      const before = size;
      const panelMoved = panel !== docked.current;
      size = `${area.clientWidth}x${area.clientHeight}`;
      panel = docked.current;
      if (size !== before && !(moved.current || panelMoved))
        frameBoard(flow, area, layout, props, 0);
    });
    observer.observe(area);
    // The Overview moves the map with no event of its own (see below).
    const onOverview = (event: Event) => {
      if ((event.target as Element).closest(".react-flow__minimap"))
        moved.current = true;
    };
    area.addEventListener("pointerdown", onOverview);
    area.addEventListener("wheel", onOverview);
    return () => {
      observer.disconnect();
      area.removeEventListener("pointerdown", onOverview);
      area.removeEventListener("wheel", onOverview);
    };
  }, [flow, host, layout]);
  // React Flow passes the event only for a drag or scroll on the board itself. The
  // arrow keys say so through readerMoved, and the Overview through its listener.
  const onMoveStart = useCallback((event: unknown) => {
    if (event) moved.current = true;
  }, []);
  const readerMoved = useCallback(() => {
    moved.current = true;
  }, []);
  return { onMoveStart, readerMoved };
}

/**
 * A card selected under the inspector slides out from beneath it. One already in
 * the open stays where it is. A new selection or the panel opening is what moves
 * the view, so those are the keys.
 */
function useReveal(
  flow: ReactFlowInstance,
  host: RefObject<HTMLElement | null>,
  layout: BoardLayout,
  { selected, inspectorOpen = false }: StageProps
) {
  // A layout change reframes in the same update (useFraming), and a reveal measured
  // against the old view would cancel that move halfway, so it stands aside.
  const framedLayout = useRef(layout);
  useEffect(() => {
    const relaid = framedLayout.current !== layout;
    framedLayout.current = layout;
    const card = layout.cards.find((each) => each.id === selected);
    if (!relaid && card) reveal(flow, host.current, card);
  }, [selected, inspectorOpen, layout]);
}

/** Slides the view so `card` is in it, when the narrowed board has cut it off. */
function reveal(flow: ReactFlowInstance, area: HTMLElement | null, card: Card) {
  if (!area) return;
  const viewport = flow.getViewport();
  const size = { width: area.clientWidth, height: area.clientHeight };
  const centre = revealCentre(card, viewport, size);
  if (centre)
    void flow.setCenter(centre.x, centre.y, {
      zoom: viewport.zoom,
      ...glide(300),
    });
}

/** Arrow keys pan and + and - zoom while a card on the board has focus. */
function onBoardKey(flow: ReactFlowInstance, event: globalThis.KeyboardEvent) {
  const move = keyMove(event);
  if (!move) return false;
  event.preventDefault();
  const nudge = glide(move.duration);
  if ("pan" in move) {
    const { x, y, zoom } = flow.getViewport();
    void flow.setViewport(
      { x: x + move.pan.x, y: y + move.pan.y, zoom },
      nudge
    );
  } else void flow[move.zoom === "in" ? "zoomIn" : "zoomOut"](nudge);
  return true;
}

/**
 * Arrow keys pan and + and - zoom from anywhere the City's keys would fly from: the
 * board or the page with nothing focused. On the window, as the City listens, so
 * the keys still work after a focus change drops the keyboard on the page.
 */
function useBoardKeys(
  flow: ReactFlowInstance,
  host: RefObject<HTMLElement | null>,
  readerMoved: () => void
) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const [from] = event.composedPath();
      if (
        boardOwnsKey(from as Element, host.current) &&
        onBoardKey(flow, event)
      )
        readerMoved();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, host, readerMoved]);
}

/**
 * Enter on a card not selected yet only selects it, and Escape on a card keeps
 * focus on the board (cardKey). This runs on the board, after React Flow's own
 * handler on the card and before App's on the window, which stands down for a key
 * already taken.
 */
function onCardKey(event: KeyboardEvent<HTMLElement>, selected: string | null) {
  const card = (event.target as Element)
    .closest(".react-flow__node-card")
    ?.getAttribute("data-id");
  const action = cardKey(event.key, card, selected);
  if (action === "select") event.preventDefault();
  const board = event.currentTarget;
  // After the blur React Flow queued for the next frame.
  if (action === "refocus") requestAnimationFrame(() => board.focus());
}

/**
 * The overview and the focus note. The overview sits bottom right, clear of the
 * canvas keys App puts on the left; the inspector docks beside the board, so it
 * never covers it. The note sits bottom left, clear of the lens key top left; only
 * the comparison key, there while a baseline is loaded, shares it.
 */
function BoardOverlays({
  focus,
  graph,
}: {
  focus: string | null;
  graph: SchemaGraph;
}) {
  return (
    <>
      <MiniMap
        ariaLabel="Overview"
        nodeColor={minimapColour}
        pannable
        position="bottom-right"
        style={MINIMAP_STYLE}
        zoomable
      />
      {focus ? <FocusNote focus={focus} graph={graph} /> : null}
    </>
  );
}

/**
 * The map's tools, floating over the top of the board. A board too narrow for them
 * in one row, as beside the docked panel on a small screen, folds them into one
 * button (styles.css), as the footer does for the City.
 */
function BoardToolbar({ children }: { children: ReactNode }) {
  return (
    <Panel
      aria-label="Map tools"
      className="board-toolbar in-data-present:hidden"
      position="top-left"
      role="group"
    >
      <div className="board-tools">{children}</div>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              className="board-tools-fold"
              data-trigger
              size="sm"
              variant="outline"
            />
          }
        >
          Map tools
        </PopoverTrigger>
        <PopoverContent
          aria-label="Map tools"
          className="flex w-64 flex-col items-start gap-3 p-3"
        >
          {children}
        </PopoverContent>
      </Popover>
    </Panel>
  );
}

/** The line over a focus, naming the type it is gathered round. */
function FocusNote({ graph, focus }: { graph: SchemaGraph; focus: string }) {
  const name = graph.nodes.find((node) => node.id === focus)?.name;
  return (
    <Panel className="board-note" position="bottom-left">
      Showing {name ?? "the type"} and what it is joined to
    </Panel>
  );
}

/** The board for App's state, laid out again only when what it shows changes. */
const useLayout = ({
  graph,
  grouping,
  baseline,
  comparison,
  focus,
  focusDepth,
}: StageProps) =>
  useMemo(
    () =>
      boardLayout({ graph, grouping, baseline, comparison, focus, focusDepth }),
    [graph, grouping, baseline, comparison, focus, focusDepth]
  );

const PRO_OPTIONS = { hideAttribution: true };
const MINIMAP_STYLE = { width: 160, height: 104 };
const minimapColour = (node: Node) =>
  node.type === "frame" ? "transparent" : "var(--line-strong)";

/**
 * React Flow's handlers, stable across renders. App hands over fresh callbacks each
 * render, and a new handler on ReactFlow re-renders every node, so these read the
 * latest ones through a ref. Hovering a card while another is selected changes
 * nothing on the board, so it does not set state either.
 */
/**
 * Whether the inspector, docking for `id` now, would cover that card where it stands
 * on screen (panelCovers).
 */
function coveredOnOpen(
  flow: ReactFlowInstance,
  area: HTMLElement | null,
  id: string,
  panelOpen?: boolean
) {
  const node = flow.getInternalNode(id);
  if (!(node && area)) return false;
  const { x, zoom } = flow.getViewport();
  const right = (node.internals.positionAbsolute.x + CARD_WIDTH) * zoom + x;
  const width = area.clientWidth;
  return panelCovers(right, width, inspectorWidthFor(width), panelOpen);
}

function useFlowHandlers(
  flow: ReactFlowInstance,
  host: RefObject<HTMLElement | null>,
  props: StageProps,
  setHovered: (id: string | null) => void
) {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  // A pick the docking panel would cover waits out a double-click, so the second
  // press lands on the card and focuses rather than on the panel that took its
  // place. Every other pick is at once.
  const waiting = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(waiting.current), []);
  return useMemo(() => {
    const pick = (id: string) => {
      const select = () => latest.current.onSelect(id);
      clearTimeout(waiting.current);
      if (coveredOnOpen(flow, host.current, id, latest.current.inspectorOpen))
        waiting.current = setTimeout(select, DOUBLE_CLICK_MS);
      else select();
    };
    return {
      // Selection is App's. A click or Enter on a card arrives here as a select
      // change, and App decides; nothing is applied locally.
      onNodesChange: (changes: NodeChange[]) => {
        for (const id of picked(changes)) pick(id);
      },
      onNodeDoubleClick: (_: unknown, node: Node) => {
        clearTimeout(waiting.current);
        if (node.selectable) latest.current.onFocus(node.id);
      },
      onNodeMouseEnter: (_: unknown, node: Node) => {
        if (node.selectable && !latest.current.selected) setHovered(node.id);
      },
      onNodeMouseLeave: () => setHovered(null),
      onPaneClick: () => latest.current.onSelect(null),
    };
  }, [flow, host, setHovered]);
}

function BoardView(props: StageProps) {
  const { graph, focus, layers, textScale = 1 } = props;
  const host = useRef<HTMLElement>(null);
  const flow = useReactFlow();
  const [hovered, setHovered] = useState<string | null>(null);
  const [band, setBand] = useState<ZoomBand>("near");

  const layout = useLayout(props);
  const nodes = useBoardNodes(layout, props, hovered);
  const edges = useBoardEdges(graph, layout, layers, props.selected);
  const handlers = useFlowHandlers(flow, host, props, setHovered);
  const { onMoveStart, readerMoved } = useFraming(flow, host, layout, props);
  useReveal(flow, host, layout, props);
  useBoardKeys(flow, host, readerMoved);

  // The zoom goes to CSS as well, where the district names hold their size on
  // screen. Written to the style directly: a React update per frame of a pan would
  // re-render every card.
  const onMove = useCallback((_: unknown, viewport: Viewport) => {
    host.current?.style.setProperty("--zoom", String(viewport.zoom));
    setBand(zoomBand(viewport.zoom));
  }, []);

  return (
    // The board is where the keyboard goes back to when the inspector closes, and a
    // type picked on it keeps focus here rather than on the inspector (a11y.tsx),
    // so the arrow keys keep moving the map. A named region, as the City's is.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Enter arrives from the focused card inside, which is the interactive element.
    <section
      aria-label="Schema map. Arrow keys pan, plus and minus zoom. Press ? for all controls."
      className="board h-full w-full outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
      data-docked={props.inspectorOpen ? "" : undefined}
      data-focus-home
      data-keeps-focus
      data-zoom={band}
      onKeyDown={(event) => onCardKey(event, props.selected)}
      ref={host}
      style={{ "--board-text": textScale } as CSSProperties}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the board takes keys, so a keyboard has to be able to reach it.
      tabIndex={0}
    >
      <Touching value={props.selected ?? hovered}>
        <ReactFlow
          aria-label="Schema map"
          ariaLabelConfig={ARIA_LABELS}
          deleteKeyCode={null}
          edges={edges}
          edgeTypes={EDGE_TYPES}
          elementsSelectable
          maxZoom={2.5}
          minZoom={MIN_ZOOM}
          multiSelectionKeyCode={null}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodeTypes={NODE_TYPES}
          onMove={onMove}
          onMoveStart={onMoveStart}
          proOptions={PRO_OPTIONS}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}
          {...handlers}
        >
          <Background gap={24} size={1.2} />
          <BoardOverlays focus={focus} graph={graph} />
          {props.toolbar ? <BoardToolbar>{props.toolbar}</BoardToolbar> : null}
        </ReactFlow>
      </Touching>
    </section>
  );
}

export default function Board(props: StageProps) {
  return (
    <ReactFlowProvider>
      <BoardView {...props} />
    </ReactFlowProvider>
  );
}
