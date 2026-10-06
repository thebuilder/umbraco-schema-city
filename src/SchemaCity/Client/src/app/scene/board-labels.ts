// The type names printed on the board in front of each building, the way a PCB prints
// a reference designator in silkscreen beside its component. Pure: no three.js, no
// React, no DOM. scene/BoardLabels.tsx rasterises and draws what this decides.
import { pixelsPerUnit } from "./stage";

/**
 * Text size in world units per unit of footprint. A building's name is as big as the
 * building can carry, so a small type gets small print and a large one larger print,
 * and the board keeps the proportions a real one has.
 */
const EM_PER_FOOTPRINT = 0.17;
/** Smallest print, so the smallest footprint still reads once the camera comes close. */
export const MIN_EM = 0.45;
/**
 * Largest print. The strip the layout leaves in front of a row holds this with room
 * to spare, so a larger footprint widens the name's line but not its height.
 */
export const MAX_EM = 0.8;
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
 * How far past its footprint a name may run, in world units, split over both sides.
 * Two buildings in a row stand 1.5 units apart, so this leaves 0.6 of bare board
 * between two names that both use it.
 */
const OVERHANG = 0.9;
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

/** What a building of `footprint` prints of `name`, and how big. */
export function boardText(name: string, footprint: number): BoardText {
  const em = labelEm(footprint);
  const chars = Math.floor((footprint + OVERHANG) / (em * MONO_ADVANCE));
  const text = truncate(name, chars);
  return { text, em, full: text === name };
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
): number[] {
  const top = centre.z + footprint / 2 + LABEL_INSET;
  const corners = [
    centre.x - width / 2,
    top,
    centre.x + width / 2,
    top,
    centre.x - width / 2,
    top + height,
    centre.x + width / 2,
    top + height,
  ];
  if (!flipped) return corners;
  return corners.map((value, i) =>
    i % 2 === 0 ? 2 * centre.x - value : 2 * centre.z - value
  );
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
