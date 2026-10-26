// The flat board's geometry: the City's own districts and rows, packed tight, so a
// type keeps its district and its depth when you switch variants. Within a row the
// cards are ordered by what they connect to, so the lines cross as little as they
// can. Pure: no React Flow, no DOM, so the tests run it on the fixtures.
import type {
  DistrictKind,
  Grouping,
  Placement,
} from "@schema-city/core/layout/city";
import { stageCity } from "@schema-city/core/layout/comparison";
import { focusedLayout } from "@schema-city/core/layout/expanded-focus";
import { neighbourhoods } from "@schema-city/core/model/neighbourhood";
import { reachableWithin } from "@schema-city/core/model/reach";
import type { SchemaComparison } from "@schema-city/core/model/snapshots";
import type {
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
} from "@schema-city/core/model/types";
import { LAYER_OF, type Layer } from "@schema-city/core/scene/layers";
import type { Ramp } from "@schema-city/core/scene/lens";

export const CARD_WIDTH = 224;
/** Tall enough for a name on two lines over its caption and size bar. */
export const CARD_HEIGHT = 68;
const GAP_X = 20;
/** Between rows that are not levels, as the focused neighbourhood's are. */
const GAP_Y = 36;
/** Between the lines of one level when it wraps, tighter than between levels. */
const WRAP_GAP = 20;
/** Above a level's label, and the label's own height, so levels read apart. */
const LEVEL_GAP = 24;
export const LEVEL_LABEL = 28;
/** Cards a row holds before it wraps, so a type with forty children stays on screen. */
const ROW_LIMIT = 6;
/** Two placements this close in depth, in layout units, stand in one row. */
const SAME_ROW = 1.5;
const DISTRICT_GAP = 72;
/** Room round a district's cards. Its name stands above the frame, in the gap. */
const FRAME_PAD = 20;

export type Card = { id: string; x: number; y: number; kind: DistrictKind };

export type Frame = {
  id: string;
  name: string;
  /** How many of the current schema's types the frame holds. */
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A district's level: its label and the line it draws across, in the gap above. */
export type Level = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
};

export type BoardLayout = {
  cards: Card[];
  frames: Frame[];
  /** The levels' labels, over the districts laid out by depth. */
  levels: Level[];
  /** Where the baseline's removed types stood, for their outlines. */
  removed: Card[];
  /** The types on the board: everything, or the focused neighbourhood. */
  shown: ReadonlySet<string> | null;
};

type Block = {
  cards: Card[];
  width: number;
  height: number;
  levels: { label: string; y: number }[];
};

const PITCH = CARD_WIDTH + GAP_X;
/** Down and up the rows this many times, which is where the crossings stop falling. */
const PASSES = 4;

/**
 * Rows split into lines of at most ROW_LIMIT cards, so a long row wraps: cut into
 * runs, or dealt across its lines like cards round a table, so a card early in the
 * row stands to the left on whichever line it lands. untangle tries both.
 */
const wrap = (rows: string[][], deal: boolean) =>
  rows.flatMap((row) => {
    const count = Math.ceil(row.length / ROW_LIMIT);
    return Array.from({ length: count }, (_, line) =>
      deal
        ? row.filter((_card, at) => at % count === line)
        : row.slice(line * ROW_LIMIT, (line + 1) * ROW_LIMIT)
    );
  });

/** Each card's left edge once its line is centred on the widest, as compact lays them. */
function across(lines: string[][]): Map<string, number> {
  const widest = Math.max(...lines.map((line) => line.length));
  const x = new Map<string, number>();
  for (const line of lines) {
    const left = ((widest - line.length) * PITCH) / 2;
    for (const [column, id] of line.entries()) x.set(id, left + column * PITCH);
  }
  return x;
}

type Spot = { x: number; y: number };

/** Each card's corner: across from its line's centring, down from its line. */
function spots(lines: string[][]): Map<string, Spot> {
  const x = across(lines);
  return new Map(
    lines.flatMap((line, index) =>
      line.map((id) => [
        id,
        { x: x.get(id) ?? 0, y: index * (CARD_HEIGHT + GAP_Y) },
      ])
    )
  );
}

const turn = (a: Spot, b: Spot, c: Spot) =>
  Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

const crosses = (a: Spot, b: Spot, c: Spot, d: Spot) =>
  turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;

/** Whether the line from `a` to `b` runs over the card cornered at `card`. */
function over(a: Spot, b: Spot, card: Spot) {
  for (let k = 1; k < 16; k++) {
    const x = a.x + ((b.x - a.x) * k) / 16 + CARD_WIDTH / 2;
    const y = a.y + ((b.y - a.y) * k) / 16 + CARD_HEIGHT / 2;
    if (
      x > card.x &&
      x < card.x + CARD_WIDTH &&
      y > card.y &&
      y < card.y + CARD_HEIGHT
    )
      return true;
  }
  return false;
}

/**
 * How tangled `lines` draw: the pairs of lines that cross, plus the cards a line
 * runs over without joining. Lines are taken straight between the cards, which
 * is near enough to the curves drawn to rank one order against another.
 */
export function tangle(
  lines: string[][],
  links: readonly [string, string][]
): number {
  const at = spots(lines);
  const placed = links.flatMap(([from, to]) => {
    const a = at.get(from);
    const b = at.get(to);
    return a && b ? [{ from, to, a, b }] : [];
  });
  let count = 0;
  for (const [i, one] of placed.entries()) {
    for (const other of placed.slice(i + 1)) {
      const shared = [one.from, one.to].some(
        (id) => id === other.from || id === other.to
      );
      if (!shared && crosses(one.a, one.b, other.a, other.b)) count++;
    }
    for (const [id, card] of at)
      if (id !== one.from && id !== one.to && over(one.a, one.b, card)) count++;
  }
  return count;
}

/** One pass of untangle: each row in turn, down or up, under its neighbours' middle. */
function sweep(
  rows: string[][],
  near: ReadonlyMap<string, string[]>,
  rowOf: ReadonlyMap<string, number>,
  down: boolean,
  deal: boolean
) {
  const ordered = rows.map((row) => [...row]);
  for (let step = 1; step < ordered.length; step++) {
    const r = down ? step : ordered.length - 1 - step;
    const x = across(wrap(ordered, deal));
    const side = (other: string) =>
      down ? (rowOf.get(other) ?? r) < r : (rowOf.get(other) ?? r) > r;
    const key = new Map(
      ordered[r].map((id) => {
        const linked = (near.get(id) ?? []).filter(side);
        const mean =
          linked.reduce((sum, other) => sum + (x.get(other) ?? 0), 0) /
          linked.length;
        return [id, linked.length ? mean : (x.get(id) ?? 0)];
      })
    );
    ordered[r].sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0));
  }
  return ordered;
}

/**
 * Orders each row by where the cards it connects to stand, so lines cross less:
 * a card moves under the middle of its neighbours in the rows above, then over the
 * middle of those below, back and forth. A card with no neighbours that side keeps
 * its place. Rows themselves do not move, so a type keeps the City's depth. Each
 * pass is scored (tangle) and the least tangled wins, the City's own order cut
 * into runs included, which is how the board stood before, so this never makes a
 * district worse. Returns the rows as wrapped lines.
 */
export function untangle(
  rows: string[][],
  edges: readonly { from: string; to: string; kind: string }[]
): string[][] {
  const rowOf = new Map(rows.flatMap((row, r) => row.map((id) => [id, r])));
  const inside = edges.filter(
    ({ from, to, kind }) =>
      kind !== "inherits" && from !== to && rowOf.has(from) && rowOf.has(to)
  );
  // Structure is what the plan draws first, so its lines decide the order; a
  // district with none, such as the Elements, is ordered by the rest.
  const structure = inside.filter(({ kind }) => kind === "allowedChild");
  const near = new Map<string, string[]>();
  const links: [string, string][] = [];
  for (const { from, to } of structure.length > 0 ? structure : inside) {
    near.set(from, [...(near.get(from) ?? []), to]);
    near.set(to, [...(near.get(to) ?? []), from]);
    links.push([from, to]);
  }
  let best = wrap(rows, false);
  let bestScore = tangle(best, links);
  for (const deal of [false, true]) {
    let ordered = rows;
    for (let pass = 0; pass <= PASSES; pass++) {
      if (pass > 0) ordered = sweep(ordered, near, rowOf, pass % 2 === 1, deal);
      const lines = wrap(ordered, deal);
      const score = tangle(lines, links);
      if (score < bestScore) {
        best = lines;
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Each type's level in its district, as editors create content: the types allowed
 * at root on the first, then each allowed-child step below them, counted inside the
 * district. A district with no root, such as the Compositions, is one level and
 * carries no labels; so is one whose types all stand on one level. A type no root
 * here leads to stands on a last level of its own. Order within a level is kept.
 */
export function levelRows(
  ids: readonly string[],
  edges: readonly { from: string; to: string; kind: string }[],
  roots: ReadonlySet<string>
): { rows: string[][]; labels: string[] | null } {
  const depth = depthsFrom(
    ids.filter((id) => roots.has(id)),
    childrenWithin(ids, edges)
  );
  const levels = depth.size === 0 ? 0 : Math.max(...depth.values()) + 1;
  const rows = Array.from({ length: levels }, (_, level) =>
    ids.filter((id) => depth.get(id) === level)
  );
  const stray = ids.filter((id) => !depth.has(id));
  if (stray.length > 0) rows.push(stray);
  if (rows.length < 2) return { rows, labels: null };
  const labels = rows.map((_, level) => `Level ${level + 1}`);
  if (stray.length > 0) labels[labels.length - 1] = "Not below a root here";
  return { rows, labels };
}

/** Each type's allowed children among `ids`. */
function childrenWithin(
  ids: readonly string[],
  edges: readonly { from: string; to: string; kind: string }[]
) {
  const inside = new Set(ids);
  const children = new Map<string, string[]>();
  for (const { from, to, kind } of edges)
    if (kind === "allowedChild" && from !== to && inside.has(to))
      children.set(from, [...(children.get(from) ?? []), to]);
  return children;
}

/** Steps from the nearest start, walking the children breadth first. */
function depthsFrom(
  starts: readonly string[],
  children: ReadonlyMap<string, string[]>
) {
  const depth = new Map(starts.map((id) => [id, 0]));
  let frontier = [...starts];
  while (frontier.length > 0) {
    frontier = frontier.flatMap((id) =>
      (children.get(id) ?? []).filter((child) => {
        if (depth.has(child)) return false;
        depth.set(child, (depth.get(id) ?? 0) + 1);
        return true;
      })
    );
  }
  return depth;
}

/** Placements in the City's rows, top to bottom, each row left to right. */
function cityRows(placements: Placement[]): string[][] {
  const sorted = [...placements].sort(
    (a, b) => a.position.z - b.position.z || a.position.x - b.position.x
  );
  const rows: Placement[][] = [];
  for (const placement of sorted) {
    const row = rows[rows.length - 1];
    if (row && placement.position.z - row[0].position.z <= SAME_ROW)
      row.push(placement);
    else rows.push([placement]);
  }
  return rows.map((row) =>
    row
      .sort((a, b) => a.position.x - b.position.x)
      .map((placement) => placement.id)
  );
}

/**
 * Where each wrapped line stands down the block, and the levels' labels: a line
 * of the same level as the one before follows close, a new level opens after a
 * wider gap, under its label when the rows are levels.
 */
export function lineTops(
  lineLevels: readonly number[],
  labels: readonly string[] | null
) {
  const tops: number[] = [];
  const levels: { label: string; y: number }[] = [];
  let y = 0;
  for (const [index, level] of lineLevels.entries()) {
    const opens = index === 0 || lineLevels[index - 1] !== level;
    if (index > 0) y += opens ? (labels ? LEVEL_GAP : GAP_Y) : WRAP_GAP;
    if (opens && labels) {
      levels.push({ label: labels[level] ?? "", y });
      y += LEVEL_LABEL;
    }
    tops.push(y);
    y += CARD_HEIGHT;
  }
  return { tops, levels, height: y };
}

/**
 * Rows of cards at a card's pitch, each row ordered to cross as few lines as it
 * can (untangle) and wrapped where it is long. The City spaces buildings for a
 * camera flying between them, which on a flat sheet left cards a few pixels wide
 * once the whole schema was in view.
 */
function compact(
  rows: string[][],
  kinds: ReadonlyMap<string, DistrictKind>,
  edges: readonly SchemaEdge[],
  labels: string[] | null = null
): Block {
  const lines = untangle(rows, edges);
  const levelOf = new Map(
    rows.flatMap((row, level) => row.map((id) => [id, level]))
  );
  const { tops, levels, height } = lineTops(
    lines.map((line) => levelOf.get(line[0] ?? "") ?? 0),
    labels
  );
  const x = across(lines);
  const cards = lines.flatMap((line, index) =>
    line.map((id) => ({
      id,
      x: x.get(id) ?? 0,
      y: tops[index] ?? 0,
      kind: kinds.get(id) ?? "mixed",
    }))
  );
  return {
    cards,
    width: Math.max(...lines.map((line) => line.length)) * PITCH - GAP_X,
    height,
    levels,
  };
}

const kindsOf = (placements: Placement[]) =>
  new Map(placements.map((at) => [at.id, at.districtKind]));

/**
 * Districts in the City's reading order, top to bottom and left to right, packed
 * onto shelves about as wide as the whole board is tall, so the sheet fits a screen.
 */
function shelve(blocks: (Block & { order: [number, number] })[]) {
  const sorted = [...blocks].sort(
    (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]
  );
  const area = sorted.reduce(
    (sum, block) =>
      sum + (block.width + DISTRICT_GAP) * (block.height + DISTRICT_GAP),
    0
  );
  const limit = Math.max(
    ...sorted.map((block) => block.width),
    Math.sqrt(area) * 1.6
  );
  const at = new Map<Block, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const block of sorted) {
    if (x > 0 && x + block.width > limit) {
      x = 0;
      y += shelf + DISTRICT_GAP;
      shelf = 0;
    }
    at.set(block, { x, y });
    x += block.width + DISTRICT_GAP;
    shelf = Math.max(shelf, block.height);
  }
  return at;
}

const moved = (cards: Card[], by: { x: number; y: number }) =>
  cards.map((card) => ({ ...card, x: card.x + by.x, y: card.y + by.y }));

/**
 * The board for what App asks: the whole schema in districts, the baseline's layout
 * while comparing, or the focused neighbourhood alone, gathered as the City gathers
 * it round the focused type.
 */
export function boardLayout({
  graph,
  grouping = "structure",
  baseline,
  comparison,
  focus,
  focusDepth = 1,
}: {
  graph: SchemaGraph;
  grouping?: Grouping;
  baseline?: SchemaGraph | null;
  comparison?: SchemaComparison | null;
  focus: string | null;
  focusDepth?: number;
}): BoardLayout {
  const city = stageCity(graph, grouping, baseline, comparison);
  const neighbourhood = focus ? neighbourhoods(graph).get(focus) : undefined;
  if (focus && neighbourhood) {
    const laid = focusedLayout(
      graph,
      neighbourhood,
      focus,
      city.placements,
      focusDepth
    );
    const shown = reachableWithin(graph, focus, focusDepth);
    const held = laid.filter((at) => shown.has(at.id));
    const { cards } = compact(cityRows(held), kindsOf(held), graph.edges ?? []);
    return { cards, frames: [], levels: [], removed: [], shown };
  }

  const removedIds = new Set(city.removed.map((at) => at.id));
  const all = [...city.placements, ...city.removed];
  // Levels count allowed-child steps, so they mean something only when districts
  // are cut by what editors can create. Both schemas' links and roots, so a removed
  // type keeps the level it stood on.
  const edges = [...(graph.edges ?? []), ...(baseline?.edges ?? [])];
  const roots = new Set(
    [...graph.nodes, ...(baseline?.nodes ?? [])]
      .filter((node) => node.allowedAsRoot)
      .map((node) => node.id)
  );
  const blocks = city.districts.flatMap((district) => {
    const held = all.filter((at) => at.district === district.id);
    if (held.length === 0) return [];
    const rows = cityRows(held);
    const { rows: levelled, labels } =
      grouping === "structure"
        ? levelRows(rows.flat(), edges, roots)
        : { rows, labels: null };
    const block = compact(levelled, kindsOf(held), graph.edges ?? [], labels);
    return [
      {
        ...block,
        district,
        width: block.width + FRAME_PAD * 2,
        height: block.height + FRAME_PAD * 2,
        order: [district.minZ, district.minX] as [number, number],
      },
    ];
  });
  const corners = shelve(blocks);
  const cornerOf = (block: (typeof blocks)[number]) =>
    corners.get(block) ?? { x: 0, y: 0 };
  // Cards come out shelf by shelf and row by row, so the order a keyboard or a
  // screen reader meets them in is the order the board reads in.
  const reading = [...blocks].sort(
    (a, b) => cornerOf(a).y - cornerOf(b).y || cornerOf(a).x - cornerOf(b).x
  );
  const cards: Card[] = [];
  const frames: Frame[] = [];
  const levels: Level[] = [];
  for (const block of reading) {
    const corner = cornerOf(block);
    levels.push(
      ...block.levels.map((level) => ({
        id: `level:${block.district.id}:${level.label}`,
        label: level.label,
        x: corner.x + FRAME_PAD,
        y: corner.y + FRAME_PAD + level.y,
        width: block.width - FRAME_PAD * 2,
      }))
    );
    frames.push({
      id: `district:${block.district.id}`,
      name: block.district.name,
      count: block.cards.filter((card) => !removedIds.has(card.id)).length,
      ...corner,
      width: block.width,
      height: block.height,
    });
    cards.push(
      ...moved(block.cards, {
        x: corner.x + FRAME_PAD,
        y: corner.y + FRAME_PAD,
      })
    );
  }
  return {
    cards: cards.filter((card) => !removedIds.has(card.id)),
    frames,
    levels,
    removed: cards.filter((card) => removedIds.has(card.id)),
    shown: null,
  };
}

/**
 * The edges the switched-on layers draw, between types on the board. `inherits`
 * repeats a composition the graph already has, so it is left to that one.
 */
export function boardEdges(
  edges: readonly SchemaEdge[],
  layers: readonly Layer[],
  shown: ReadonlySet<string> | null
): (SchemaEdge & { layer: Layer; id: string })[] {
  const on = new Set(layers);
  const seen = new Set<string>();
  return edges.flatMap((edge) => {
    if (edge.kind === "inherits" || edge.from === edge.to) return [];
    const layer = LAYER_OF[edge.kind];
    if (!on.has(layer)) return [];
    if (shown && !(shown.has(edge.from) && shown.has(edge.to))) return [];
    // Two properties offering the same block draw one line, not two on top.
    const id = `${edge.kind}:${edge.from}:${edge.to}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ ...edge, layer, id }];
  });
}

/**
 * Each layer's stroke pattern, so a relationship never depends on its colour alone:
 * references dashed and blocks dotted beside the solid structure and composition
 * lines, whose colours are furthest apart.
 */
export const LAYER_DASH: Record<Layer, string | undefined> = {
  structure: undefined,
  compositions: undefined,
  blocks: "1 3",
  references: "5 4",
};

/**
 * The selected type and every type a drawn line joins it to. The board lights
 * exactly what its lines show, rather than every relation of every kind, which lit
 * cards the reader could not see a reason for.
 */
export function litBy(
  edges: readonly { from: string; to: string }[],
  selected: string
): Set<string> {
  const lit = new Set([selected]);
  for (const edge of edges) {
    if (edge.from === selected) lit.add(edge.to);
    if (edge.to === selected) lit.add(edge.from);
  }
  return lit;
}

/** Each layer's colour token, the same the City draws its links in. */
export const LAYER_TOKEN: Record<Layer, string> = {
  structure: "var(--structure)",
  compositions: "var(--azure)",
  blocks: "var(--amber)",
  references: "var(--violet)",
};

const mix = (from: string, to: string, t: number) =>
  `color-mix(in oklab, var(${from}), var(${to}) ${Math.round(t * 100)}%)`;

/**
 * Where a card lands on the lens's ramp, as CSS. The City's ramps: amber to azure
 * both ways, with the dim tone as the diverging middle and the quiet end, because
 * the accent against signal is the pair colour-vision deficiency ruins.
 */
export function rampFill(ramp: Ramp, t: number): string {
  if (ramp === "binary")
    return t >= 0.5 ? "var(--signal)" : "var(--phosphor-dim)";
  // The City's change steps: a side effect is the cause's amber pushed most of the
  // way into the background, and an unchanged type the dim tone pushed as far.
  if (ramp === "change") {
    if (t >= 1) return "var(--azure)";
    if (t >= 0.75) return "var(--amber)";
    if (t >= 0.5) return mix("--amber", "--background", 0.72);
    return mix("--phosphor-dim", "--background", 0.7);
  }
  if (ramp === "sequential") return mix("--amber", "--azure", t);
  return t < 0.5
    ? mix("--amber", "--phosphor-dim", t * 2)
    : mix("--phosphor-dim", "--azure", (t - 0.5) * 2);
}

/** Everything on the board, frames and outlines included, as one box. */
export function boundsOf(layout: BoardLayout): Box {
  const boxes = [
    ...layout.frames,
    ...[...layout.cards, ...layout.removed].map((card) => ({
      ...card,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    })),
  ];
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

export type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

const centreOf = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** How far in from a card's corner a line may leave or arrive. */
const LINK_INSET = 16;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/**
 * The curve a line takes between two cards, as an SVG path. Between rows it leaves
 * the bottom of the upper card and arrives at the top of the lower one, each end
 * slid along its edge towards the other card, so a type's lines spread along its
 * edge and fall straight where they can rather than radiating from one point.
 * Within a row it runs side to side.
 */
export function linkPath(from: Box, to: Box): string {
  const a = centreOf(from);
  const b = centreOf(to);
  if (to.y >= from.y + from.height || to.y + to.height <= from.y) {
    const down = b.y > a.y;
    const sx = clamp(
      b.x,
      from.x + LINK_INSET,
      from.x + from.width - LINK_INSET
    );
    const ex = clamp(a.x, to.x + LINK_INSET, to.x + to.width - LINK_INSET);
    const sy = down ? from.y + from.height : from.y;
    const ey = down ? to.y : to.y + to.height;
    const bend = (ey - sy) / 2;
    return `M ${sx},${sy} C ${sx},${sy + bend} ${ex},${ey - bend} ${ex},${ey}`;
  }
  const rightward = b.x > a.x;
  const sx = rightward ? from.x + from.width : from.x;
  const ex = rightward ? to.x : to.x + to.width;
  const bend = (ex - sx) / 2;
  return `M ${sx},${a.y} C ${sx + bend},${a.y} ${ex - bend},${b.y} ${ex},${b.y}`;
}

export type CardState = "plain" | "selected" | "lit" | "faded";

/**
 * A card with a selection on the board: the selected one, its neighbours lit, the
 * rest faded. `lit` is null in focus, where the whole board is the neighbourhood.
 */
export function cardState(
  id: string,
  selected: string | null,
  lit: ReadonlySet<string> | null
): CardState {
  if (id === selected) return "selected";
  if (!lit) return "plain";
  return lit.has(id) ? "lit" : "faded";
}

/** A line touching the selected or hovered card is lit, the others fade. */
export function linkState(
  edge: { from: string; to: string },
  touching: string | null
): "plain" | "lit" | "faded" {
  if (!touching) return "plain";
  return edge.from === touching || edge.to === touching ? "lit" : "faded";
}

/** A card's accent: the district's colour, as the City paints its buildings. */
const KIND_TOKEN: Record<DistrictKind, string> = {
  structure: "var(--phosphor)",
  compositions: "var(--phosphor-dim)",
  mixed: "var(--phosphor-dim)",
  elements: "var(--amber)",
};

/**
 * A card's colours: the accent its icon tile is drawn in, the tile's tint, and with
 * a lens on, a light wash of the lens's colour over the whole card.
 */
export function cardLook(kind: DistrictKind, fill?: string) {
  const accent = fill ?? KIND_TOKEN[kind];
  return {
    accent,
    tile: `color-mix(in oklab, ${accent} 16%, var(--panel))`,
    wash: fill && `color-mix(in oklab, ${fill} 8%, var(--panel))`,
  };
}

/** The edges with the ones touching `touching` moved to the end, in order otherwise. */
export function litLast<Edge extends { from: string; to: string }>(
  edges: Edge[],
  touching: string | null
): Edge[] {
  if (!touching) return edges;
  const lit = (edge: Edge) => linkState(edge, touching) === "lit";
  return [...edges.filter((edge) => !lit(edge)), ...edges.filter(lit)];
}

/**
 * The line under a card's name: how many properties the type has, with Element
 * Types named as such. A Document Type is what a card is unless it says otherwise,
 * and the full words did not fit beside the icon.
 */
/** Properties that fill a card's size bar: a little over the largest real types. */
const BAR_CAP = 32;
/** Groups a bar still draws one by one; past this the gaps would outweigh them. */
const BAR_SEGMENTS = 12;

/**
 * A card's size bar, the flat board's stand-in for the City's floors and footprint:
 * one segment per property group, each as long as the properties it holds, so the
 * bar's length says how big the type is and its segments how many groups. A group
 * from a composition is marked, as the City draws composed floors apart. An empty
 * group still shows as a sliver. Past BAR_CAP the bar fills the card and the
 * segments share it. Past BAR_SEGMENTS groups the gaps between them would read as a
 * dotted line, so the bar draws two stretches, own and composed, and the tooltip
 * says how many groups.
 */
export function sizeBar(node: Pick<SchemaNode, "groups">) {
  const groups = node.groups ?? [];
  const each = groups.map((group) => ({
    id: group.id,
    share: Math.max(group.properties.length, 0.5) / BAR_CAP,
    composed: group.fromCompositionId !== null,
  }));
  const segments =
    each.length > BAR_SEGMENTS
      ? [false, true].flatMap((composed) => {
          const share = each
            .filter((segment) => segment.composed === composed)
            .reduce((sum, segment) => sum + segment.share, 0);
          return share > 0
            ? [{ id: composed ? "composed" : "own", share, composed }]
            : [];
        })
      : each;
  const total = segments.reduce((sum, segment) => sum + segment.share, 0);
  return total > 1
    ? segments.map((segment) => ({ ...segment, share: segment.share / total }))
    : segments;
}

/** The tooltip's second line: groups and properties, as the bar draws them. */
export function sizeOf(node: Pick<SchemaNode, "groups">): string {
  const groups = node.groups?.length ?? 0;
  const properties = (node.groups ?? []).reduce(
    (sum, group) => sum + group.properties.length,
    0
  );
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  return `${plural(groups, "group", "groups")} · ${plural(properties, "property", "properties")}`;
}

/** The count beside a card's size bar, short so the bar keeps its room. */
export function propsLabel(
  node: Pick<SchemaNode, "ownPropertyCount" | "composedPropertyCount">
): string {
  const count = node.ownPropertyCount + node.composedPropertyCount;
  return `${count} ${count === 1 ? "prop" : "props"}`;
}

/** A card's tooltip: its name, and its size under it, for a type still in the schema. */
export const cardTitle = (node: SchemaNode, removed = false) =>
  removed ? node.name : `${node.name}\n${sizeOf(node)}`;

export function cardCaption(node: SchemaNode, removed = false): string {
  if (removed) return "Removed since the baseline";
  const count = node.ownPropertyCount + node.composedPropertyCount;
  const properties = `${count} ${count === 1 ? "property" : "properties"}`;
  return node.isElement ? `Element · ${properties}` : properties;
}

/** Which way each arrow moves the sheet, so the view moves the way the arrow points. */
const PAN: Record<string, Point> = {
  ArrowLeft: { x: 1, y: 0 },
  ArrowRight: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

export type KeyMove =
  | (({ pan: Point } | { zoom: "in" | "out" }) & { duration: number })
  | null;

type KeyPress = Pick<
  KeyboardEvent,
  | "key"
  | "shiftKey"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "defaultPrevented"
  | "repeat"
>;

/**
 * What a key does on the board: the arrows pan 80 px, twice that with Shift, as
 * the City's keys go twice as far, and + and - zoom. A key with Cmd, Ctrl or Alt
 * held, or one something else already took, is not the board's.
 */
export function keyMove(press: KeyPress): KeyMove {
  if (press.defaultPrevented || press.metaKey || press.ctrlKey || press.altKey)
    return null;
  const { key } = press;
  const step = press.shiftKey ? 160 : 80;
  // A held key repeats faster than a glide ends, and each new glide starting from the
  // half-way view made the plan crawl, so a repeat steps without one.
  const duration = press.repeat ? 0 : 120;
  const pan = PAN[key];
  if (pan) return { pan: { x: pan.x * step, y: pan.y * step }, duration };
  if (key === "+" || key === "=") return { zoom: "in", duration };
  if (key === "-") return { zoom: "out", duration };
  return null;
}

/**
 * Whether a key belongs to the board, as the City decides for its camera: it was
 * pressed on the board itself, or on the page with nothing focused. An arrow in a
 * list, a field or the inspector belongs to that.
 */
export const boardOwnsKey = (
  from: { tagName?: unknown },
  board: { contains: (node: never) => boolean } | null
) =>
  from.tagName === "BODY" ||
  from.tagName === "HTML" ||
  Boolean(board?.contains(from as never));

/**
 * Whether the panel, opening for a card picked now, docks over where that card is on
 * screen: its right edge, `cardRight` pixels from the board's left, past what the
 * board keeps of `boardWidth`. Such a pick waits out a double-click (Board), or the
 * panel would take the second press.
 */
export const panelCovers = (
  cardRight: number,
  boardWidth: number,
  panelWidth: number,
  panelOpen = false
) => !panelOpen && panelWidth > 0 && cardRight > boardWidth - panelWidth;

/** The cards a batch of React Flow changes selects, which a click or Enter sends. */
export const picked = (
  changes: readonly { type: string; id?: string; selected?: boolean }[]
) =>
  changes.flatMap((change) =>
    change.type === "select" && change.selected && change.id ? [change.id] : []
  );

/** Where to centre the view so a selected card is in it, or null when it already is. */
export function revealCentre(
  card: Point,
  viewport: { x: number; y: number; zoom: number },
  area: { width: number; height: number }
): Point | null {
  if (inView(card, viewport, area)) return null;
  return { x: card.x + CARD_WIDTH / 2, y: card.y + CARD_HEIGHT / 2 };
}

/**
 * What the board does with a key pressed on a card, before React Flow and App act.
 *
 * "select": React Flow selects a card on Enter, and App's Enter focuses the selected
 * type, so on a card not selected yet both would happen in one press. The board
 * takes that press; on the selected card Enter is App's and focuses it, as in the
 * City.
 *
 * "refocus": React Flow unselects a card on Escape and blurs it a frame later,
 * which would leave focus nowhere in the app, so the board takes focus back.
 */
export function cardKey(
  key: string,
  card: string | null | undefined,
  selected: string | null | undefined
): "select" | "refocus" | undefined {
  if (!card) return;
  if (key === "Escape") return "refocus";
  if (key === "Enter" && card !== selected) return "select";
}

/**
 * Whether a card is in full view in the part of the board the inspector leaves
 * open, `open` pixels wide from the left, under `viewport`.
 */
export function inView(
  card: Point,
  viewport: { x: number; y: number; zoom: number },
  open: { width: number; height: number }
): boolean {
  const left = card.x * viewport.zoom + viewport.x;
  const top = card.y * viewport.zoom + viewport.y;
  return (
    left >= 0 &&
    top >= 0 &&
    left + CARD_WIDTH * viewport.zoom <= open.width &&
    top + CARD_HEIGHT * viewport.zoom <= open.height
  );
}

/**
 * How much of a card reads at a zoom (styles.css). Below three quarters the caption
 * is under 8px, so the card shows its name alone, on up to two lines. Below 0.45 two
 * lines no longer fit, so the name takes one, held at 10px on screen and cut short
 * where it must. Below a quarter not even that fits, and the card shows as a tile
 * of its colour with its size bar.
 */
export type ZoomBand = "near" | "name" | "label" | "tile";

export function zoomBand(zoom: number): ZoomBand {
  if (zoom >= 0.75) return "near";
  if (zoom >= 0.45) return "name";
  return zoom >= 0.25 ? "label" : "tile";
}

/**
 * The fitted view, for a board too big to fit at a readable zoom: it starts at the
 * board's top left, as a page does, rather than cutting both edges off, and moves
 * to centre `card` in the open room when that left the card out of view.
 */
export function readableView(
  fitted: { x: number; y: number; zoom: number },
  board: Box,
  card: Point | undefined,
  open: { width: number; height: number },
  margin: number
) {
  const { zoom } = fitted;
  const view = {
    x:
      board.width * zoom > open.width - 2 * margin
        ? margin - board.x * zoom
        : fitted.x,
    y:
      board.height * zoom > open.height - 2 * margin
        ? margin - board.y * zoom
        : fitted.y,
    zoom,
  };
  if (!card || inView(card, view, open)) return view;
  return {
    x: open.width / 2 - (card.x + CARD_WIDTH / 2) * zoom,
    y: open.height / 2 - (card.y + CARD_HEIGHT / 2) * zoom,
    zoom,
  };
}
