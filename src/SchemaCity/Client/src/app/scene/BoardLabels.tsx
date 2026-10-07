// Every type's name printed flat on the board beside its building, the way a circuit
// board prints a reference designator next to a component, with the courtyard line
// round the component and its print. One canvas atlas holds every print and one
// mesh draws them all; `board-labels.ts` decides the text, the size, which names fit
// without touching and which way up they read.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SchemaNode, UsageReport } from "../../model/types";
import type { Placement } from "../layout/city";
import {
  type Arranged,
  arrangeNames,
  boardTextPx,
  COURTYARD_SEGMENTS,
  courtyard,
  fittedFontPx,
  type Interaction,
  LINE_HEIGHT,
  LINE_STEP,
  labelLight,
  labelsFlipped,
  packAtlas,
  printCorners,
  printStrength,
  printsFor,
  type Rect,
  type Sizes,
  type Standing,
} from "./board-labels";
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
 * hides a name, and under the roads at 0.05, so a trace runs over the silkscreen.
 */
const LABEL_Y = FOLDER_TINT_HEIGHT + 0.01;
/** The courtyard lines stand with the print. */
const COURTYARD_Y = LABEL_Y;
/** How far an Element Type's print leans toward amber, the colour of its building. */
const ELEMENT_TINT = 0.35;

/**
 * The types that have a floating label right now, which the label layer rewrites on
 * every repaint, and the types whose whole name the board prints legibly on screen,
 * which the board rewrites. Each side bumps its own version so the other can tell
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
  full: boolean;
  uv: [number, number, number, number];
  width: number;
  height: number;
};

type Atlas = {
  texture: THREE.CanvasTexture;
  entries: Entry[];
  /** Per type, every entry of its prints. */
  all: Map<string, number[]>;
  /** The entry of one print, by `printKey`. */
  byPrint: Map<string, number>;
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

/** One print's key: the type, its size and its place among that size's prints. */
const printKey = (id: string, at: { level: number; print: number }) =>
  `${id}|${at.level}|${at.print}`;

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
      full: one.fitted.full,
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
  const all = new Map([...levels].map(([id, sized]) => [id, sized.flat()]));
  const byPrint = new Map(
    planned.map((one, i) => [printKey(one.id, one), i] as const)
  );
  return { texture, entries, all, byPrint, sizes };
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
  const dynamic = (array: Float32Array, size: number) =>
    new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", dynamic(new Float32Array(count * 12), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", dynamic(colour, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
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

/**
 * Where the camera is and what it is looking at, read once per repaint so the
 * placement and the opacities share one picture.
 */
type View = {
  camera: THREE.Camera;
  viewportHeight: number;
  flipped: boolean;
  reveal: number;
};

/** Everything a repaint needs that does not change with the camera. */
type Inputs = {
  atlas: Atlas;
  geometry: THREE.BufferGeometry;
  courtyards: THREE.BufferGeometry;
  /** Every building where it stands now, in the city's order the courtyards follow. */
  standing: Placement[];
  interaction: Interaction;
  usage: UsageReport | undefined;
};

const SCRATCH = new THREE.Vector3();
const CORNERS: number[] = [];
const SEGMENTS = new Float32Array(COURTYARD_SEGMENTS * 4);

/** How many pixels one unit of print comes to at a building's ground, in this view. */
function pxPerEmAt(one: Standing, view: View): number {
  SCRATCH.set(one.position.x, groundOf(one), one.position.z);
  return boardTextPx(1, view.viewportHeight, view.camera.position, SCRATCH);
}

/** True when a building's ground point is inside the viewport and in front of it. */
function onScreen(one: Standing, camera: THREE.Camera): boolean {
  SCRATCH.set(one.position.x, groundOf(one), one.position.z).project(camera);
  return (
    Math.max(Math.abs(SCRATCH.x), Math.abs(SCRATCH.y)) <= 1 && SCRATCH.z < 1
  );
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

/** The entry placed for a type, or -1 for none. */
const placedEntry = (atlas: Atlas, id: string, spot: Arranged | undefined) =>
  spot ? (atlas.byPrint.get(printKey(id, spot)) ?? -1) : -1;

const NONE: number[] = [];

/**
 * Writes one type's prints: the one placed, if any, on its rectangle at `alpha`,
 * and every other entry of the type hidden.
 */
function writeName(
  inputs: Inputs,
  one: Standing,
  spot: Arranged | undefined,
  alpha: number,
  flipped: boolean
) {
  const positions = inputs.geometry.getAttribute("position")
    .array as Float32Array;
  const colours = inputs.geometry.getAttribute("color").array as Float32Array;
  for (const entry of inputs.atlas.all.get(one.id) ?? NONE)
    writeAlpha(colours, entry, 0);
  const shown = placedEntry(inputs.atlas, one.id, spot);
  if (shown < 0) return;
  writeQuad(
    positions,
    shown,
    (spot as Arranged).rect,
    flipped,
    groundOf(one) + LABEL_Y
  );
  writeAlpha(colours, shown, alpha);
}

/** Writes the courtyard in slot `slot`: round the part, and its print when it has one. */
function writeCourtyard(
  courtyards: THREE.BufferGeometry,
  slot: number,
  one: Standing,
  spot: Arranged | undefined,
  strength: number
) {
  const positions = courtyards.getAttribute("position").array as Float32Array;
  const colours = courtyards.getAttribute("color").array as Float32Array;
  SEGMENTS.fill(0);
  courtyard(one.position, one.footprint, spot?.rect ?? null, SEGMENTS, 0);
  const base = slot * COURTYARD_SEGMENTS * 2;
  const y = groundOf(one) + COURTYARD_Y;
  for (let v = 0; v < COURTYARD_SEGMENTS * 2; v++) {
    writePoint(positions, base + v, SEGMENTS, v, y);
    colours[(base + v) * 4 + 3] = strength;
  }
}

/**
 * True when a type's whole name is printed, visible, with its building's ground
 * on screen, which is what lets the floating label layer leave it out.
 */
function printedWhole(
  inputs: Inputs,
  one: Standing,
  spot: Arranged | undefined,
  alpha: number,
  camera: THREE.Camera
) {
  const entry = inputs.atlas.entries[placedEntry(inputs.atlas, one.id, spot)];
  return alpha > 0 && entry?.full === true && onScreen(one, camera);
}

/**
 * Places the names for one view and writes their quads, their opacities and the
 * courtyards. Returns the types whose whole name is printed legibly with its anchor
 * on screen.
 */
function repaint(
  inputs: Inputs,
  view: View,
  floated: Set<string>
): Set<string> {
  const arranged = arrangeNames(
    inputs.standing,
    inputs.atlas.sizes,
    (one) => pxPerEmAt(one, view),
    inputs.interaction,
    (id) => inputs.usage?.byType[id]?.total ?? 0,
    view.flipped
  );
  const printed = new Set<string>();
  inputs.standing.forEach((one, slot) => {
    const spot = arranged.get(one.id);
    const strength = printStrength(
      spot,
      floated.has(one.id),
      labelLight(one.id, inputs.interaction),
      view.reveal,
      one.flatten ?? 0
    );
    writeName(inputs, one, spot, strength.print, view.flipped);
    writeCourtyard(inputs.courtyards, slot, one, spot, strength.courtyard);
    if (printedWhole(inputs, one, spot, strength.print, view.camera))
      printed.add(one.id);
  });
  for (const geometry of [inputs.geometry, inputs.courtyards]) {
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("color").needsUpdate = true;
  }
  return printed;
}

/** True when two sets hold the same ids. */
const sameIds = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

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

export function BoardLabels({
  cityPlacements,
  nodesById,
  placementsById,
  interaction,
  floated,
  usage,
  palette,
  reducedMotion,
}: {
  /** The city's own placements, which decide every print and its size. */
  cityPlacements: readonly Placement[];
  nodesById: Map<string, SchemaNode>;
  /** Where each building stands right now, through a focus tween as well. */
  placementsById: Map<string, Placement>;
  interaction: Interaction;
  /** The types with a floating label right now, which print nothing here. */
  floated: Floated;
  /** Content counts, which rank a busier type's name ahead of a quieter one's. */
  usage: UsageReport | undefined;
  palette: { bright: string; amber: string; dim: string; mono: string };
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const height = useThree((state) => state.size.height);
  const { atlas, geometry, material, courtyards, lineMaterial } = useNameMesh(
    cityPlacements,
    nodesById,
    palette
  );

  const inputs = useMemo(
    (): Inputs => ({
      atlas,
      geometry,
      courtyards,
      // A building the screen has not reached yet, for the one render a new schema
      // takes, stands where the city put it.
      standing: cityPlacements.map(
        (placement) => placementsById.get(placement.id) ?? placement
      ),
      interaction,
      usage,
    }),
    [
      atlas,
      geometry,
      courtyards,
      cityPlacements,
      placementsById,
      interaction,
      usage,
    ]
  );
  // What the last repaint was made from, so a still frame can tell it has nothing
  // to write.
  const written = useRef({ key: [] as unknown[], camera: new THREE.Matrix4() });
  const flipped = useRef(false);
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    camera.getWorldDirection(forward);
    flipped.current = labelsFlipped(forward.x, forward.z, flipped.current);
    const reveal = revealAt(state.clock.elapsedTime, reducedMotion).links;
    const key = [inputs, reveal, floated.version, flipped.current, height];
    const last = written.current;
    if (
      key.every((value, i) => value === last.key[i]) &&
      camera.matrixWorld.equals(last.camera)
    )
      return;
    const printed = repaint(
      inputs,
      { camera, viewportHeight: height, flipped: flipped.current, reveal },
      floated.ids
    );
    if (!sameIds(printed, floated.printed)) {
      floated.printed = printed;
      floated.printedVersion += 1;
    }
    last.key = key;
    last.camera.copy(camera.matrixWorld);
  });

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
        geometry={geometry}
        material={material}
        // After the boards, before the buildings and the traces, which draw over it.
        renderOrder={-0.5}
      />
    </>
  );
}
