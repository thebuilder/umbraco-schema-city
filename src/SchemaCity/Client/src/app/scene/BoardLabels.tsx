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
  boardTextPx,
  byPriority,
  COURTYARD_SEGMENTS,
  courtyard,
  type Fitted,
  fitName,
  fittedFontPx,
  type Interaction,
  LINE_HEIGHT,
  labelEm,
  labelLight,
  labelOpacity,
  labelRoom,
  labelsFlipped,
  longRoom,
  type Placed,
  PRINT_LEVELS,
  packAtlas,
  placeLabels,
  printCorners,
  printLevel,
  type Ranked,
  type Rect,
  sharedPrefix,
  type Want,
  worthPrinting,
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
/** How solid a courtyard line is at rest: an outline, under everything it frames. */
const COURTYARD_OPACITY = 0.22;
/** How far an Element Type's print leans toward amber, the colour of its building. */
const ELEMENT_TINT = 0.35;
/** A building pressed this far flat by focus mode is a map, not a part with a name. */
const FLAT = 0.5;

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
  /** Its place among the prints of its size, widest first. */
  print: number;
  full: boolean;
  uv: [number, number, number, number];
  width: number;
  height: number;
};

/** A name at one size: the size, and its prints at that size, widest first. */
type Level = { em: number; entries: number[] };

type Atlas = {
  texture: THREE.CanvasTexture;
  entries: Entry[];
  /** Each type's sizes, smallest first. */
  labels: Map<string, { ems: number[]; levels: Level[] }>;
};

/**
 * What each type prints at each of its sizes: its whole name, or as much of it as
 * fits clear of its neighbours, half way to its own column, and in its own column.
 */
function printsOf(
  placements: readonly Placement[],
  nodesById: Map<string, SchemaNode>,
  measure: (text: string) => number
): Map<string, { em: number; prints: Fitted[] }[]> {
  const room = labelRoom(placements);
  // Names on one board share their leading words more often than not, Element on
  // the elements board, so a cut drops those first.
  const names = new Map<string, string[]>();
  for (const placement of placements) {
    const name = nodesById.get(placement.id)?.name;
    if (name === undefined) continue;
    const list = names.get(placement.district) ?? [];
    list.push(name);
    names.set(placement.district, list);
  }
  const prefixes = new Map(
    [...names].map(([district, list]) => [district, sharedPrefix(list)])
  );

  const prints = new Map<string, { em: number; prints: Fitted[] }[]>();
  for (const placement of placements) {
    const node = nodesById.get(placement.id);
    if (!node) continue;
    const full = labelEm(placement.footprint);
    const prefix = prefixes.get(placement.district) ?? "";
    // Widest first, so a name clear of its neighbours prints as much as it can, and
    // one hemmed in by them still has a shorter cut to try.
    const rooms = [
      longRoom(placement.footprint),
      (longRoom(placement.footprint) + placement.footprint) / 2,
      room.get(node.id) ?? placement.footprint,
    ];
    prints.set(
      node.id,
      PRINT_LEVELS.map((share) => {
        const em = full * share;
        const fitted = rooms.map((width) =>
          fitName(node.name, width / em, measure, prefix)
        );
        return {
          em,
          prints: fitted.filter(
            (one, i) =>
              worthPrinting(one) &&
              fitted.findIndex((other) => other.text === one.text) === i
          ),
        };
      })
    );
  }
  return prints;
}

/** Each print's width at `fontPx`, and where the rows put it. */
function measureAll(
  context: CanvasRenderingContext2D,
  texts: readonly string[],
  font: string,
  fontPx: number,
  width: number
) {
  context.font = `${ATLAS_WEIGHT} ${fontPx}px ${font}`;
  const rowHeight = Math.ceil(fontPx * LINE_HEIGHT);
  const widths = texts.map((text) =>
    Math.min(width - ATLAS_PAD * 2, Math.ceil(context.measureText(text).width))
  );
  return {
    fontPx,
    rowHeight,
    widths,
    packed: packAtlas(widths, rowHeight, width, ATLAS_PAD),
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
  const decided = printsOf(placements, nodesById, measure);

  const planned = [...decided].flatMap(([id, levels]) =>
    levels.flatMap(({ em, prints }, level) =>
      prints.map((fitted, print) => ({ id, level, print, fitted, em }))
    )
  );
  // A name printed whole at two sizes is one raster, drawn at two sizes.
  const texts = [...new Set(planned.map((one) => one.fitted.text))];
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
  texts.forEach((text, i) => {
    const spot = fit.packed.spots[i] as { x: number; y: number };
    if (spot.y + fit.rowHeight <= canvas.height)
      context.fillText(text, spot.x, spot.y + fit.rowHeight / 2);
  });
  const labels = new Map<string, { ems: number[]; levels: Level[] }>();
  for (const [id, levels] of decided)
    labels.set(id, {
      ems: levels.map((level) => level.em),
      levels: levels.map((level) => ({ em: level.em, entries: [] })),
    });
  const entries = planned.map((one, i): Entry => {
    const at = slot.get(one.fitted.text) as number;
    const spot = fit.packed.spots[at] as { x: number; y: number };
    const w = fit.widths[at] as number;
    const clipped = spot.y + fit.rowHeight > canvas.height;
    const label = labels.get(one.id) as { levels: Level[] };
    (label.levels[one.level] as Level).entries.push(i);
    return {
      id: one.id,
      print: one.print,
      full: one.fitted.full,
      // The texture is flipped on upload, so the canvas's top row is v = 1.
      uv: [
        spot.x / width,
        1 - spot.y / canvas.height,
        (spot.x + w) / width,
        1 - (spot.y + fit.rowHeight) / canvas.height,
      ],
      // A print the atlas had no room for takes no room on the board either.
      width: clipped ? 0 : (one.em * w) / fit.fontPx,
      height: clipped ? 0 : (one.em * fit.rowHeight) / fit.fontPx,
    };
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The print lies on the ground and is always read at an angle; a plain mipmap
  // smears the letters along the view, anisotropic filtering keeps them.
  texture.anisotropy = gl.capabilities.getMaxAnisotropy();
  return { texture, entries, labels };
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
  /** The buildings the city laid out, in a fixed order the courtyards follow. */
  order: string[];
  placementsById: Map<string, Placement>;
  interaction: Interaction;
  usage: UsageReport | undefined;
};

const SCRATCH = new THREE.Vector3();
const CORNERS: number[] = [];
const SEGMENTS = new Float32Array(COURTYARD_SEGMENTS * 4);

/**
 * Places the names for one view and writes their quads, their opacities and the
 * courtyards. Returns the types whose whole name is printed legibly with its anchor
 * on screen.
 */
function repaint(
  inputs: Inputs,
  view: View,
  floated: Set<string>,
  px: Float32Array,
  chosen: Int8Array
): Set<string> {
  const { atlas, geometry, courtyards, order, placementsById, interaction } =
    inputs;
  const { camera, viewportHeight, flipped, reveal } = view;
  const active =
    interaction.hovered !== null ||
    interaction.selected !== null ||
    interaction.neighbours !== null;

  // How tall each type's print stands on screen, and which are worth placing.
  const wants: (Want & Ranked)[] = [];
  const buildings: { id: string; rect: Rect }[] = [];
  order.forEach((id, i) => {
    const placement = placementsById.get(id);
    const label = atlas.labels.get(id);
    px[i] = 0;
    chosen[i] = -1;
    if (!(placement && label) || (placement.flatten ?? 0) >= FLAT) return;
    const half = placement.footprint / 2;
    const { x, z } = placement.position;
    buildings.push({
      id,
      rect: { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half },
    });
    SCRATCH.set(x, groundOf(placement), z);
    const perEm = boardTextPx(1, viewportHeight, camera.position, SCRATCH);
    const level = printLevel(perEm, label.ems);
    if (level < 0) return;
    chosen[i] = level;
    px[i] = perEm * (label.ems[level] as number);
    const tier =
      id === interaction.hovered || id === interaction.selected
        ? 0
        : active &&
            (interaction.neighbours?.has(id) ||
              interaction.hoveredNeighbours?.has(id))
          ? 1
          : 2;
    wants.push({
      id,
      tier,
      footprint: placement.footprint,
      usage: inputs.usage?.byType[id]?.total ?? 0,
      centre: placement.position,
      prints: (label.levels[level] as Level).entries.map(
        (e) => atlas.entries[e] as Entry
      ),
    });
  });
  wants.sort(byPriority);
  const placed = placeLabels(wants, buildings, flipped);

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
  const positions = position.array as Float32Array;
  const colours = colour.array as Float32Array;
  const linePositions = courtyards.getAttribute("position")
    .array as Float32Array;
  const lineColours = courtyards.getAttribute("color").array as Float32Array;
  const printed = new Set<string>();

  order.forEach((id, i) => {
    const placement = placementsById.get(id);
    const label = atlas.labels.get(id);
    const spot: Placed | undefined = placed.get(id);
    const flatten = placement ? (placement.flatten ?? 0) : 1;
    const light = labelLight(id, interaction);
    const levels = label?.levels ?? [];
    for (let lv = 0; lv < levels.length; lv++)
      for (const index of (levels[lv] as Level).entries) {
        const entry = atlas.entries[index] as Entry;
        const shown =
          spot !== undefined && lv === chosen[i] && spot.print === entry.print;
        if (shown) {
          printCorners(spot.rect, flipped, CORNERS);
          const y = groundOf(placement as Placement) + LABEL_Y;
          for (let k = 0; k < 4; k++) {
            positions[index * 12 + k * 3] = CORNERS[k * 2] as number;
            positions[index * 12 + k * 3 + 1] = y;
            positions[index * 12 + k * 3 + 2] = CORNERS[k * 2 + 1] as number;
          }
        }
        // A name floating over its building is not printed under it as well.
        const alpha =
          shown && !floated.has(id)
            ? labelOpacity(px[i] as number, light, reveal, flatten)
            : 0;
        for (let k = 0; k < 4; k++) colours[index * 16 + k * 4 + 3] = alpha;
        if (shown && entry.full && alpha > 0) {
          SCRATCH.set(
            (placement as Placement).position.x,
            groundOf(placement as Placement),
            (placement as Placement).position.z
          ).project(camera);
          if (
            Math.abs(SCRATCH.x) <= 1 &&
            Math.abs(SCRATCH.y) <= 1 &&
            SCRATCH.z < 1
          )
            printed.add(id);
        }
      }

    // The courtyard round the part, and round its print when it has one.
    SEGMENTS.fill(0);
    if (placement) {
      courtyard(
        placement.position,
        placement.footprint,
        spot?.rect ?? null,
        SEGMENTS,
        0
      );
    }
    const base = i * COURTYARD_SEGMENTS * 2;
    const y = placement ? groundOf(placement) + COURTYARD_Y : 0;
    const strength = placement
      ? COURTYARD_OPACITY * light * reveal * (1 - flatten)
      : 0;
    for (let s = 0; s < COURTYARD_SEGMENTS * 2; s++) {
      linePositions[(base + s) * 3] = SEGMENTS[s * 2] as number;
      linePositions[(base + s) * 3 + 1] = y;
      linePositions[(base + s) * 3 + 2] = SEGMENTS[s * 2 + 1] as number;
      lineColours[(base + s) * 4 + 3] = strength;
    }
  });
  position.needsUpdate = true;
  colour.needsUpdate = true;
  courtyards.getAttribute("position").needsUpdate = true;
  courtyards.getAttribute("color").needsUpdate = true;
  return printed;
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
      order: cityPlacements.map((placement) => placement.id),
      placementsById,
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
  // Each type's print height on screen and the size it prints at, rewritten in
  // place every repaint.
  const px = useMemo(
    () => new Float32Array(cityPlacements.length),
    [cityPlacements]
  );
  const chosen = useMemo(
    () => new Int8Array(cityPlacements.length),
    [cityPlacements]
  );
  // What the last repaint was made from, so a still frame can tell it has nothing
  // to write.
  const written = useRef({
    inputs: null as Inputs | null,
    reveal: -1,
    floated: -1,
    flipped: false,
    height: 0,
    camera: new THREE.Matrix4(),
  });
  const flipped = useRef(false);
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    camera.getWorldDirection(forward);
    flipped.current = labelsFlipped(forward.x, forward.z, flipped.current);
    const reveal = revealAt(state.clock.elapsedTime, reducedMotion).links;
    const last = written.current;
    if (
      last.inputs === inputs &&
      last.reveal === reveal &&
      last.floated === floated.version &&
      last.flipped === flipped.current &&
      last.height === height &&
      camera.matrixWorld.equals(last.camera)
    )
      return;
    const printed = repaint(
      inputs,
      { camera, viewportHeight: height, flipped: flipped.current, reveal },
      floated.ids,
      px,
      chosen
    );
    const same =
      printed.size === floated.printed.size &&
      [...printed].every((id) => floated.printed.has(id));
    if (!same) {
      floated.printed = printed;
      floated.printedVersion += 1;
    }
    last.inputs = inputs;
    last.reveal = reveal;
    last.floated = floated.version;
    last.flipped = flipped.current;
    last.height = height;
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
