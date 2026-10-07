// Every type's name printed flat on the board in front of its building, the way a
// circuit board prints a reference designator next to a component. One canvas atlas
// holds every name and one mesh draws them all; `board-labels.ts` decides the text,
// the size, the fade and which way up it reads.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SchemaNode } from "../../model/types";
import type { Placement } from "../layout/city";
import {
  type BoardText,
  boardTextPx,
  type Interaction,
  LINE_HEIGHT,
  labelCorners,
  labelLight,
  labelOpacity,
  labelsFlipped,
  packAtlas,
} from "./board-labels";
import { revealAt } from "./reveal";
import { FOLDER_TINT_HEIGHT } from "./stage";

/**
 * Font size the names are rasterised at, in CSS pixels before the device pixel
 * ratio. A name is legible from 8 px and the camera can come down to where the print
 * is several times that, so the raster carries 24 and lets the mipmaps take it down.
 */
const ATLAS_FONT_PX = 24;
/** Heavier than the chrome's mono, so a stroke survives the mipmap at a distance. */
const ATLAS_WEIGHT = 600;
/** Atlas width in CSS pixels; the rows grow down to fit every name. */
const ATLAS_WIDTH = 2048;
/** Transparent pixels around each name, so a mipmap does not bleed one into the next. */
const ATLAS_PAD = 4;
/**
 * How high the print stands: over the nested folder tints at 0.02, so a folder never
 * hides a name, and under the roads at 0.05, so a trace runs over the silkscreen.
 */
const LABEL_Y = FOLDER_TINT_HEIGHT + 0.01;
/** How far an Element Type's print leans toward amber, the colour of its building. */
const ELEMENT_TINT = 0.35;
/** Per name in the atlas: u0, v0, u1, v1, the quad's width and height, and its em. */
const STRIDE = 7;

/**
 * The types that have a floating label right now. The label layer rewrites it on
 * every repaint and bumps `version`, so the board can tell its opacities are stale.
 */
export type Floated = { ids: Set<string>; version: number };

/** What the opacities were last written from. */
type Written = {
  inputs: object | null;
  reveal: number;
  floated: number;
  camera: THREE.Matrix4;
};

/** True when nothing the opacities depend on has moved since they were written. */
function unchanged(
  last: Written,
  inputs: object,
  reveal: number,
  floated: number,
  camera: THREE.Matrix4
): boolean {
  return (
    last.inputs === inputs &&
    last.reveal === reveal &&
    last.floated === floated &&
    camera.equals(last.camera)
  );
}

type Atlas = {
  texture: THREE.CanvasTexture;
  ids: string[];
  entries: Float32Array;
};

/** Each name's width at `fontPx`, and where the rows put it. */
function measure(
  context: CanvasRenderingContext2D,
  printed: BoardText[],
  font: string,
  fontPx: number,
  width: number
) {
  context.font = `${ATLAS_WEIGHT} ${fontPx}px ${font}`;
  const rowHeight = Math.ceil(fontPx * LINE_HEIGHT);
  const widths = printed.map((text) =>
    Math.min(
      width - ATLAS_PAD * 2,
      Math.ceil(context.measureText(text.text).width)
    )
  );
  return {
    fontPx,
    rowHeight,
    widths,
    packed: packAtlas(widths, rowHeight, width, ATLAS_PAD),
  };
}

/** Rasterises every name into one texture, packed in rows. */
function buildAtlas(
  texts: Map<string, BoardText>,
  font: string,
  ratio: number,
  gl: THREE.WebGLRenderer
): Atlas {
  const ids = [...texts.keys()];
  const printed = ids.map((id) => texts.get(id) as BoardText);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const scale = Math.min(ratio, 2);
  const maxSize = gl.capabilities.maxTextureSize;
  const width = Math.min(maxSize, Math.round(ATLAS_WIDTH * scale));
  const full = measure(
    context,
    printed,
    font,
    Math.round(ATLAS_FONT_PX * scale),
    width
  );
  // A schema too big for one texture at full size gets smaller print. The rows and
  // their width both shrink with the font, so scaling it by the overflow always fits.
  // At a device pixel ratio of 2 that starts somewhere past 700 types.
  const fit =
    full.packed.height <= maxSize
      ? full
      : measure(
          context,
          printed,
          font,
          Math.floor((full.fontPx * maxSize) / full.packed.height),
          width
        );

  canvas.width = width;
  canvas.height = Math.max(1, fit.packed.height);
  // Sizing the canvas reset the font, so it is set again before drawing. White ink:
  // the vertex colour tints it, so one atlas serves every colour.
  context.font = `${ATLAS_WEIGHT} ${fit.fontPx}px ${font}`;
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  const entries = new Float32Array(ids.length * STRIDE);
  for (let i = 0; i < ids.length; i++) {
    const spot = fit.packed.spots[i] as { x: number; y: number };
    const text = printed[i] as BoardText;
    const w = fit.widths[i] as number;
    context.fillText(text.text, spot.x, spot.y + fit.rowHeight / 2);
    // The texture is flipped on upload, so the canvas's top row is v = 1.
    entries.set(
      [
        spot.x / width,
        1 - spot.y / canvas.height,
        (spot.x + w) / width,
        1 - (spot.y + fit.rowHeight) / canvas.height,
        (text.em * w) / fit.fontPx,
        (text.em * fit.rowHeight) / fit.fontPx,
        text.em,
      ],
      i * STRIDE
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The print lies on the ground and is always read at an angle; a plain mipmap
  // smears the letters along the view, anisotropic filtering keeps them.
  texture.anisotropy = gl.capabilities.getMaxAnisotropy();
  return { texture, ids, entries };
}

/** The mesh's buffers for one atlas: positions and opacities are rewritten later. */
function buildGeometry(
  atlas: Atlas,
  nodesById: Map<string, SchemaNode>,
  bright: THREE.Color,
  amber: THREE.Color
): THREE.BufferGeometry {
  const count = atlas.ids.length;
  const uv = new Float32Array(count * 8);
  const colour = new Float32Array(count * 16);
  const index = new Uint32Array(count * 6);
  const tinted = bright.clone().lerp(amber, ELEMENT_TINT);
  for (let i = 0; i < count; i++) {
    const [u0, v0, u1, v1] = atlas.entries.subarray(i * STRIDE, i * STRIDE + 4);
    // North-west, north-east, south-west, south-east, as labelCorners writes them.
    uv.set([u0, v0, u1, v0, u0, v1, u1, v1] as number[], i * 8);
    const { r, g, b } = nodesById.get(atlas.ids[i] as string)?.isElement
      ? tinted
      : bright;
    colour.set([r, g, b, 0, r, g, b, 0, r, g, b, 0, r, g, b, 0], i * 16);
    const at = i * 4;
    // Wound so the face points up.
    index.set([at, at + 2, at + 1, at + 1, at + 2, at + 3], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  const dynamic = (array: Float32Array, size: number) =>
    new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", dynamic(new Float32Array(count * 12), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", dynamic(colour, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/**
 * Stands in for a building the names have but the placements on screen do not yet,
 * for the one render a new schema takes to reach them. Pressed flat, so it prints
 * nothing.
 */
const NOWHERE: Pick<Placement, "position" | "footprint" | "y" | "flatten"> = {
  position: { x: 0, z: 0 },
  footprint: 0,
  flatten: 1,
};

const groundOf = (placement: { y?: number }) => placement.y ?? 0;

/** Lays every name's quad on the board, in front of its building or behind it. */
function writePositions(
  geometry: THREE.BufferGeometry,
  atlas: Atlas,
  placementsById: Map<string, Placement>,
  flipped: boolean
) {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const array = position.array as Float32Array;
  for (let i = 0; i < atlas.ids.length; i++) {
    const placement = placementsById.get(atlas.ids[i] as string) ?? NOWHERE;
    const [x0, z0, x1, z1, x2, z2, x3, z3] = labelCorners(
      placement.position,
      placement.footprint,
      atlas.entries[i * STRIDE + 4] as number,
      atlas.entries[i * STRIDE + 5] as number,
      flipped
    );
    const y = groundOf(placement) + LABEL_Y;
    array.set([x0, y, z0, x1, y, z1, x2, y, z2, x3, y, z3], i * 12);
  }
  position.needsUpdate = true;
}

/** Every name's opacity for where the camera is now. Allocates nothing. */
function writeOpacities(
  geometry: THREE.BufferGeometry,
  atlas: Atlas,
  placementsById: Map<string, Placement>,
  light: Float32Array,
  floated: Set<string>,
  reveal: number,
  camera: THREE.Vector3,
  viewportHeight: number,
  anchor: THREE.Vector3
) {
  const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
  const array = colour.array as Float32Array;
  for (let i = 0; i < atlas.ids.length; i++) {
    const placement = placementsById.get(atlas.ids[i] as string) ?? NOWHERE;
    anchor.set(placement.position.x, groundOf(placement), placement.position.z);
    const alpha = labelOpacity(
      boardTextPx(
        atlas.entries[i * STRIDE + 6] as number,
        viewportHeight,
        camera,
        anchor
      ),
      // A name floating over its building is not printed under it as well.
      (light[i] as number) * Number(!floated.has(atlas.ids[i] as string)),
      reveal,
      placement.flatten ?? 0
    );
    // The fourth component of each of the quad's four colours.
    array[i * 16 + 3] = alpha;
    array[i * 16 + 7] = alpha;
    array[i * 16 + 11] = alpha;
    array[i * 16 + 15] = alpha;
  }
  colour.needsUpdate = true;
}

/**
 * The atlas, the mesh's geometry and its material, built when the names, the font or
 * the pixel ratio change and disposed with them.
 */
function useNameMesh(
  texts: Map<string, BoardText>,
  nodesById: Map<string, SchemaNode>,
  palette: { bright: string; amber: string; mono: string }
) {
  const gl = useThree((state) => state.gl);
  const ratio = useThree((state) => state.viewport.dpr);
  // A web font that arrives after the first raster would leave the fallback face in
  // the atlas, so the atlas is drawn again once the page's fonts have loaded.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  const atlas = useMemo(
    () => buildAtlas(texts, palette.mono, ratio, gl),
    // fontsReady is a trigger: the same inputs rasterise differently once it flips.
    [texts, palette.mono, ratio, gl, fontsReady]
  );
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
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      atlas.texture.dispose();
    },
    [geometry, material, atlas]
  );
  return { atlas, geometry, material };
}

export function BoardLabels({
  texts,
  nodesById,
  placementsById,
  interaction,
  floated,
  palette,
  reducedMotion,
}: {
  /** What each type prints, from the city's footprints. */
  texts: Map<string, BoardText>;
  nodesById: Map<string, SchemaNode>;
  /** Where each building stands right now, through a focus tween as well. */
  placementsById: Map<string, Placement>;
  interaction: Interaction;
  /** The types with a floating label right now, which print nothing here. */
  floated: Floated;
  palette: { bright: string; amber: string; mono: string };
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const height = useThree((state) => state.size.height);
  const { atlas, geometry, material } = useNameMesh(texts, nodesById, palette);

  // How lit each name is by the hover and the selection, recomputed when they change
  // rather than every frame.
  const light = useMemo(
    () => Float32Array.from(atlas.ids, (id) => labelLight(id, interaction)),
    [atlas, interaction]
  );

  const flipped = useRef(false);
  useEffect(() => {
    writePositions(geometry, atlas, placementsById, flipped.current);
  }, [geometry, atlas, placementsById]);

  // Everything the opacities depend on apart from the camera and the clock, so a
  // still frame can tell it has nothing to write.
  const inputs = useMemo(
    () => ({ geometry, placementsById, light, height }),
    [geometry, placementsById, light, height]
  );
  const written = useRef<Written>({
    inputs: null,
    reveal: -1,
    floated: -1,
    camera: new THREE.Matrix4(),
  });
  // Scratch vectors, so the frame loop allocates nothing.
  const forward = useMemo(() => new THREE.Vector3(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    camera.getWorldDirection(forward);
    const flip = labelsFlipped(forward.x, forward.z, flipped.current);
    if (flip === flipped.current) return;
    flipped.current = flip;
    writePositions(geometry, atlas, placementsById, flip);
  });

  useFrame((state) => {
    const last = written.current;
    const reveal = revealAt(state.clock.elapsedTime, reducedMotion).links;
    if (unchanged(last, inputs, reveal, floated.version, camera.matrixWorld))
      return;
    writeOpacities(
      geometry,
      atlas,
      placementsById,
      light,
      floated.ids,
      reveal,
      camera.position,
      height,
      anchor
    );
    last.inputs = inputs;
    last.reveal = reveal;
    last.floated = floated.version;
    last.camera.copy(camera.matrixWorld);
  });

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      material={material}
      // After the boards, before the buildings and the traces, which draw over it.
      renderOrder={-0.5}
    />
  );
}
