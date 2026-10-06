// The type names printed on the board in front of each building, the way a PCB prints
// a reference designator in silkscreen beside its component. Pure: no three.js, no
// React, no DOM. scene/BoardLabels.tsx rasterises and draws what this decides.
import { pixelsPerUnit } from "./stage";

/**
 * Text size in world units per unit of footprint. A building's name is as big as the
 * building can carry, so a small type gets small print and a large one larger print,
 * and the board keeps the proportions a real one has.
 */
const EM_PER_FOOTPRINT = 0.2;
/**
 * Smallest print. At 0.45 the smallest building had to fill about 80 px of screen
 * before its name crossed the 8 px it is shown from, which is closer than anyone
 * zooms to find a type.
 */
export const MIN_EM = 0.55;
/**
 * Largest print. The strip the layout leaves in front of a row holds this with room
 * to spare, so a larger footprint widens the name's line but not its height.
 */
export const MAX_EM = 0.9;
/** Height of a printed line over its font size: the ascenders and descenders. */
export const LINE_HEIGHT = 1.25;
/**
 * Width of one character over the font size. Every mono face the theme falls back
 * to is within a few percent of 0.6, and the quad takes the measured width of the
 * raster, so a face that is a little wider overhangs a little more rather than
 * stretching.
 */
const MONO_ADVANCE = 0.6;
/**
 * The most a name may run past each side of its footprint, in world units. A name
 * longer than its building plus this is cut, however open the ground beside it is,
 * so the print still reads as belonging to the one component.
 */
const MAX_OVERHANG = 2;
/** Bare board kept between two names, or a name and the next building, side by side. */
const NAME_SPACING = 0.6;
/** Bare board between the footprint's edge and the top of the print. */
export const LABEL_INSET = 0.1;
/**
 * Extra ground the layout leaves between two rows of one block, on top of the gap a
 * row already keeps. The gap alone holds the largest print (0.1 + 1.0 of 1.5) but
 * stands it against the next row's north wall, and the default camera looks over
 * that row from the south-east, so any building more than a floor or two high hid
 * the name behind it. One more unit lets low and mid-height rows show it.
 */
export const LABEL_STRIP = 1;

/**
 * Projected text height, in CSS pixels, below which a name is gone and above which
 * it is whole. The ramp between is the fade, so zooming in brings names up a few at a
 * time rather than switching a wall of them on, and a name never flickers at one
 * threshold. Six pixels is about where a mono face stops being letters.
 */
export const LOD_HIDE_PX = 6;
export const LOD_SHOW_PX = 8;

/**
 * How far past square to the view the camera has to turn before the names flip, in
 * radians. Without a band either side of the boundary, an orbit that rests on it
 * flips every name back and forth with each pixel of drag.
 */
const FLIP_HYSTERESIS = (15 * Math.PI) / 180;

export type BoardText = {
  /** What is printed, truncated with an ellipsis when the name is wider than its room. */
  text: string;
  /** Font size in world units. */
  em: number;
  /** True when `text` is the whole name, so a floating label would repeat it. */
  full: boolean;
};

export function labelEm(footprint: number): number {
  return Math.min(MAX_EM, Math.max(MIN_EM, footprint * EM_PER_FOOTPRINT));
}

/** `name` cut to `chars` characters, the last of them an ellipsis when anything went. */
export function truncate(name: string, chars: number): string {
  const characters = [...name];
  if (characters.length <= chars) return name;
  if (chars <= 1) return "…";
  return `${characters
    .slice(0, chars - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * What a building of `footprint` prints of `name`, and how big, when its name may be
 * `room` world units wide.
 */
export function boardText(
  name: string,
  footprint: number,
  room: number
): BoardText {
  const em = labelEm(footprint);
  const chars = Math.floor(room / (em * MONO_ADVANCE));
  const text = truncate(name, chars);
  return { text, em, full: text === name };
}

/**
 * How wide each building's name may be, in world units: its footprint plus the same
 * overhang on both sides, so the name stays centred under it. The overhang is half
 * the open ground to the nearest building beside it, east or west, less the spacing,
 * and at most `MAX_OVERHANG`. Beside means sharing some of its north-south extent,
 * which is every building in its row. A building in a tight row of a grid gets about
 * half a unit a side; one alone in a wide rank gets the full two.
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

/**
 * How tall print of size `em`, lying flat at `anchor`, comes out on screen in CSS
 * pixels: its size at that distance, foreshortened by how steeply the camera looks
 * down on it. Text seen edge-on is a line, however close it is.
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
  return em * pixelsPerUnit(viewportHeight, distance) * (dy / distance);
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
 * How solid the print is at rest: readable on the plate and still quieter than the
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
 * it at rest and for a related type, `DIMMED` for an unrelated one, and none for the
 * hovered or selected type itself, whose floating label already prints the name.
 */
export function labelLight(id: string, now: Interaction): number {
  if (id === now.hovered || id === now.selected) return 0;
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
 * True when the board already prints the whole of a name legibly, which makes a
 * floating label for it a repeat.
 */
export function boardRepeats(
  printed: BoardText | undefined,
  ground: { position: { x: number; z: number }; y?: number } | undefined,
  camera: { x: number; y: number; z: number },
  viewportHeight: number
): boolean {
  if (!(printed?.full && ground)) return false;
  const anchor = {
    x: ground.position.x,
    y: ground.y ?? 0,
    z: ground.position.z,
  };
  return boardTextPx(printed.em, viewportHeight, camera, anchor) >= LOD_SHOW_PX;
}

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
 * The four corners of a name's quad on the ground, as x, z pairs in the order
 * north-west, north-east, south-west, south-east of the upright print, which is the
 * order the texture coordinates are written in.
 *
 * Upright, the print sits centred under the building's south edge, where the default
 * camera sees it. Flipped, the whole quad turns 180 degrees about the building's
 * centre, which puts it on the north edge, the side the camera now looks from, and
 * turns the letters the right way up for it in the same step.
 */
export function labelCorners(
  centre: { x: number; z: number },
  footprint: number,
  width: number,
  height: number,
  flipped: boolean
): [number, number, number, number, number, number, number, number] {
  // Turning about the centre is negating the offset from it.
  const turn = flipped ? -1 : 1;
  const west = centre.x - (width / 2) * turn;
  const east = centre.x + (width / 2) * turn;
  const top = centre.z + (footprint / 2 + LABEL_INSET) * turn;
  const bottom = centre.z + (footprint / 2 + LABEL_INSET + height) * turn;
  return [west, top, east, top, west, bottom, east, bottom];
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
