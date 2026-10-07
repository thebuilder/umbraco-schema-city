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
 * 1.5-unit gap a row already keeps, so the largest print (0.1 + 2.75 units) has
 * 0.65 of board between it and the next row's north wall. Without that the default
 * camera, which looks over that row from the south-east, lost the name behind any
 * building more than a floor or two high.
 */
export const LABEL_STRIP = 2;

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
 * A string's user-perceived characters, so a cut never splits an emoji, a flag or
 * a letter from its accent. Falls back to code points where Intl.Segmenter is
 * missing.
 */
export function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return [...text];
}

/**
 * The leading words two thirds or more of a board's names share, such as "Element "
 * on a board of Element Types, or "" when they share none. The board already says
 * what its types are, so the print can drop it and spend its room on the words that
 * tell the types apart. Fewer than three names share nothing worth dropping.
 */
export function sharedPrefix(names: readonly string[]): string {
  if (names.length < 3) return "";
  const counts = new Map<string, number>();
  for (const name of names) {
    // Every prefix ending in a space, short of the whole name.
    for (let at = name.indexOf(" "); at > 0; at = name.indexOf(" ", at + 1)) {
      const prefix = name.slice(0, at + 1);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  let best = "";
  for (const [prefix, count] of counts)
    if (count * 3 >= names.length * 2 && prefix.length > best.length)
      best = prefix;
  return best;
}

export type Fitted = {
  /** What is printed. */
  text: string;
  /** True when `text` is the whole name, so a floating label would repeat it. */
  full: boolean;
};

/**
 * `name` as it fits in `room` ems, measured by `measure` in ems. A name that fits
 * prints whole. A longer one loses `prefix` first when it starts with it, then its
 * middle, so two names that differ only at the end still print differently. A
 * name with no room at all prints an ellipsis.
 */
export function fitName(
  name: string,
  room: number,
  measure: (text: string) => number,
  prefix = ""
): Fitted {
  if (measure(name) <= room) return { text: name, full: true };
  const trimmed =
    prefix && name.startsWith(prefix) && name.length > prefix.length
      ? name.slice(prefix.length)
      : name;
  if (measure(trimmed) <= room) return { text: trimmed, full: false };
  const characters = graphemes(trimmed);
  // The most characters kept, split three to two in favour of the start, that
  // still fit around the ellipsis.
  for (let keep = characters.length - 1; keep > 0; keep--) {
    const head = Math.ceil((keep * 3) / 5);
    const text = `${characters.slice(0, head).join("").trimEnd()}…${characters
      .slice(characters.length - (keep - head))
      .join("")
      .trimStart()}`;
    if (measure(text) <= room) return { text, full: false };
  }
  return { text: "…", full: false };
}

/**
 * Characters of the name a cut print keeps before it says too little to tell one
 * type from another. Below this the print is left off rather than drawn.
 */
const MIN_KEPT = 5;

/** True for a whole name, and for a cut one that keeps enough of it to read. */
export const worthPrinting = (fitted: Fitted) =>
  fitted.full ||
  graphemes(fitted.text).filter((character) => character !== "…").length >=
    MIN_KEPT;

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
export const longRoom = (footprint: number) => footprint + MAX_OVERHANG * 2;

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

/**
 * Where a print of `width` by `height` lies beside its building: in front of the
 * edge facing the camera, or behind the one facing away. Upright, front is south,
 * the side the default camera looks at; flipped, front is north.
 */
export function printRect(
  centre: { x: number; z: number },
  footprint: number,
  width: number,
  height: number,
  side: "front" | "back",
  flipped: boolean
): Rect {
  const south = (side === "front") !== flipped;
  const near = footprint / 2 + LABEL_INSET;
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
  /** Width and height of each print, in world units: the whole name, then a cut one. */
  prints: readonly { width: number; height: number }[];
};

export type Placed = { print: number; rect: Rect };

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

const overlapping = (a: Rect, b: Rect, gap: number) =>
  a.minX < b.maxX + gap &&
  a.maxX > b.minX - gap &&
  a.minZ < b.maxZ + gap &&
  a.maxZ > b.minZ - gap;

/**
 * Places as many names as fit, none over another or over any building but its own,
 * in two passes in the order given. The first gives every name its shortest print
 * that still reads, in front of its building or else behind it, so as many names
 * as possible get a place. The second widens each placed name, in the same order,
 * to its longest print that fits the board the first pass left. A name no print of
 * which fits is left off.
 *
 * One pass that took each name's longest print first let the first long names take
 * the strips later short ones needed.
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
  flipped: boolean
): Map<string, Placed> {
  const grid = new Map<string, Item[]>();
  const cells = (rect: Rect) => {
    const out: string[] = [];
    for (
      let x = Math.floor((rect.minX - PRINT_GAP) / CELL);
      x <= Math.floor((rect.maxX + PRINT_GAP) / CELL);
      x++
    )
      for (
        let z = Math.floor((rect.minZ - PRINT_GAP) / CELL);
        z <= Math.floor((rect.maxZ + PRINT_GAP) / CELL);
        z++
      )
        out.push(`${x}|${z}`);
    return out;
  };
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
  /** The first of `prints` that fits, in front or behind, placed and returned. */
  const place = (want: Want, prints: readonly number[]) => {
    for (const print of prints) {
      const { width, height } = want.prints[print] as {
        width: number;
        height: number;
      };
      for (const side of ["front", "back"] as const) {
        const rect = printRect(
          want.centre,
          want.footprint,
          width,
          height,
          side,
          flipped
        );
        if (blocked(want.id, rect)) continue;
        // Its own building no longer counts against it, so it gets another id.
        const item = { id: `print|${want.id}`, rect, gap: PRINT_GAP };
        add(item);
        placed.set(want.id, { print, rect, item });
        return true;
      }
    }
    return false;
  };

  for (const want of wants) {
    if (want.prints.length > 0) place(want, [want.prints.length - 1]);
  }
  for (const want of wants) {
    const held = placed.get(want.id);
    if (!held || held.print === 0) continue;
    remove(held.item);
    placed.delete(want.id);
    const wider = Array.from({ length: held.print }, (_, i) => i);
    if (!place(want, wider)) {
      add(held.item);
      placed.set(want.id, held);
    }
  }
  return new Map(
    [...placed].map(([id, { print, rect }]) => [id, { print, rect }])
  );
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
  if (print) {
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
 * Shelf packing for the atlas: entries left to right in rows of one height, a new
 * row when the next one would run past `width`. Returns each entry's top-left corner
 * in pixels and the height the rows take. `pad` pixels surround every entry, so a
 * mipmap level a few steps down does not bleed one name into the next.
 */
export function packAtlas(
  widths: readonly number[],
  rowHeight: number,
  width: number,
  pad: number
): { spots: { x: number; y: number }[]; height: number } {
  const spots: { x: number; y: number }[] = [];
  let x = pad;
  let y = pad;
  for (const entry of widths) {
    if (x > pad && x + entry + pad > width) {
      x = pad;
      y += rowHeight + pad;
    }
    spots.push({ x, y });
    x += entry + pad;
  }
  return { spots, height: widths.length > 0 ? y + rowHeight + pad : 0 };
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
