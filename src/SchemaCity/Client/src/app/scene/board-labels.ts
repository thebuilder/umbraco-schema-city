// The type names printed on the board in front of each building, the way a PCB prints
// a reference designator in silkscreen beside its component, and the courtyard
// outline around each component that frames its print. Pure: no three.js, no React,
// no DOM. scene/BoardLabels.tsx rasterises and draws what this decides.
import { pixelsPerUnit } from "./stage";

/**
 * Text size in world units per unit of footprint. A building's name is as big as the
 * building can carry, so a small type gets smaller print and a large one larger
 * print, and the board keeps the proportions a real one has.
 */
const EM_PER_FOOTPRINT = 0.4;
/**
 * Smallest print at the full size. The framed overview of the seeded schema draws
 * a unit of print at about four and a half to seven pixels from the far boards to
 * the near ones, so print under 1.6 units falls below the 7 px a name needs to read
 * on the far side before the camera has moved at all.
 */
export const MIN_EM = 1.6;
/**
 * Largest print. The strip the layout leaves in front of a row holds this with
 * board to spare, so a larger footprint widens the name's line but not its height.
 */
export const MAX_EM = 2.2;
/** Height of a printed line over its font size: the ascenders and descenders. */
export const LINE_HEIGHT = 1.25;
/**
 * How far a name's second line sits below its first, over the font size. Tighter
 * than a line of its own, so a name on two lines reads as one block and takes less
 * of the strip in front of its building.
 */
export const LINE_STEP = 1.1;
/**
 * Width of one character over the font size. Every mono face the theme falls back
 * to is within a few percent of 0.6. Only the tests use it now: the atlas measures
 * the real face, so a wide glyph never runs past its room.
 */
export const MONO_ADVANCE = 0.6;
/**
 * The most a name may run past each side of its footprint when it stands clear of
 * its neighbours, in world units. Past this a name is cut, however open the ground
 * beside it, so the print still reads as belonging to the one component.
 */
const MAX_OVERHANG = 3;
/** Bare board kept between two names, or a name and the next building, side by side. */
const NAME_SPACING = 0.6;
/** Bare board between the footprint's edge and the top of the print. */
export const LABEL_INSET = 0.1;
/**
 * Extra ground the layout leaves between two rows of one block, on top of the
 * 1.5-unit gap a row already keeps, so a name on two lines at the smallest print
 * (0.1 + 1.6 x 2.35 units) has 0.64 of board between it and the next row's north
 * wall, and the largest print on one line (0.1 + 2.75) has 1.65. Larger print on
 * two lines takes the strip behind its building, or one line. Without that margin
 * the default camera, which looks over that row from the south-east, lost the name
 * behind any building more than a floor or two high.
 */
export const LABEL_STRIP = 3;

/**
 * Projected text height, in CSS pixels, below which a name is gone and above which
 * it is whole. The ramp between is the fade, so zooming in brings names up a few at a
 * time rather than switching a wall of them on, and a name never flickers at one
 * threshold. Six pixels is about where a mono face stops being letters.
 */
export const LOD_HIDE_PX = 6;
export const LOD_SHOW_PX = 7;

/**
 * How far past square to the view the camera has to turn before the names flip, in
 * radians. Without a band either side of the boundary, an orbit that rests on it
 * flips every name back and forth with each pixel of drag.
 */
const FLIP_HYSTERESIS = (15 * Math.PI) / 180;

export function labelEm(footprint: number): number {
  return Math.min(MAX_EM, Math.max(MIN_EM, footprint * EM_PER_FOOTPRINT));
}

/**
 * The sizes a name is prepared at, as shares of its full size, smallest first.
 * The full size is what the framed overview needs to read at all; closer in, a
 * smaller print reads just as well and fits more of the name in the same ground,
 * so a name grows whole as the camera comes down instead of staying cut.
 */
export const PRINT_LEVELS = [0.4, 0.62, 1] as const;

/**
 * The height a smaller print has to keep on screen before a name switches to it.
 * Above the 7 px a name reads from, so a switch never lands on print that is only
 * just legible.
 */
const COMFORT_PX = 9;

/**
 * Which of a name's sizes to print, given how many pixels one world unit of print
 * comes to on screen: the smallest that reads comfortably, or, while none does, the
 * largest as long as it is at least fading in. -1 when even that is too small to
 * draw.
 */
export function printLevel(pxPerEm: number, ems: readonly number[]): number {
  const reads = ems.findIndex((em) => em * pxPerEm >= COMFORT_PX);
  if (reads >= 0) return reads;
  const largest = ems.length - 1;
  return largest >= 0 && (ems[largest] as number) * pxPerEm >= LOD_HIDE_PX
    ? largest
    : -1;
}

/**
 * Where a name may break onto a second line or be cut short: after a space, after a
 * hyphen, and between a lower-case letter and a capital, so "GalleryPage" breaks as
 * readily as "Gallery Page". Never inside a word, so never inside a grapheme.
 */
const BREAK = /(?<=\s)(?=\S)|(?<=-)(?=[^\s-])|(?<=\p{Ll})(?=\p{Lu})/gu;

/** Spaces and hyphens a cut leaves at its end, which the ellipsis replaces. */
const TRAILING = /[\s-]+$/u;

const breaksIn = (text: string) =>
  [...text.matchAll(BREAK)]
    .map((match) => match.index as number)
    .filter((at) => at > 0 && at < text.length);

/**
 * `text` laid out in `room` ems: on one line when it fits, else, when `lines`
 * allows two, split at the word break that leaves the longer line shortest, so the
 * two lines balance. Null when neither fits.
 */
function wrap(
  text: string,
  room: number,
  measure: (text: string) => number,
  lines: number
): string | null {
  if (measure(text) <= room) return text;
  if (lines < 2) return null;
  let best: string | null = null;
  let widest = Number.POSITIVE_INFINITY;
  for (const at of breaksIn(text)) {
    const top = text.slice(0, at).trimEnd();
    const bottom = text.slice(at).trimStart();
    const width = Math.max(measure(top), measure(bottom));
    if (width <= room && width < widest) {
      best = `${top}\n${bottom}`;
      widest = width;
    }
  }
  return best;
}

/**
 * Share of a board's names that have to start or end with the same words before the
 * print treats them as context the board already gives. Two in five, because the
 * seeded schema's Site board ends 24 of its 50 names in " Page", and a board that
 * holds pages says Page as plainly as one that holds only pages.
 */
const SHARED_SHARE = 0.4;

/** A board's shared context: leading words such as "Element ", trailing ones such as " Page". */
export type Context = { prefix: string; suffix: string };

/**
 * The longest leading words and the longest trailing words at least `SHARED_SHARE`
 * of a board's names share, each "" when they share none. Fewer than three names
 * share nothing worth dropping.
 */
export function sharedContext(names: readonly string[]): Context {
  if (names.length < 3) return { prefix: "", suffix: "" };
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  const count = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);
  for (const name of names) {
    // Every prefix ending in a space and every suffix starting with one, short of
    // the whole name.
    for (let at = name.indexOf(" "); at > 0; at = name.indexOf(" ", at + 1)) {
      count(starts, name.slice(0, at + 1));
      count(ends, name.slice(at));
    }
  }
  const longest = (map: Map<string, number>) => {
    let best = "";
    for (const [words, n] of map)
      if (n >= names.length * SHARED_SHARE && words.length > best.length)
        best = words;
    return best;
  };
  return { prefix: longest(starts), suffix: longest(ends) };
}

/**
 * A name as the board can say it: whole, then without the board's leading words,
 * without its trailing words, and without both, each once and never empty.
 */
export function readings(name: string, context: Context): string[] {
  const start =
    context.prefix && name.startsWith(context.prefix)
      ? context.prefix.length
      : 0;
  const end =
    context.suffix && name.endsWith(context.suffix)
      ? name.length - context.suffix.length
      : name.length;
  const out = [name];
  for (const one of [
    name.slice(start),
    name.slice(0, end),
    name.slice(start, end),
  ])
    if (one.trim() !== "" && !out.includes(one)) out.push(one);
  return out;
}

/** A name's board: its shared context and every reading of every other name on it. */
export type Board = Context & { others: readonly string[] };

const ALONE: Board = { prefix: "", suffix: "", others: [] };

export type Fitted = {
  /** What is printed, a line break between two lines. */
  text: string;
  /** True when `text` is the whole name, so a floating label would repeat it. */
  full: boolean;
};

/**
 * `name` as it fits in `room` ems on at most `lines` lines, measured by `measure` in
 * ems, or null when it cannot be printed at this size. In order: the whole name; the
 * name without the context its board gives, as long as that reads differently from
 * every other name on the board; then the most leading words that fit, with an
 * ellipsis, as long as no other name on the board starts the same way. A name is
 * never cut inside a word.
 */
export function fitName(
  name: string,
  room: number,
  measure: (text: string) => number,
  board: Board = ALONE,
  lines = 2
): Fitted | null {
  const bases = readings(name, board).filter(
    (one, i) => i === 0 || !board.others.includes(one)
  );
  for (const base of bases) {
    const text = wrap(base, room, measure, lines);
    if (text) return { text, full: base === name };
  }
  // The shortest reading first, so the words a cut keeps are the ones that tell
  // this type from the others.
  for (const base of bases.reverse()) {
    for (const at of breaksIn(base).reverse()) {
      const head = base.slice(0, at).replace(TRAILING, "");
      // Fewer words would only start more names the same way.
      if (board.others.some((other) => other.startsWith(head))) break;
      const text = wrap(`${head}…`, room, measure, lines);
      if (text) return { text, full: false };
    }
  }
  return null;
}

/** 0 for a whole name, 1 for one without its board's context, 2 for a cut one. */
const kindOf = (fitted: Fitted) =>
  fitted.full ? 0 : fitted.text.endsWith("…") ? 2 : 1;
const linesOf = (fitted: Fitted) => fitted.text.split("\n").length;

/**
 * The prints worth offering, each text once, best first: a whole name before a
 * shortened one before a cut one, one line before two, and more of the name before
 * less.
 */
export function rankPrints(fitted: readonly (Fitted | null)[]): Fitted[] {
  const kept = fitted.filter(
    (one, i): one is Fitted =>
      one !== null &&
      fitted.findIndex((other) => other?.text === one.text) === i
  );
  return kept.sort(
    (a, b) =>
      kindOf(a) - kindOf(b) ||
      linesOf(a) - linesOf(b) ||
      b.text.length - a.text.length
  );
}

/**
 * How wide each building's name may be in its own column, in world units: its
 * footprint plus the same overhang on both sides, so the name stays centred under
 * it. The overhang is half the open ground to the nearest building beside it, east
 * or west, less the spacing, and at most `MAX_OVERHANG`. Beside means sharing some
 * of its north-south extent, which is every building in its row.
 *
 * Both neighbours take half the gap between them, so two names never meet.
 *
 * ponytail: every building against every other, about 90,000 pairs on the 300-type
 * fixture, once per layout. Sorting each row by x is the upgrade if a schema of
 * thousands of types makes this show in a profile.
 */
export function labelRoom(
  placements: readonly {
    id: string;
    position: { x: number; z: number };
    footprint: number;
  }[]
): Map<string, number> {
  const room = new Map<string, number>();
  for (const one of placements) {
    const half = one.footprint / 2;
    let open = MAX_OVERHANG * 2 + NAME_SPACING;
    for (const other of placements) {
      if (other === one) continue;
      const reach = half + other.footprint / 2;
      if (Math.abs(other.position.z - one.position.z) >= reach) continue;
      const apart = Math.abs(other.position.x - one.position.x) - reach;
      if (apart >= 0) open = Math.min(open, apart);
    }
    const overhang = Math.min(
      MAX_OVERHANG,
      Math.max(0, open / 2 - NAME_SPACING / 2)
    );
    room.set(one.id, one.footprint + overhang * 2);
  }
  return room;
}

/** The widest a name prints when it stands clear of its neighbours. */
const longRoom = (footprint: number) => footprint + MAX_OVERHANG * 2;

/**
 * How tall print of size `em`, lying flat at `anchor`, comes out on screen in CSS
 * pixels: its size at that distance, foreshortened along whichever of its two axes
 * the view squashes more. A letter needs both its height, which runs north-south on
 * the board, and its strokes across, which run east-west, so text seen edge-on along
 * either is a line, however close it is.
 *
 * It was the steepness of the view alone, which at the default diagonal view
 * counted every name at seven tenths of the height it has on screen.
 */
export function boardTextPx(
  em: number,
  viewportHeight: number,
  camera: { x: number; y: number; z: number },
  anchor: { x: number; y: number; z: number }
): number {
  const dx = camera.x - anchor.x;
  const dy = camera.y - anchor.y;
  const dz = camera.z - anchor.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6 || dy <= 0) return 0;
  // A unit vector's length on screen is the sine of its angle to the line of sight.
  const along = Math.sqrt(dx * dx + dy * dy) / distance;
  const across = Math.sqrt(dy * dy + dz * dz) / distance;
  return em * pixelsPerUnit(viewportHeight, distance) * Math.min(along, across);
}

/** 0 below `LOD_HIDE_PX`, 1 from `LOD_SHOW_PX`, a smoothstep between. */
export function labelFade(px: number): number {
  const t = Math.min(
    1,
    Math.max(0, (px - LOD_HIDE_PX) / (LOD_SHOW_PX - LOD_HIDE_PX))
  );
  return t * t * (3 - 2 * t);
}

/**
 * How solid the print is at rest: readable on the board and still quieter than the
 * buildings and the traces.
 */
export const BASE_OPACITY = 0.6;
/**
 * What is left of a name unrelated to the hovered or selected type, the same share
 * an unrelated trace keeps of its idle strength.
 */
export const DIMMED = 0.15;

export type Interaction = {
  hovered: string | null;
  selected: string | null;
  /** The selection's or the focus's lit set, or null when nothing is lit. */
  neighbours: Set<string> | null;
  hoveredNeighbours: Set<string> | null;
};

/**
 * How much of its strength a name keeps under the hover and the selection: all of
 * it at rest, for the hovered and selected types and for a related type, and
 * `DIMMED` for an unrelated one. A floating label that is on screen hides the print
 * under it through the floated set rather than here, because the label layer can
 * drop a floating label whose roof is off screen, and the name has to show
 * somewhere.
 */
export function labelLight(id: string, now: Interaction): number {
  if (id === now.hovered || id === now.selected) return 1;
  const related = now.neighbours?.has(id) || now.hoveredNeighbours?.has(id);
  const quiet =
    now.hovered === null && now.selected === null && now.neighbours === null;
  return quiet || related ? 1 : DIMMED;
}

/**
 * A name's opacity: its rest strength, faded by the level of detail, the light the
 * hover and selection leave it, the intro's progress, and how far focus mode has
 * pressed its building flat.
 */
export function labelOpacity(
  px: number,
  light: number,
  reveal: number,
  flatten: number
): number {
  return BASE_OPACITY * labelFade(px) * light * reveal * (1 - flatten);
}

/**
 * The order names claim board space in: the hovered and selected types, then
 * their neighbours, then larger types before smaller, then types with more content,
 * then by id so the order is the same every time.
 */
export type Ranked = {
  id: string;
  /** 0 for the hovered or selected type, 1 for a neighbour of one, 2 for the rest. */
  tier: number;
  footprint: number;
  /** Content items of this type, or 0 when there is no usage report. */
  usage: number;
};

export function byPriority(a: Ranked, b: Ranked): number {
  return (
    a.tier - b.tier ||
    b.footprint - a.footprint ||
    b.usage - a.usage ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** The four places a print can lie round its building, as the reader sees them. */
export type Side = "front" | "back" | "left" | "right";

/** The order a name tries its places in: in front, behind, then beside. */
const SIDES: readonly Side[] = ["front", "back", "left", "right"];

/**
 * Where a print of `width` by `height` lies beside its building: in front of the
 * edge facing the camera, behind the one facing away, or level with it to the
 * reader's left or right. Upright, front is south, the side the default camera looks
 * at, and left is west; flipped, front is north and left is east.
 */
export function printRect(
  centre: { x: number; z: number },
  footprint: number,
  width: number,
  height: number,
  side: Side,
  flipped: boolean
): Rect {
  const near = footprint / 2 + LABEL_INSET;
  if (side === "left" || side === "right") {
    const west = (side === "left") !== flipped;
    return {
      minX: west ? centre.x - near - width : centre.x + near,
      maxX: west ? centre.x - near : centre.x + near + width,
      minZ: centre.z - height / 2,
      maxZ: centre.z + height / 2,
    };
  }
  const south = (side === "front") !== flipped;
  return {
    minX: centre.x - width / 2,
    maxX: centre.x + width / 2,
    minZ: south ? centre.z + near : centre.z - near - height,
    maxZ: south ? centre.z + near + height : centre.z - near,
  };
}

/** One name to place: its building, and the prints it may use, best first. */
export type Want = {
  id: string;
  centre: { x: number; z: number };
  footprint: number;
  /** Width and height of each print, in world units, best first. */
  prints: readonly {
    width: number;
    height: number;
    /** True for whole leading words and an ellipsis. */
    cut?: boolean;
  }[];
};

export type Placed = {
  print: number;
  rect: Rect;
  /** True when no place clear of the drawn traces was left, so a trace runs under it. */
  crosses: boolean;
};

/**
 * Board kept clear between a print and a building. Under the print's own inset from
 * its footprint, so a print can run along the strip in front of its neighbours,
 * whose south edges stand on the same line as its building's.
 */
const CLEAR = 0.05;
/**
 * Board kept clear between two prints: about a space at the smallest print, so two
 * names side by side in a row never read as one.
 */
const PRINT_GAP = 0.9;
/** Side of a cell of the grid that finds what a print might overlap. */
const CELL = 6;

type Item = { id: string; rect: Rect; gap: number };

/** The grid cells a rectangle grown by `margin` touches. */
function cellsOf(rect: Rect, margin: number): string[] {
  const out: string[] = [];
  for (
    let x = Math.floor((rect.minX - margin) / CELL);
    x <= Math.floor((rect.maxX + margin) / CELL);
    x++
  )
    for (
      let z = Math.floor((rect.minZ - margin) / CELL);
      z <= Math.floor((rect.maxZ + margin) / CELL);
      z++
    )
      out.push(`${x}|${z}`);
  return out;
}

const overlapping = (a: Rect, b: Rect, gap: number) =>
  a.minX < b.maxX + gap &&
  a.maxX > b.minX - gap &&
  a.minZ < b.maxZ + gap &&
  a.maxZ > b.minZ - gap;

/**
 * Places as many names as fit, none over another or over any building but its own,
 * in two passes in the order given. The first gives every name the least of its
 * prints that fits, trying the rest only when that one does not, in front of its
 * building, behind it, or beside it, so as many names as possible get a place. The
 * second moves each placed name, in the same order, to its best print that fits the
 * board the first pass left. A name no print of which fits is left off.
 *
 * Both passes take a place clear of the drawn traces, which `crossesTrace` tests,
 * over one a trace runs through, so a print and a trace never share board where
 * the board leaves a choice. Where it does not, the print takes a place over a
 * trace and says so, and the scene draws bare board under it.
 *
 * One pass that took each name's best print first let the first long names take
 * the strips later short ones needed. The first pass tries more than the least
 * print because prints differ in height as well as width: a cut on one line can
 * fit a strip a whole name on two lines does not.
 *
 * The prints lie flat on one plane, so two that overlap on the board overlap on
 * screen and two that do not, do not, whatever the camera. That is what lets the
 * test run on the board rather than in pixels.
 *
 * ponytail: greedy, with a uniform grid for the lookups. A name kept out by an
 * earlier one never asks it to move; a solver that shifted names along their row is
 * the upgrade if the overview starts dropping names it could have fitted.
 */
export function placeLabels(
  wants: readonly Want[],
  buildings: readonly { id: string; rect: Rect }[],
  flipped: boolean,
  crossesTrace: (rect: Rect) => boolean = () => false
): Map<string, Placed> {
  const grid = new Map<string, Item[]>();
  const cells = (rect: Rect) => cellsOf(rect, PRINT_GAP);
  const add = (item: Item) => {
    for (const cell of cells(item.rect)) {
      const list = grid.get(cell);
      if (list) list.push(item);
      else grid.set(cell, [item]);
    }
  };
  const remove = (item: Item) => {
    for (const cell of cells(item.rect)) {
      const list = grid.get(cell);
      if (list) list.splice(list.indexOf(item), 1);
    }
  };
  const blocked = (id: string, rect: Rect) =>
    cells(rect).some((cell) =>
      grid
        .get(cell)
        ?.some(
          (item) => item.id !== id && overlapping(item.rect, rect, item.gap)
        )
    );
  for (const building of buildings) add({ ...building, gap: CLEAR });

  const placed = new Map<string, Placed & { item: Item }>();
  /**
   * The first of `prints` that fits on any side, placed and returned; with `cross`
   * false, only on a side no trace runs through.
   */
  const place = (want: Want, prints: readonly number[], cross: boolean) => {
    for (const print of prints) {
      const { width, height } = want.prints[print] as {
        width: number;
        height: number;
      };
      for (const side of SIDES) {
        const rect = printRect(
          want.centre,
          want.footprint,
          width,
          height,
          side,
          flipped
        );
        if (blocked(want.id, rect)) continue;
        const crosses = crossesTrace(rect);
        if (crosses && !cross) continue;
        // Its own building no longer counts against it, so it gets another id.
        const item = { id: `print|${want.id}`, rect, gap: PRINT_GAP };
        add(item);
        placed.set(want.id, { print, rect, crosses, item });
        return true;
      }
    }
    return false;
  };

  for (const want of wants) {
    const least = want.prints.map((_, i) => want.prints.length - 1 - i);
    if (!place(want, least, false)) place(want, least, true);
  }
  for (const want of wants) {
    const held = placed.get(want.id);
    if (!held || held.print === 0) continue;
    remove(held.item);
    placed.delete(want.id);
    const wider = Array.from({ length: held.print }, (_, i) => i);
    // A better print may run over a trace where the one it replaces did, and to
    // print more than a cut: a whole name over bare board reads better than its
    // first word clear of the trace.
    const over = held.crosses
      ? wider
      : wider.filter(
          (i) => want.prints[held.print]?.cut && !want.prints[i]?.cut
        );
    if (!(place(want, wider, false) || place(want, over, true))) {
      add(held.item);
      placed.set(want.id, held);
    }
  }
  return new Map(
    [...placed].map(([id, { print, rect, crosses }]) => [
      id,
      { print, rect, crosses },
    ])
  );
}

/** A drawn trace's run on the ground, and the types at the ends of its connection. */
export type Trace = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  from: string;
  to: string;
};

/**
 * Every run of the given routes, from the centre of the building a connection
 * leaves, through the corners it turns, to the centre of the one it reaches. The
 * first and last runs stand for the drop off a roof and the rise to one, which a
 * link layer draws from the roof, and lie under the building for a road, where no
 * print goes.
 */
export function tracesOf(
  routes: readonly {
    from: string;
    to: string;
    points: readonly { x: number; z: number }[];
  }[],
  centreOf: (id: string) => { x: number; z: number } | undefined
): Trace[] {
  return routes.flatMap((route) => {
    const from = centreOf(route.from);
    const to = centreOf(route.to);
    const path = [
      ...(from ? [from] : []),
      ...route.points,
      ...(to ? [to] : []),
    ];
    return path.slice(1).map((end, i) => {
      const start = path[i] as { x: number; z: number };
      return {
        x0: start.x,
        z0: start.z,
        x1: end.x,
        z1: end.z,
        from: route.from,
        to: route.to,
      };
    });
  });
}

/**
 * Board kept between a print and a trace's centre line: half the widest trace, a
 * road at 0.3, and a little bare board.
 */
const TRACE_CLEAR = 0.25;

/** A trace's run as a rectangle, grown by the clearance a print keeps from it. */
const traceRect = (trace: Trace): Rect => ({
  minX: Math.min(trace.x0, trace.x1) - TRACE_CLEAR,
  maxX: Math.max(trace.x0, trace.x1) + TRACE_CLEAR,
  minZ: Math.min(trace.z0, trace.z1) - TRACE_CLEAR,
  maxZ: Math.max(trace.z0, trace.z1) + TRACE_CLEAR,
});

/**
 * The traces whose runs pass through a rectangle, found through the same grid the
 * placement uses. A run is taken as its bounding box, which is exact for the runs
 * along the streets and generous for a drop off a roof, which is diagonal only
 * where it crosses its own building.
 */
export function traceIndex(traces: readonly Trace[]): (rect: Rect) => Trace[] {
  const grid = new Map<string, { trace: Trace; rect: Rect }[]>();
  for (const trace of traces) {
    const item = { trace, rect: traceRect(trace) };
    for (const cell of cellsOf(item.rect, 0)) {
      const list = grid.get(cell);
      if (list) list.push(item);
      else grid.set(cell, [item]);
    }
  }
  return (rect) => {
    const found = new Set<Trace>();
    for (const cell of cellsOf(rect, 0))
      for (const item of grid.get(cell) ?? [])
        if (overlapping(item.rect, rect, 0)) found.add(item.trace);
    return [...found];
  };
}

/**
 * How solid the bare board under a print is: `alpha` when the print lies over a
 * trace and no trace under it is lit by the hover or the selection, so a lit path
 * shows the whole way, and 0 otherwise.
 */
export function knockoutAlpha(
  spot: { rect: Rect; crosses: boolean } | undefined,
  alpha: number,
  traceAt: (rect: Rect) => readonly Trace[],
  now: { hovered: string | null; selected: string | null }
): number {
  if (!spot?.crosses) return 0;
  const lit = (id: string) => id === now.hovered || id === now.selected;
  return traceAt(spot.rect).some((trace) => lit(trace.from) || lit(trace.to))
    ? 0
    : alpha;
}

/** The knockout's corner radius, and how far it reaches past the text's ends. */
const KNOCKOUT_RADIUS = 0.3;
const KNOCKOUT_PAD = 0.2;
/** How far the knockout sits inside the print's line height, top and bottom. */
const KNOCKOUT_INSET = 0.1;
/** Points along each rounded corner, ends included. */
const KNOCKOUT_ARC = 4;
/** Vertices one knockout takes: a fan of one triangle per point round its edge. */
export const KNOCKOUT_VERTICES = 4 * KNOCKOUT_ARC * 3;

/**
 * The patch of bare board drawn under a print that a trace runs through, so the
 * trace reads as passing under the print: a rounded rectangle a little inside the
 * print's line height and a little past its ends, as a triangle list of x, z pairs.
 * Writes `KNOCKOUT_VERTICES` vertices into `out` from vertex `at`.
 */
export function knockout(rect: Rect, out: Float32Array, at: number): void {
  const minX = rect.minX - KNOCKOUT_PAD;
  const maxX = rect.maxX + KNOCKOUT_PAD;
  const minZ = rect.minZ + KNOCKOUT_INSET;
  const maxZ = rect.maxZ - KNOCKOUT_INSET;
  const r = Math.max(
    0,
    Math.min(KNOCKOUT_RADIUS, (maxX - minX) / 2, (maxZ - minZ) / 2)
  );
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Corner centres, each with the quarter turn it sweeps, clockwise from north-east.
  const corners: [number, number, number][] = [
    [maxX - r, minZ + r, -Math.PI / 2],
    [maxX - r, maxZ - r, 0],
    [minX + r, maxZ - r, Math.PI / 2],
    [minX + r, minZ + r, Math.PI],
  ];
  const ring: [number, number][] = corners.flatMap(([x, z, start]) =>
    Array.from({ length: KNOCKOUT_ARC }, (_, k): [number, number] => {
      const angle = start + ((Math.PI / 2) * k) / (KNOCKOUT_ARC - 1);
      return [x + r * Math.cos(angle), z + r * Math.sin(angle)];
    })
  );
  let i = at * 2;
  ring.forEach(([x, z], k) => {
    const [nx, nz] = ring[(k + 1) % ring.length] as [number, number];
    // Centre, next, this: counter-clockwise seen from above, so the face is up.
    out[i++] = cx;
    out[i++] = cz;
    out[i++] = nx;
    out[i++] = nz;
    out[i++] = x;
    out[i++] = z;
  });
}

/**
 * A print's four corners on the ground, as x, z pairs in the order north-west,
 * north-east, south-west, south-east of the text itself, which is the order the
 * texture coordinates are written in. Flipped, the text is turned 180 degrees, so
 * its north-west corner is the rectangle's south-east one. Writes into `out`.
 */
export function printCorners(
  rect: Rect,
  flipped: boolean,
  out: number[]
): number[] {
  const [west, east] = flipped
    ? [rect.maxX, rect.minX]
    : [rect.minX, rect.maxX];
  const [top, bottom] = flipped
    ? [rect.maxZ, rect.minZ]
    : [rect.minZ, rect.maxZ];
  out[0] = west;
  out[1] = top;
  out[2] = east;
  out[3] = top;
  out[4] = west;
  out[5] = bottom;
  out[6] = east;
  out[7] = bottom;
  return out;
}

/** Board kept between a footprint and its courtyard line. */
const COURTYARD = 0.25;

/**
 * A component's courtyard, the silkscreen outline a board draws round a part's
 * footprint, as line segment ends x0, z0, x1, z1. With a print beside it the
 * outline takes the print in as well, so the name reads as the part's own.
 * Writes into `out` from `at` and returns where it stopped.
 */
export function courtyard(
  centre: { x: number; z: number },
  footprint: number,
  print: Rect | null,
  out: Float32Array,
  at: number
): number {
  const half = footprint / 2 + COURTYARD;
  const a = {
    minX: centre.x - half,
    maxX: centre.x + half,
    minZ: centre.z - half,
    maxZ: centre.z + half,
  };
  const corners: [number, number][] = [];
  const beside =
    print !== null &&
    (print.maxX <= centre.x - footprint / 2 ||
      print.minX >= centre.x + footprint / 2);
  if (print && beside) {
    // A print to the left or right: one outline round the part and the print.
    const minX = Math.min(a.minX, print.minX - CLEAR);
    const maxX = Math.max(a.maxX, print.maxX + CLEAR);
    const minZ = Math.min(a.minZ, print.minZ - CLEAR);
    const maxZ = Math.max(a.maxZ, print.maxZ + CLEAR);
    corners.push([minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]);
  } else if (print) {
    const b = {
      minX: Math.min(print.minX, centre.x) - CLEAR,
      maxX: Math.max(print.maxX, centre.x) + CLEAR,
    };
    if (print.minZ >= centre.z) {
      // The print is south: down the footprint's east side, out along the seam,
      // round the print and back.
      const end = print.maxZ + CLEAR;
      corners.push(
        [a.minX, a.minZ],
        [a.maxX, a.minZ],
        [a.maxX, a.maxZ],
        [b.maxX, a.maxZ],
        [b.maxX, end],
        [b.minX, end],
        [b.minX, a.maxZ],
        [a.minX, a.maxZ]
      );
    } else {
      const end = print.minZ - CLEAR;
      corners.push(
        [b.minX, end],
        [b.maxX, end],
        [b.maxX, a.minZ],
        [a.maxX, a.minZ],
        [a.maxX, a.maxZ],
        [a.minX, a.maxZ],
        [a.minX, a.minZ],
        [b.minX, a.minZ]
      );
    }
  } else {
    corners.push(
      [a.minX, a.minZ],
      [a.maxX, a.minZ],
      [a.maxX, a.maxZ],
      [a.minX, a.maxZ]
    );
  }
  let i = at;
  corners.forEach(([x, z], k) => {
    const [nx, nz] = corners[(k + 1) % corners.length] as [number, number];
    out[i++] = x;
    out[i++] = z;
    out[i++] = nx;
    out[i++] = nz;
  });
  return i;
}

/** Line segments one courtyard can take, which sizes the buffer. */
export const COURTYARD_SEGMENTS = 8;

/**
 * Whether the names should be turned 180 degrees, from the way the camera faces on
 * the ground. Upright, a name reads west to east with its top to the north, which is
 * right for a camera looking anywhere north of due west or due east. Past that by
 * `FLIP_HYSTERESIS` the names turn, and they turn back only once the camera is the
 * same margin inside the upright half again.
 */
export function labelsFlipped(
  forwardX: number,
  forwardZ: number,
  flipped: boolean
): boolean {
  // 0 looking due north, plus or minus pi looking due south.
  const off = Math.abs(Math.atan2(forwardX, -forwardZ));
  return flipped
    ? off > Math.PI / 2 - FLIP_HYSTERESIS
    : off > Math.PI / 2 + FLIP_HYSTERESIS;
}

/**
 * Shelf packing for the atlas: entries left to right in rows as tall as their
 * tallest entry, a new row when the next one would run past `width`. Returns each
 * entry's top-left corner in pixels and the height the rows take. `pad` pixels
 * surround every entry, so a mipmap level a few steps down does not bleed one name
 * into the next.
 */
export function packAtlas(
  widths: readonly number[],
  heights: readonly number[],
  width: number,
  pad: number
): { spots: { x: number; y: number }[]; height: number } {
  const spots: { x: number; y: number }[] = [];
  let x = pad;
  let y = pad;
  let row = 0;
  widths.forEach((entry, i) => {
    if (x > pad && x + entry + pad > width) {
      x = pad;
      y += row + pad;
      row = 0;
    }
    spots.push({ x, y });
    x += entry + pad;
    row = Math.max(row, heights[i] as number);
  });
  return { spots, height: widths.length > 0 ? y + row + pad : 0 };
}

/**
 * The font size that packs an atlas `height` pixels tall at `fontPx` into
 * `maxHeight`. The packed area grows with the square of the font, so the font
 * shrinks by the square root of the overflow, a little under it so one pass lands
 * inside, and never below `minPx`, where the caller stops and clips.
 */
export function fittedFontPx(
  fontPx: number,
  height: number,
  maxHeight: number,
  minPx: number
): number {
  if (height <= maxHeight) return fontPx;
  return Math.max(
    minPx,
    Math.floor(fontPx * Math.sqrt(maxHeight / height) * 0.97)
  );
}

/** A building as the names see it: where it stands, how big, on which board. */
export type Standing = {
  id: string;
  position: { x: number; z: number };
  footprint: number;
  district: string;
  y?: number;
  /** 1 once focus mode has pressed it to a flat plate. */
  flatten?: number;
};

/** A name at one size: the size, and its prints at that size, best first. */
export type Sized = { em: number; prints: Fitted[] };

/**
 * What each building prints at each of its sizes, smallest size first: as much of
 * its name as fits clear of its neighbours, half way to its own column, and in its
 * own column, on two lines or on one, best first (`rankPrints`). Each name is
 * fitted against the other names on its board, which decide the context a print
 * may drop and the cuts that would read as some other type.
 *
 * ponytail: every name on a board against every other, about 20,000 readings on the
 * pathological fixture's largest board, once per layout.
 */
export function printsFor(
  standing: readonly Standing[],
  nameOf: (id: string) => string | undefined,
  measure: (text: string) => number
): Map<string, Sized[]> {
  const room = labelRoom(standing);
  const boards = new Map<string, { id: string; name: string }[]>();
  for (const one of standing) {
    const name = nameOf(one.id);
    if (name === undefined) continue;
    const list = boards.get(one.district) ?? [];
    list.push({ id: one.id, name });
    boards.set(one.district, list);
  }
  const contexts = new Map(
    [...boards].map(([district, list]) => [
      district,
      sharedContext(list.map((one) => one.name)),
    ])
  );
  const prints = new Map<string, Sized[]>();
  for (const one of standing) {
    const name = nameOf(one.id);
    const context = contexts.get(one.district);
    if (name === undefined || !context) continue;
    const board: Board = {
      ...context,
      others: (boards.get(one.district) ?? [])
        .filter((other) => other.id !== one.id)
        .flatMap((other) => readings(other.name, context)),
    };
    const rooms = [
      longRoom(one.footprint),
      (longRoom(one.footprint) + one.footprint) / 2,
      room.get(one.id) ?? one.footprint,
    ];
    prints.set(
      one.id,
      PRINT_LEVELS.map((share) => {
        const em = labelEm(one.footprint) * share;
        return {
          em,
          prints: rankPrints(
            rooms.flatMap((width) =>
              [2, 1].map((lines) =>
                fitName(name, width / em, measure, board, lines)
              )
            )
          ),
        };
      })
    );
  }
  return prints;
}

/**
 * Where a name stands in the queue for board space: 0 for the hovered or selected
 * type, 1 for a neighbour of either, 2 for the rest.
 */
export function labelTier(id: string, now: Interaction): number {
  if (id === now.hovered || id === now.selected) return 0;
  const related = now.neighbours?.has(id) || now.hoveredNeighbours?.has(id);
  return related ? 1 : 2;
}

/** A building's footprint as a rectangle on the board. */
export const footprintRect = (one: Standing): Rect => ({
  minX: one.position.x - one.footprint / 2,
  maxX: one.position.x + one.footprint / 2,
  minZ: one.position.z - one.footprint / 2,
  maxZ: one.position.z + one.footprint / 2,
});

/** A building pressed this far flat by focus mode is a map, not a part with a name. */
const FLAT = 0.5;

/** One name's place for a view: its size, its print at that size, where, how tall. */
export type Arranged = Placed & { level: number; px: number };

/** A name's sizes, smallest first, and its prints' widths and heights at each. */
export type Sizes = {
  ems: readonly number[];
  levels: readonly (readonly { width: number; height: number }[])[];
};

/**
 * Every name's place for one view. Each standing building's name takes the size
 * `printLevel` picks from how many pixels one unit of print comes to there, and
 * `placeLabels` lays as many as fit in priority order. A flattened building takes
 * no space and prints nothing.
 */
export function arrangeNames(
  standing: readonly Standing[],
  sizes: ReadonlyMap<string, Sizes>,
  pxPerEm: (one: Standing) => number,
  interaction: Interaction,
  usageOf: (id: string) => number,
  flipped: boolean,
  crossesTrace?: (rect: Rect) => boolean
): Map<string, Arranged> {
  const upright = standing.filter((one) => (one.flatten ?? 0) < FLAT);
  const chosen = new Map<string, { level: number; px: number }>();
  const wants = upright.flatMap((one): (Want & Ranked)[] => {
    const size = sizes.get(one.id);
    const perEm = size ? pxPerEm(one) : 0;
    const level = size ? printLevel(perEm, size.ems) : -1;
    if (!size || level < 0) return [];
    chosen.set(one.id, { level, px: perEm * (size.ems[level] as number) });
    return [
      {
        id: one.id,
        tier: labelTier(one.id, interaction),
        footprint: one.footprint,
        usage: usageOf(one.id),
        centre: one.position,
        prints: size.levels[level] ?? [],
      },
    ];
  });
  wants.sort(byPriority);
  const placed = placeLabels(
    wants,
    upright.map((one) => ({ id: one.id, rect: footprintRect(one) })),
    flipped,
    crossesTrace
  );
  return new Map(
    [...placed].map(([id, spot]) => [
      id,
      { ...spot, ...(chosen.get(id) as { level: number; px: number }) },
    ])
  );
}

/** How solid a courtyard line is at rest: an outline, under everything it frames. */
const COURTYARD_OPACITY = 0.22;

/**
 * How solid a type's print and its courtyard are: the print only when it was placed
 * and no floating label already says its name, both under the hover's light, the
 * intro and focus mode's flattening.
 */
export function printStrength(
  spot: { px: number } | undefined,
  floated: boolean,
  light: number,
  reveal: number,
  flatten: number
): { print: number; courtyard: number } {
  return {
    print: spot && !floated ? labelOpacity(spot.px, light, reveal, flatten) : 0,
    courtyard: COURTYARD_OPACITY * light * reveal * (1 - flatten),
  };
}
