// Every type's name printed flat on the board beside its building, the way a circuit
// board prints a reference designator next to a component, with the courtyard line
// round the component and its print. One canvas atlas holds every print and one
// mesh draws them all; `board-labels.ts` decides the text, the size, which names fit
// without touching and which way up they read.
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SchemaNode, UsageReport } from "../../model/types";
import type { Placement } from "../layout/city";
import {
  BASE_OPACITY,
  boardTextPx,
  COURTYARD_SEGMENTS,
  courtyard,
  FADE_SECONDS,
  type Fades,
  fittedFontPx,
  type Interaction,
  KNOCKOUT_VERTICES,
  knockout,
  knockoutAlpha,
  LINE_HEIGHT,
  LINE_STEP,
  labelLight,
  labelsFlipped,
  type NameView,
  newFades,
  type Placed,
  PRINT_LEVELS,
  packAtlas,
  placedAt,
  printCorners,
  printStrength,
  printsFor,
  type Rect,
  type Sizes,
  type Solution,
  type Standing,
  solveNames,
  stepName,
  type Trace,
  traceIndex,
  updateTiers,
} from "./board-labels";
import { introPlaying } from "./connection-visibility";
import { useAnimationFrame } from "./frames";
import { revealAt } from "./reveal";
import { FOLDER_TINT_HEIGHT } from "./stage";

/**
 * Font size the names are rasterised at, in CSS pixels before the device pixel
 * ratio. A name is legible from 7 px and the camera can come down to where the print
 * is several times that, so the raster carries 24 and lets the mipmaps take it down.
 */
const ATLAS_FONT_PX = 24;
/** The smallest raster a schema too large for the atlas is shrunk to. */
const MIN_ATLAS_FONT_PX = 8;
/** Heavier than the chrome's mono, so a stroke survives the mipmap at a distance. */
const ATLAS_WEIGHT = 600;
/** Atlas width in CSS pixels; the rows grow down to fit every name. */
const ATLAS_WIDTH = 2048;
/**
 * The most memory the atlas may take, mipmaps included. A texture of the largest
 * size a GPU allows is 256 MB at 8192 square, which is more than a page should hold
 * for names.
 */
const ATLAS_BUDGET = 64 * 1024 * 1024;
/** Transparent pixels around each name, so a mipmap does not bleed one into the next. */
const ATLAS_PAD = 4;
/**
 * How high the print stands: over the nested folder tints at 0.02, so a folder never
 * hides a name. The roads stand higher, at 0.05, but write no depth, and the print
 * draws after them, so a print over a trace lies on top with its knockout under it.
 */
const LABEL_Y = FOLDER_TINT_HEIGHT + 0.01;
/** The courtyard lines stand with the print. */
const COURTYARD_Y = LABEL_Y;
/** How far an Element Type's print leans toward amber, the colour of its building. */
const ELEMENT_TINT = 0.35;
/**
 * How solid the bare board under a print over a trace is, against the print's own
 * strength: enough to push the trace under the letters, and a little of the trace
 * still shows through, so it reads as passing under rather than stopping.
 */
const KNOCKOUT_OPACITY = 0.85;

/**
 * The types that have a floating label right now, which the label layer rewrites on
 * every repaint, and the types whose whole name the board prints legibly at its
 * board's current size, which the board rewrites. Each side bumps its own version so the other can tell
 * its picture is stale.
 */
export type Floated = {
  ids: Set<string>;
  version: number;
  printed: Set<string>;
  printedVersion: number;
};

/** One print in the atlas: whose it is, where it sits in the texture, its size. */
type Entry = {
  id: string;
  text: string;
  /** Which of the `PRINT_LEVELS` it is printed at. */
  level: number;
  full: boolean;
  /** True for whole leading words and an ellipsis. */
  cut: boolean;
  uv: [number, number, number, number];
  width: number;
  height: number;
};

type Atlas = {
  texture: THREE.CanvasTexture;
  entries: Entry[];
  /** Per type, per size, per print, the entry. */
  index: Map<string, number[][]>;
  /** Per type, its sizes and its prints' measures, as the placement reads them. */
  sizes: Map<string, Sizes>;
};

/** Each print's width and height at `fontPx`, and where the rows put it. */
function measureAll(
  context: CanvasRenderingContext2D,
  texts: readonly string[],
  font: string,
  fontPx: number,
  width: number
) {
  context.font = `${ATLAS_WEIGHT} ${fontPx}px ${font}`;
  const widths = texts.map((text) =>
    Math.min(
      width - ATLAS_PAD * 2,
      Math.ceil(
        Math.max(
          ...text.split("\n").map((line) => context.measureText(line).width)
        )
      )
    )
  );
  const heights = texts.map((text) =>
    Math.ceil(
      fontPx * (LINE_HEIGHT + (text.split("\n").length - 1) * LINE_STEP)
    )
  );
  return {
    fontPx,
    widths,
    heights,
    packed: packAtlas(widths, heights, width, ATLAS_PAD),
  };
}

/** Decides every print and rasterises them all into one texture, packed in rows. */
function buildAtlas(
  placements: readonly Placement[],
  nodesById: Map<string, SchemaNode>,
  font: string,
  ratio: number,
  gl: THREE.WebGLRenderer
): Atlas {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  // The cuts are measured in the real face, so a wide glyph, an ideograph or an
  // emoji, takes the room it really needs rather than a mono cell's.
  context.font = `${ATLAS_WEIGHT} 100px ${font}`;
  const measure = (text: string) => context.measureText(text).width / 100;
  const decided = printsFor(
    placements,
    (id) => nodesById.get(id)?.name,
    measure
  );

  const planned = [...decided].flatMap(([id, sized]) =>
    sized.flatMap(({ em, prints }, level) =>
      prints.map((fitted, print) => ({ id, level, print, fitted, em }))
    )
  );
  // A name printed whole at two sizes is one raster, drawn at two sizes. Names on
  // one line pack first, so the rows of two-line names share their height.
  const texts = [...new Set(planned.map((one) => one.fitted.text))].sort(
    (a, b) => a.split("\n").length - b.split("\n").length
  );
  const slot = new Map(texts.map((text, i) => [text, i]));

  const scale = Math.min(ratio, 2);
  const width = Math.min(
    gl.capabilities.maxTextureSize,
    Math.round(ATLAS_WIDTH * scale)
  );
  // A third more for the mipmaps.
  const maxHeight = Math.min(
    gl.capabilities.maxTextureSize,
    Math.floor(ATLAS_BUDGET / (width * 4 * (4 / 3)))
  );
  let fit = measureAll(
    context,
    texts,
    font,
    Math.round(ATLAS_FONT_PX * scale),
    width
  );
  // A schema too big for one texture at full size gets smaller print. The packed
  // area falls with the square of the font, so each pass shrinks it by the square
  // root of the overflow; past the floor, the rows that do not fit are left blank.
  while (fit.packed.height > maxHeight && fit.fontPx > MIN_ATLAS_FONT_PX)
    fit = measureAll(
      context,
      texts,
      font,
      fittedFontPx(fit.fontPx, fit.packed.height, maxHeight, MIN_ATLAS_FONT_PX),
      width
    );

  canvas.width = width;
  canvas.height = Math.max(1, Math.min(maxHeight, fit.packed.height));
  // Sizing the canvas reset the font, so it is set again before drawing. White ink:
  // the vertex colour tints it, so one atlas serves every colour.
  context.font = `${ATLAS_WEIGHT} ${fit.fontPx}px ${font}`;
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  // Each line centred on the print, so a two-line name sits square under its part.
  context.textAlign = "center";
  texts.forEach((text, i) => {
    const spot = fit.packed.spots[i] as { x: number; y: number };
    if (spot.y + (fit.heights[i] as number) > canvas.height) return;
    text.split("\n").forEach((line, k) => {
      context.fillText(
        line,
        spot.x + (fit.widths[i] as number) / 2,
        spot.y + (fit.fontPx * LINE_HEIGHT) / 2 + k * fit.fontPx * LINE_STEP
      );
    });
  });
  const levels = new Map(
    [...decided].map(([id, sized]) => [id, sized.map((): number[] => [])])
  );
  const entries = planned.map((one, i): Entry => {
    const at = slot.get(one.fitted.text) as number;
    const spot = fit.packed.spots[at] as { x: number; y: number };
    const w = fit.widths[at] as number;
    const h = fit.heights[at] as number;
    const clipped = spot.y + h > canvas.height;
    levels.get(one.id)?.[one.level]?.push(i);
    return {
      id: one.id,
      text: one.fitted.text,
      level: one.level,
      full: one.fitted.full,
      cut: !one.fitted.full && one.fitted.text.endsWith("…"),
      // The texture is flipped on upload, so the canvas's top row is v = 1.
      uv: [
        spot.x / width,
        1 - spot.y / canvas.height,
        (spot.x + w) / width,
        1 - (spot.y + h) / canvas.height,
      ],
      // A print the atlas had no room for takes no room on the board either.
      width: clipped ? 0 : (one.em * w) / fit.fontPx,
      height: clipped ? 0 : (one.em * h) / fit.fontPx,
    };
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The print lies on the ground and is always read at an angle; a plain mipmap
  // smears the letters along the view, anisotropic filtering keeps them.
  texture.anisotropy = gl.capabilities.getMaxAnisotropy();
  const sizes = new Map(
    [...decided].map(([id, sized]): [string, Sizes] => [
      id,
      {
        ems: sized.map((one) => one.em),
        levels: (levels.get(id) ?? []).map((level) =>
          level.map((e) => entries[e] as Entry)
        ),
      },
    ])
  );
  return { texture, entries, index: levels, sizes };
}

/** The mesh's buffers for one atlas: positions and opacities are rewritten later. */
function buildGeometry(
  atlas: Atlas,
  nodesById: Map<string, SchemaNode>,
  bright: THREE.Color,
  amber: THREE.Color
): THREE.BufferGeometry {
  const count = atlas.entries.length;
  const uv = new Float32Array(count * 8);
  const colour = new Float32Array(count * 16);
  const index = new Uint32Array(count * 6);
  const tinted = bright.clone().lerp(amber, ELEMENT_TINT);
  atlas.entries.forEach((entry, i) => {
    const [u0, v0, u1, v1] = entry.uv;
    // North-west, north-east, south-west, south-east, as printCorners writes them.
    uv.set([u0, v0, u1, v0, u0, v1, u1, v1], i * 8);
    const { r, g, b } = nodesById.get(entry.id)?.isElement ? tinted : bright;
    colour.set([r, g, b, 0, r, g, b, 0, r, g, b, 0, r, g, b, 0], i * 16);
    const at = i * 4;
    // Wound so the face points up.
    index.set([at, at + 2, at + 1, at + 1, at + 2, at + 3], i * 6);
  });
  const geometry = new THREE.BufferGeometry();
  // What each quad says, for reading the board back from the devtools.
  geometry.userData.entries = atlas.entries;
  const dynamic = (array: Float32Array, size: number) =>
    new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", dynamic(new Float32Array(count * 12), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", dynamic(colour, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/**
 * The bare board under the prints that lie over a trace: one rounded patch per
 * building in its board's colour, lit like the board, rewritten in place.
 */
function buildKnockouts(
  placements: readonly Placement[],
  boardColours: Map<string, THREE.Color>
) {
  const vertices = placements.length * KNOCKOUT_VERTICES;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  const normals = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) normals[i * 3 + 1] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  const colours = new Float32Array(vertices * 4);
  placements.forEach((placement, slot) => {
    const { r, g, b } =
      boardColours.get(placement.district) ?? new THREE.Color();
    for (let v = 0; v < KNOCKOUT_VERTICES; v++)
      colours.set([r, g, b, 0], (slot * KNOCKOUT_VERTICES + v) * 4);
  });
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colours, 4).setUsage(THREE.DynamicDrawUsage)
  );
  return geometry;
}

/** The courtyard lines: a fixed number of segments per building, rewritten in place. */
function buildCourtyards(count: number, colour: THREE.Color) {
  const vertices = count * COURTYARD_SEGMENTS * 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  const colours = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++)
    colours.set([colour.r, colour.g, colour.b, 0], i * 4);
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colours, 4).setUsage(THREE.DynamicDrawUsage)
  );
  return geometry;
}

const groundOf = (placement: { y?: number }) => placement.y ?? 0;

/** Where the camera is and what it is looking at, read once per repaint. */
type Frame = {
  camera: THREE.Camera;
  viewportHeight: number;
  flipped: boolean;
  reveal: number;
  /** How far a fade moves this repaint, 1 for at once. */
  step: number;
  fades: Fades;
};

/** Everything a repaint needs that does not change with the camera. */
type Inputs = {
  atlas: Atlas;
  geometry: THREE.BufferGeometry;
  courtyards: THREE.BufferGeometry;
  knockouts: THREE.BufferGeometry;
  /** The drawn traces through a rectangle on the board. */
  traceAt: (rect: Rect) => Trace[];
  /** Every building where it stands now, in the city's order the courtyards follow. */
  standing: Placement[];
  /** Every building where the solution placed it, in the same order. */
  settled: Placement[];
  solution: Solution;
  interaction: Interaction;
};

const LEVELS = PRINT_LEVELS.length;
const SCRATCH = new THREE.Vector3();
const CORNERS: number[] = [];
const SEGMENTS = new Float32Array(COURTYARD_SEGMENTS * 4);
const PATCH = new Float32Array(KNOCKOUT_VERTICES * 2);
const SHIFTED: Rect = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
const STRENGTH = { print: 0, courtyard: 0 };
const NOW: NameView = { id: "", perEm: 0, ems: [] };
const NO_ENTRIES: number[][] = [];
const NO_EMS: readonly number[] = [];

const positionsOf = (geometry: THREE.BufferGeometry) =>
  geometry.getAttribute("position").array as Float32Array;
const coloursOf = (geometry: THREE.BufferGeometry) =>
  geometry.getAttribute("color").array as Float32Array;

/** How many pixels one unit of print comes to at a building's ground, in this view. */
function pxPerEmAt(one: Standing, frame: Frame): number {
  SCRATCH.set(one.position.x, groundOf(one), one.position.z);
  return boardTextPx(1, frame.viewportHeight, frame.camera.position, SCRATCH);
}

/**
 * `rect` moved by how far a building stands from where the solution placed it,
 * which is only ever non-zero during a focus tween. Writes into one shared rectangle.
 */
function shifted(rect: Rect, one: Standing, settled: Standing): Rect {
  const dx = one.position.x - settled.position.x;
  const dz = one.position.z - settled.position.z;
  SHIFTED.minX = rect.minX + dx;
  SHIFTED.maxX = rect.maxX + dx;
  SHIFTED.minZ = rect.minZ + dz;
  SHIFTED.maxZ = rect.maxZ + dz;
  return SHIFTED;
}

/** Lays one entry's quad on its rectangle, at the height of its building's ground. */
function writeQuad(
  positions: Float32Array,
  entry: number,
  rect: Rect,
  flipped: boolean,
  y: number
) {
  printCorners(rect, flipped, CORNERS);
  for (let k = 0; k < 4; k++)
    writePoint(positions, entry * 4 + k, CORNERS, k, y);
}

/**
 * Writes the `k`th x, z pair of `pairs` at height `y` as vertex `vertex`, in place,
 * so a repaint while the camera moves allocates nothing per name.
 */
function writePoint(
  positions: Float32Array,
  vertex: number,
  pairs: ArrayLike<number>,
  k: number,
  y: number
) {
  positions[vertex * 3] = pairs[k * 2] as number;
  positions[vertex * 3 + 1] = y;
  positions[vertex * 3 + 2] = pairs[k * 2 + 1] as number;
}

/** Sets the opacity of all four corners of one entry's quad. */
function writeAlpha(colours: Float32Array, entry: number, alpha: number) {
  for (let k = 0; k < 4; k++) colours[entry * 16 + k * 4 + 3] = alpha;
}

/** The atlas entry of a type's print at one size, or -1. */
const entryAt = (
  atlas: Atlas,
  id: string,
  level: number,
  spot: Placed | undefined
) => (spot ? (atlas.index.get(id)?.[level]?.[spot.print] ?? -1) : -1);

/**
 * Writes the print of the type in slot `slot` at one size, on its place, at `alpha`
 * times how far that size has faded in. A size faded out writes nothing.
 */
function writeLevel(
  inputs: Inputs,
  frame: Frame,
  slot: number,
  level: number,
  alpha: number
) {
  const one = inputs.standing[slot] as Placement;
  const spot = placedAt(inputs.solution, frame.flipped, level, one.id);
  const entry = entryAt(inputs.atlas, one.id, level, spot);
  const presence = frame.fades.presence[slot * LEVELS + level] as number;
  if (entry < 0 || presence === 0) return;
  writeQuad(
    positionsOf(inputs.geometry),
    entry,
    shifted((spot as Placed).rect, one, inputs.settled[slot] as Placement),
    frame.flipped,
    groundOf(one) + LABEL_Y
  );
  writeAlpha(coloursOf(inputs.geometry), entry, alpha * presence);
}

/** Every print of a type hidden, before the ones that show are written. */
function hideName(inputs: Inputs, id: string) {
  const colours = coloursOf(inputs.geometry);
  for (const level of inputs.atlas.index.get(id) ?? NO_ENTRIES)
    for (const entry of level) writeAlpha(colours, entry, 0);
}

/**
 * Fades the type in slot `slot` toward what its board shows now and writes its
 * prints: the one at its board's size when it reads, and the one at the size before
 * while it fades out. Returns the size it shows at, or -1.
 */
function writeName(
  inputs: Inputs,
  frame: Frame,
  slot: number,
  alpha: number
): number {
  const one = inputs.standing[slot] as Placement;
  NOW.id = one.id;
  NOW.perEm = pxPerEmAt(one, frame);
  NOW.ems = inputs.atlas.sizes.get(one.id)?.ems ?? NO_EMS;
  const shown = stepName(frame.fades, inputs.solution, slot, NOW, frame);
  hideName(inputs, one.id);
  for (let level = 0; level < LEVELS; level++)
    writeLevel(inputs, frame, slot, level, alpha);
  return shown;
}

/** Writes the courtyard in slot `slot`: round the part, and its print when it has one. */
function writeCourtyard(
  inputs: Inputs,
  slot: number,
  spot: Placed | undefined,
  strength: number
) {
  const one = inputs.standing[slot] as Placement;
  const positions = positionsOf(inputs.courtyards);
  const colours = coloursOf(inputs.courtyards);
  SEGMENTS.fill(0);
  courtyard(
    one.position,
    one.footprint,
    spot ? shifted(spot.rect, one, inputs.settled[slot] as Placement) : null,
    SEGMENTS,
    0
  );
  const base = slot * COURTYARD_SEGMENTS * 2;
  const y = groundOf(one) + COURTYARD_Y;
  for (let v = 0; v < COURTYARD_SEGMENTS * 2; v++) {
    writePoint(positions, base + v, SEGMENTS, v, y);
    colours[(base + v) * 4 + 3] = strength;
  }
}

/**
 * Writes the knockout in slot `slot`: under the print when it lies over a trace, at
 * `alpha`, and gone otherwise. A trace the hover or the selection lights keeps its
 * print's knockout off, so the lit path shows the whole way.
 */
function writeKnockout(
  inputs: Inputs,
  slot: number,
  spot: Placed | undefined,
  alpha: number
) {
  const one = inputs.standing[slot] as Placement;
  const positions = positionsOf(inputs.knockouts);
  const colours = coloursOf(inputs.knockouts);
  const shown = knockoutAlpha(spot, alpha, inputs.traceAt, inputs.interaction);
  // A hidden knockout keeps whatever corners the last one left; it draws nothing.
  if (spot && shown > 0)
    knockout(
      shifted(spot.rect, one, inputs.settled[slot] as Placement),
      PATCH,
      0
    );
  const base = slot * KNOCKOUT_VERTICES;
  const y = groundOf(one) + LABEL_Y;
  for (let v = 0; v < KNOCKOUT_VERTICES; v++) {
    writePoint(positions, base + v, PATCH, v, y);
    colours[(base + v) * 4 + 3] = shown;
  }
}

/**
 * How solid a type's print and courtyard are now. Only the hovered or selected type
 * gives its print up to its floating label; every other name stays where it is.
 */
function strengthOf(
  inputs: Inputs,
  frame: Frame,
  floated: Set<string>,
  one: Placement
) {
  const { hovered, selected } = inputs.interaction;
  const own = one.id === hovered || one.id === selected;
  return printStrength(
    own && floated.has(one.id),
    labelLight(one.id, inputs.interaction),
    frame.reveal,
    one.flatten ?? 0,
    STRENGTH
  );
}

/**
 * Records whether the type in slot `slot` prints its whole name legibly at its
 * board's size, and returns true when that changed.
 */
function notePrinted(
  inputs: Inputs,
  fades: Fades,
  slot: number,
  level: number,
  spot: Placed | undefined
): boolean {
  const { id } = inputs.standing[slot] as Placement;
  const entry = entryAt(inputs.atlas, id, level, spot);
  const printed = inputs.atlas.entries[entry]?.full ? 1 : 0;
  const changed = fades.printed[slot] !== printed;
  fades.printed[slot] = printed;
  return changed;
}

/**
 * Writes the type in slot `slot`: its prints, its courtyard and its knockout.
 * Returns true when whether it prints its whole name legibly changed.
 */
function paintName(
  inputs: Inputs,
  frame: Frame,
  floated: Set<string>,
  slot: number
): boolean {
  const one = inputs.standing[slot] as Placement;
  const strength = strengthOf(inputs, frame, floated, one);
  const shown = writeName(inputs, frame, slot, strength.print);
  const spot = placedAt(inputs.solution, frame.flipped, shown, one.id);
  const presence = spot
    ? (frame.fades.presence[slot * LEVELS + shown] as number)
    : 0;
  writeCourtyard(inputs, slot, spot, strength.courtyard);
  writeKnockout(
    inputs,
    slot,
    spot,
    (KNOCKOUT_OPACITY * strength.print * presence) / BASE_OPACITY
  );
  return notePrinted(inputs, frame.fades, slot, shown, spot);
}

/** Tells three.js the names', courtyards' and knockouts' buffers have been written. */
function markWritten(inputs: Inputs) {
  for (const geometry of [
    inputs.geometry,
    inputs.courtyards,
    inputs.knockouts,
  ]) {
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("color").needsUpdate = true;
  }
}

/**
 * Writes every name's quads and opacities and the courtyards for one view. The
 * places come from the solution, so the camera only picks each board's size, which
 * prints read, and how far each fade has gone. Returns true when the set of whole
 * names printed legibly changed.
 */
function repaint(inputs: Inputs, frame: Frame, floated: Set<string>): boolean {
  if (frame.fades.fresh) frame.step = 1;
  updateTiers(
    frame.fades,
    inputs.solution.boards,
    frame.camera.position,
    frame.viewportHeight
  );
  frame.fades.moving = false;
  let printedChanged = false;
  for (let slot = 0; slot < inputs.standing.length; slot++)
    printedChanged = paintName(inputs, frame, floated, slot) || printedChanged;
  markWritten(inputs);
  frame.fades.fresh = false;
  return printedChanged;
}

/**
 * The atlas, the meshes' geometries and their materials, each built when what it
 * depends on changes and disposed on its own.
 */
function useNameMesh(
  placements: readonly Placement[],
  nodesById: Map<string, SchemaNode>,
  palette: { bright: string; amber: string; dim: string; mono: string }
) {
  const gl = useThree((state) => state.gl);
  const ratio = useThree((state) => state.viewport.dpr);
  // A web font that arrives after the first raster would leave the fallback face in
  // the atlas, so the atlas is drawn again once the page's fonts have loaded, and
  // only then, when they had not loaded already.
  const [fontsReady, setFontsReady] = useState(
    () => document.fonts.status === "loaded"
  );
  useEffect(() => {
    if (fontsReady) return;
    let live = true;
    document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, [fontsReady]);

  const atlas = useMemo(
    () => buildAtlas(placements, nodesById, palette.mono, ratio, gl),
    // fontsReady is a trigger: the same inputs rasterise differently once it flips.
    [placements, nodesById, palette.mono, ratio, gl, fontsReady]
  );
  useEffect(() => () => atlas.texture.dispose(), [atlas]);
  const geometry = useMemo(
    () =>
      buildGeometry(
        atlas,
        nodesById,
        new THREE.Color(palette.bright),
        new THREE.Color(palette.amber)
      ),
    [atlas, nodesById, palette.bright, palette.amber]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: atlas.texture,
        // A four-component colour attribute carries each name's own opacity.
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    [atlas]
  );
  useEffect(() => () => material.dispose(), [material]);
  const courtyards = useMemo(
    () => buildCourtyards(placements.length, new THREE.Color(palette.dim)),
    [placements, palette.dim]
  );
  useEffect(() => () => courtyards.dispose(), [courtyards]);
  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => () => lineMaterial.dispose(), [lineMaterial]);
  return { atlas, geometry, material, courtyards, lineMaterial };
}

/** The knockouts' geometry and material, each built when what it depends on changes. */
function useKnockouts(
  placements: readonly Placement[],
  boardColours: Map<string, THREE.Color>
) {
  const knockouts = useMemo(
    () => buildKnockouts(placements, boardColours),
    [placements, boardColours]
  );
  useEffect(() => () => knockouts.dispose(), [knockouts]);
  // Lit like the board's own mask, so the patch matches the board under it.
  const knockoutMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      }),
    []
  );
  useEffect(() => () => knockoutMaterial.dispose(), [knockoutMaterial]);
  return { knockouts, knockoutMaterial };
}

/** What the last repaint was made from, so a still frame can tell it has nothing to write. */
type Written = { key: unknown[]; camera: THREE.Matrix4; moving: boolean };

const unchanged = (last: Written, key: unknown[], camera: THREE.Camera) =>
  !last.moving &&
  key.every((value, i) => value === last.key[i]) &&
  camera.matrixWorld.equals(last.camera);

/** Hands the label layer the types whose whole name the board now prints legibly. */
function publishPrinted(inputs: Inputs, fades: Fades, floated: Floated) {
  floated.printed = new Set(
    inputs.standing
      .filter((_, slot) => fades.printed[slot] === 1)
      .map((one) => one.id)
  );
  floated.printedVersion += 1;
}

/**
 * Repaints the names on every frame the camera, the inputs, the intro, the floated
 * set or the way up has moved since the last one, or a fade is still under way, and
 * tells the label layer which whole names the board now prints.
 */
function useRepaint(inputs: Inputs, floated: Floated, reducedMotion: boolean) {
  const camera = useThree((state) => state.camera);
  const height = useThree((state) => state.size.height);
  // A new solution starts its fades afresh; the hover and the selection do not.
  const fades = useMemo(
    () => newFades(inputs.standing.length),
    [inputs.solution, inputs.standing.length]
  );
  const written = useRef<Written>({
    key: [],
    camera: new THREE.Matrix4(),
    moving: false,
  });
  const flipped = useRef(false);
  const forward = useMemo(() => new THREE.Vector3(), []);

  /** One frame's repaint, if anything moved; true while it needs another frame. */
  const paint = (elapsed: number, step: number): boolean => {
    camera.getWorldDirection(forward);
    flipped.current = labelsFlipped(forward.x, forward.z, flipped.current);
    const reveal = revealAt(elapsed, reducedMotion).links;
    const key = [
      inputs,
      fades,
      reveal,
      floated.version,
      flipped.current,
      height,
    ];
    const last = written.current;
    if (unchanged(last, key, camera)) return false;
    const frame: Frame = {
      camera,
      viewportHeight: height,
      flipped: flipped.current,
      reveal,
      step,
      fades,
    };
    // A new printed set changes what the floating labels leave out, and they read
    // it on the next frame, so publishing one asks for that frame.
    const published = repaint(inputs, frame, floated.ids);
    if (published) publishPrinted(inputs, fades, floated);
    last.key = key;
    last.camera.copy(camera.matrixWorld);
    last.moving = fades.moving;
    return fades.moving || published;
  };

  useAnimationFrame(
    (state, delta) =>
      paint(
        state.clock.elapsedTime,
        reducedMotion ? 1 : delta / FADE_SECONDS
      ) || introPlaying(state.clock.elapsedTime, reducedMotion)
  );
}

export function BoardLabels({
  cityPlacements,
  nodesById,
  placementsById,
  settledById,
  interaction,
  floated,
  usage,
  palette,
  reducedMotion,
  traces,
  boardColours,
}: {
  /** The city's own placements, which decide every print and its size. */
  cityPlacements: readonly Placement[];
  nodesById: Map<string, SchemaNode>;
  /** Where each building stands right now, through a focus tween as well. */
  placementsById: Map<string, Placement>;
  /** Where each building stands once a focus tween has settled, which the names are placed for. */
  settledById: Map<string, Placement>;
  interaction: Interaction;
  /** The types with a floating label right now; the hovered and selected print nothing here. */
  floated: Floated;
  /** Content counts, which rank a busier type's name ahead of a quieter one's. */
  usage: UsageReport | undefined;
  palette: { bright: string; amber: string; dim: string; mono: string };
  reducedMotion: boolean;
  /** The ground traces of the layers drawn now, which a print keeps off where it can. */
  traces: readonly Trace[];
  /** Each board's colour by district id, for the bare board under a print. */
  boardColours: Map<string, THREE.Color>;
}) {
  const { atlas, geometry, material, courtyards, lineMaterial } = useNameMesh(
    cityPlacements,
    nodesById,
    palette
  );
  const { knockouts, knockoutMaterial } = useKnockouts(
    cityPlacements,
    boardColours
  );
  const traceAt = useMemo(() => traceIndex(traces), [traces]);
  const settled = useMemo(
    () =>
      cityPlacements.map(
        (placement) => settledById.get(placement.id) ?? placement
      ),
    [cityPlacements, settledById]
  );
  const solution = useMemo(
    () =>
      solveNames(
        settled,
        atlas.sizes,
        (id) => usage?.byType[id]?.total ?? 0,
        (rect) => traceAt(rect).length > 0
      ),
    [settled, atlas, usage, traceAt]
  );

  const inputs = useMemo(
    (): Inputs => ({
      atlas,
      geometry,
      courtyards,
      knockouts,
      traceAt,
      // A building the screen has not reached yet, for the one render a new schema
      // takes, stands where the city put it.
      standing: cityPlacements.map(
        (placement) => placementsById.get(placement.id) ?? placement
      ),
      settled,
      solution,
      interaction,
    }),
    [
      atlas,
      geometry,
      courtyards,
      knockouts,
      traceAt,
      cityPlacements,
      placementsById,
      settled,
      solution,
      interaction,
    ]
  );
  useRepaint(inputs, floated, reducedMotion);

  return (
    <>
      <lineSegments
        frustumCulled={false}
        geometry={courtyards}
        material={lineMaterial}
        renderOrder={-0.5}
      />
      <mesh
        frustumCulled={false}
        geometry={knockouts}
        material={knockoutMaterial}
        receiveShadow
        // Over the traces, under the print it clears the board for.
        renderOrder={0.4}
      />
      <mesh
        frustumCulled={false}
        geometry={geometry}
        material={material}
        // After the boards and the traces, which pass under it, and before glass
        // and the roof icons.
        renderOrder={0.5}
      />
    </>
  );
}
