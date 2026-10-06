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
  LINE_HEIGHT,
  labelCorners,
  labelFade,
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
/**
 * How solid the print is at rest: readable on the plate and still quieter than the
 * buildings and the traces.
 */
const BASE_OPACITY = 0.6;
/**
 * What is left of a name unrelated to the hovered or selected type, the same share
 * an unrelated trace keeps of its idle strength.
 */
const DIMMED = 0.15;
/** How far an Element Type's print leans toward amber, the colour of its building. */
const ELEMENT_TINT = 0.35;

type Atlas = {
  texture: THREE.CanvasTexture;
  ids: string[];
  /** Per name: u0, v0, u1, v1, then the quad's width and height in world units. */
  entries: Float32Array;
};

/**
 * Rasterises every name into one texture, packed in rows. When the rows would run
 * past what the GPU can hold, the font steps down until they fit, which only a
 * schema of thousands of types would reach.
 */
function buildAtlas(
  texts: Map<string, BoardText>,
  font: string,
  ratio: number,
  maxSize: number,
  anisotropy: number
): Atlas {
  const ids = [...texts.keys()];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const width = Math.min(maxSize, Math.round(ATLAS_WIDTH * Math.min(ratio, 2)));
  let fontPx = Math.round(ATLAS_FONT_PX * Math.min(ratio, 2));
  let widths: number[] = [];
  let packed = packAtlas([], 0, width, ATLAS_PAD);
  let rowHeight = 0;
  for (;;) {
    rowHeight = Math.ceil(fontPx * LINE_HEIGHT);
    if (context) {
      context.font = `${ATLAS_WEIGHT} ${fontPx}px ${font}`;
      widths = ids.map((id) =>
        Math.min(
          width - ATLAS_PAD * 2,
          Math.ceil(context.measureText(texts.get(id)?.text ?? "").width)
        )
      );
    }
    packed = packAtlas(widths, rowHeight, width, ATLAS_PAD);
    if (packed.height <= maxSize || fontPx <= 8) break;
    fontPx = Math.floor(fontPx * 0.8);
  }

  canvas.width = width;
  canvas.height = Math.max(1, packed.height);
  const entries = new Float32Array(ids.length * 6);
  if (context) {
    // Sizing the canvas reset the font, so it is set again before drawing.
    context.font = `${ATLAS_WEIGHT} ${fontPx}px ${font}`;
    // White ink: the vertex colour tints it, so one atlas serves every colour.
    context.fillStyle = "#ffffff";
    context.textBaseline = "middle";
    ids.forEach((id, i) => {
      const spot = packed.spots[i] as { x: number; y: number };
      const text = texts.get(id) as BoardText;
      context.fillText(text.text, spot.x, spot.y + rowHeight / 2);
      const w = widths[i] as number;
      // The texture is flipped on upload, so the canvas's top row is v = 1.
      entries.set(
        [
          spot.x / width,
          1 - spot.y / canvas.height,
          (spot.x + w) / width,
          1 - (spot.y + rowHeight) / canvas.height,
          (text.em * w) / fontPx,
          (text.em * rowHeight) / fontPx,
        ],
        i * 6
      );
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The print lies on the ground and is always read at an angle; a plain mipmap
  // smears the letters along the view, anisotropic filtering keeps them.
  texture.anisotropy = anisotropy;
  return { texture, ids, entries };
}

/** The mesh's buffers for one atlas: positions are rewritten, the rest are fixed. */
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
  atlas.ids.forEach((id, i) => {
    const [u0, v0, u1, v1] = atlas.entries.subarray(i * 6, i * 6 + 4);
    // North-west, north-east, south-west, south-east, as labelCorners writes them.
    uv.set([u0, v0, u1, v0, u0, v1, u1, v1] as number[], i * 8);
    const ink = nodesById.get(id)?.isElement ? tinted : bright;
    for (let corner = 0; corner < 4; corner++)
      colour.set([ink.r, ink.g, ink.b, 0], i * 16 + corner * 4);
    const at = i * 4;
    // Wound so the face points up.
    index.set([at, at + 2, at + 1, at + 1, at + 2, at + 3], i * 6);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 12), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colour, 4).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

export function BoardLabels({
  texts,
  nodesById,
  placementsById,
  selected,
  hovered,
  neighbours,
  hoveredNeighbours,
  palette,
  reducedMotion,
}: {
  /** What each type prints, from the city's footprints. */
  texts: Map<string, BoardText>;
  nodesById: Map<string, SchemaNode>;
  /** Where each building stands right now, through a focus tween as well. */
  placementsById: Map<string, Placement>;
  selected: string | null;
  hovered: string | null;
  /** The selection's or the focus's lit set, or null when nothing is lit. */
  neighbours: Set<string> | null;
  hoveredNeighbours: Set<string> | null;
  palette: { bright: string; amber: string; mono: string };
  reducedMotion: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const ratio = useThree((state) => state.viewport.dpr);
  // A web font that arrives after the first raster would leave the fallback face in
  // the atlas, so the atlas is drawn again once the page's fonts have loaded.
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) setFontsReady(1);
    });
    return () => {
      live = false;
    };
  }, []);

  const atlas = useMemo(
    () =>
      buildAtlas(
        texts,
        palette.mono,
        ratio,
        gl.capabilities.maxTextureSize,
        gl.capabilities.getMaxAnisotropy()
      ),
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

  // How lit each name is by the hover and the selection, recomputed when they change
  // rather than every frame.
  const lit = useMemo(() => {
    const interacting =
      hovered !== null || selected !== null || neighbours !== null;
    return Float32Array.from(atlas.ids, (id) => {
      // The floating label above the building already prints the whole name.
      if (id === hovered || id === selected) return 0;
      if (!interacting) return 1;
      return neighbours?.has(id) || hoveredNeighbours?.has(id) ? 1 : DIMMED;
    });
  }, [atlas, hovered, selected, neighbours, hoveredNeighbours]);

  const flipped = useRef(false);
  // What the buffers were last written from, so a still frame writes nothing.
  const written = useRef({
    placements: null as Map<string, Placement> | null,
    geometry: null as THREE.BufferGeometry | null,
    flipped: false,
    lit: null as Float32Array | null,
    reveal: -1,
    camera: new THREE.Matrix4(),
    height: 0,
  });
  // Scratch vectors, so the frame loop allocates nothing.
  const forward = useMemo(() => new THREE.Vector3(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const last = written.current;
    camera.getWorldDirection(forward);
    flipped.current = labelsFlipped(forward.x, forward.z, flipped.current);
    const moved =
      last.placements !== placementsById ||
      last.geometry !== geometry ||
      last.flipped !== flipped.current;
    if (moved) {
      const position = geometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;
      for (let i = 0; i < atlas.ids.length; i++) {
        const placement = placementsById.get(atlas.ids[i] as string);
        const width = atlas.entries[i * 6 + 4] as number;
        const height = atlas.entries[i * 6 + 5] as number;
        const corners = placement
          ? labelCorners(
              placement.position,
              placement.footprint,
              width,
              height,
              flipped.current
            )
          : [0, 0, 0, 0, 0, 0, 0, 0];
        const y = (placement?.y ?? 0) + LABEL_Y;
        for (let corner = 0; corner < 4; corner++)
          position.setXYZ(
            i * 4 + corner,
            corners[corner * 2] as number,
            y,
            corners[corner * 2 + 1] as number
          );
      }
      position.needsUpdate = true;
    }

    const reveal = revealAt(state.clock.elapsedTime, reducedMotion).links;
    if (
      !moved &&
      last.lit === lit &&
      last.reveal === reveal &&
      last.height === size.height &&
      camera.matrixWorld.equals(last.camera)
    )
      return;
    const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
    const eye = camera.position;
    for (let i = 0; i < atlas.ids.length; i++) {
      const id = atlas.ids[i] as string;
      const placement = placementsById.get(id);
      let alpha = 0;
      if (placement && reveal > 0 && (lit[i] as number) > 0) {
        anchor.set(
          placement.position.x,
          placement.y ?? 0,
          placement.position.z
        );
        const px = boardTextPx(
          (texts.get(id) as BoardText).em,
          size.height,
          eye,
          anchor
        );
        alpha =
          BASE_OPACITY *
          reveal *
          (lit[i] as number) *
          labelFade(px) *
          (1 - (placement.flatten ?? 0));
      }
      for (let corner = 0; corner < 4; corner++)
        colour.setW(i * 4 + corner, alpha);
    }
    colour.needsUpdate = true;

    last.placements = placementsById;
    last.geometry = geometry;
    last.flipped = flipped.current;
    last.lit = lit;
    last.reveal = reveal;
    last.height = size.height;
    last.camera.copy(camera.matrixWorld);
  });

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      material={material}
      // After the boards, before the buildings and the traces, which write over it.
      renderOrder={-0.5}
    />
  );
}
