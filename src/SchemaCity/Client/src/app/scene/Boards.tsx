// The circuit boards the districts are: a core with copper and solder mask over it,
// rounded corners with plated mounting holes, a faint copper pour across the mask,
// gold fingers where traces leave for another board, vias where traces turn, the
// district's name in silkscreen and a lighter patch under each nested folder or
// block editor socket. `board.ts` decides where the fingers and vias go.
//
// Every part is drawn low against the mask, so the buildings, the traces and the
// names stay what the eye reads first. Each layer is one merged geometry or one
// instanced mesh for the whole city, made per mount and disposed with it.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  type CityBounds,
  type District,
  type DistrictKind,
  ISLAND_PAD,
} from "../layout/city";
import { type Finger, holeSpots, type Island } from "./board";
import { labelsFlipped } from "./board-labels";
import { revealAt } from "./reveal";
import { districtStamp, FOLDER_TINT_HEIGHT } from "./stage";

export type BoardPalette = {
  land: string;
  dim: string;
  amber: string;
  background: string;
  /** The theme's mono stack, for the names printed on the boards. */
  mono: string;
};

/** Thickness of a board, whose top face is y = 0. */
export const SLAB_HEIGHT = 0.4;
/** The solder mask on top of the copper, the board's own colour. */
const MASK = 0.1;
/** The copper layer between the mask and the core, a line along the board's edge. */
const COPPER = 0.035;
/** Radius of a board's corners. */
const CORNER = 1.2;
/** Mounting holes: the drill and the plated ring around it. */
const HOLE_RADIUS = 0.32;
const RING_RADIUS = 0.62;
/** A gold finger: its width along the edge, its reach in from it, and its height. */
const FINGER_WIDTH = 0.5;
const FINGER_REACH = 1.4;
const FINGER_HEIGHT = 0.02;
/** A via's plated ring and its drill. */
const VIA_RADIUS = 0.2;
const VIA_DRILL = 0.08;
/** Over the folder tints, under the type names at 0.03 and the traces at 0.05. */
const VIA_Y = FOLDER_TINT_HEIGHT + 0.004;
/** World units between two lines of the copper pour's hatch. */
const HATCH = 1.4;

const COPPER_COLOUR = "#c8823a";
const GOLD_COLOUR = "#d9b24a";
export const WHITE = "#ffffff";

/**
 * A hint of `toward` in `base`, mixed the way CSS mixes two colours rather than in
 * the linear space three works in. A twelfth of amber is a hint of warmth in one and
 * a brown field in the other, and these colours are picked against the panel colour
 * as the stylesheet writes it.
 */
export function tint(
  base: string,
  toward: string,
  amount: number
): THREE.Color {
  return new THREE.Color(base)
    .convertLinearToSRGB()
    .lerp(new THREE.Color(toward).convertLinearToSRGB(), amount)
    .convertSRGBToLinear();
}

/** How far the land is lifted from the panel colour toward phosphor-dim. */
const SLAB_LIFT = 0.25;

/**
 * The solder mask of a district. Structure is the same panel colour the chrome uses,
 * compositions and mixed are a touch lighter and elements a touch warmer, so the
 * boards read as different places without turning into four colours.
 *
 * The panel colour is lifted toward phosphor-dim first. Under the scene's lights the
 * panel colour itself comes out close to black, and a shadow on black does not show,
 * so the buildings would stand on their boards without casting anything.
 */
export function slabColour(
  kind: DistrictKind,
  palette: BoardPalette
): THREE.Color {
  const land = `#${tint(palette.land, palette.dim, SLAB_LIFT).getHexString()}`;
  if (kind === "structure") return new THREE.Color(land);
  if (kind === "elements") return tint(land, palette.amber, 0.09);
  return tint(land, WHITE, 0.07);
}

/** The lip under the focus island, darker than any board. */
export function rimColour(palette: BoardPalette): THREE.Color {
  return new THREE.Color(palette.land).lerp(
    new THREE.Color(palette.background),
    0.6
  );
}

/**
 * Font size a district's name is rasterised at. Its cap height comes out around 72 px,
 * and the stamp is at most four world units tall, so the print carries about
 * 18 px of texture per world unit. The ground needs 2 to stay crisp at the framing
 * zoom, and the rest is what the camera leans on when it comes down to street level.
 */
const STAMP_FONT_PX = 100;
/**
 * How heavy the letters are cut. A mono face at its normal weight leaves a stroke
 * about a pixel wide once the whole city is framed, and a stroke that thin at 0.55
 * opacity averages away into the board under it.
 */
const STAMP_WEIGHT = 600;
/** Silkscreen text is spaced out. Ems of extra gap between two letters. */
const STAMP_TRACKING = "0.32em";
/**
 * How solid the print reads against the board under it. Phosphor-dim at 0.8 comes
 * out around #3f6b60 over the panel colour, which is still darker than any building
 * and half the strength of a road.
 */
const STAMP_OPACITY = 0.8;
/**
 * How far the print stands off the board. Above the mask so the two never z-fight,
 * and under the traces, so a road crossing a board's margin runs over the name the
 * way a trace runs over a board's silkscreen.
 */
const STAMP_Y = 0.01;
/** Ground around a nested folder's or a socket's members that its patch covers. */
export const FOLDER_PAD = 1;

/** One texture per name and font, kept for the life of the page. */
const stamps = new Map<string, THREE.CanvasTexture>();

/**
 * A district's name rasterised into a texture that is exactly the ink: as wide as the
 * tracked-out name and as tall as its cap height, so the caller places the quad by
 * cap height alone, with no per-font fudge for the space around the letters.
 */
function stampTexture(name: string, font: string): THREE.CanvasTexture {
  const key = `${name}|${font}`;
  const found = stamps.get(key);
  if (found) return found;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const style = () => {
    if (!context) return;
    context.font = `${STAMP_WEIGHT} ${STAMP_FONT_PX}px ${font}`;
    // letterSpacing is Chrome 99 and Safari 17.4. Older than that prints the name
    // without the tracking rather than not at all.
    context.letterSpacing = STAMP_TRACKING;
    // White ink, because the material's colour is what tints it to the theme.
    context.fillStyle = "#ffffff";
    context.textBaseline = "alphabetic";
  };
  if (context) {
    style();
    const measured = context.measureText(name);
    // The ink's own ascent, which for an uppercase name is its cap height.
    const cap = Math.max(Math.ceil(measured.actualBoundingBoxAscent), 1);
    canvas.width = Math.max(Math.ceil(measured.width), 1);
    canvas.height = cap;
    // Sizing a canvas resets every drawing state it had, the font included.
    style();
    context.fillText(name, 0, cap);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The stamp lies on the ground, so every camera reads it at a grazing angle and a
  // plain mipmap turns the letters to mush. The renderer clamps this to what the
  // hardware has.
  texture.anisotropy = 8;
  stamps.set(key, texture);
  return texture;
}

/** A district's board, padding included. */
export const islandOf = (district: District): Island => ({
  minX: district.minX - ISLAND_PAD,
  maxX: district.maxX + ISLAND_PAD,
  minZ: district.minZ - ISLAND_PAD,
  maxZ: district.maxZ + ISLAND_PAD,
});

/**
 * A board's outline as a shape in x and -z, so that extruding it along +z and
 * turning it flat stands it on the ground the right way round.
 */
function outline(island: Island): THREE.Shape {
  const r = Math.min(
    CORNER,
    (island.maxX - island.minX) / 2,
    (island.maxZ - island.minZ) / 2
  );
  const x0 = island.minX;
  const x1 = island.maxX;
  const y0 = -island.maxZ;
  const y1 = -island.minZ;
  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x1, y1 - r);
  shape.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x0 + r, y1);
  shape.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x0, y0 + r);
  shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  for (const spot of holeSpots(island)) {
    const hole = new THREE.Path();
    hole.absarc(spot.x, -spot.z, HOLE_RADIUS, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}

/**
 * One layer of every board, from `bottom` to `top`, merged into one geometry with
 * each board's own colour in its vertices.
 */
function boardLayer(
  boards: readonly { island: Island; colour: THREE.Color }[],
  bottom: number,
  top: number
): THREE.BufferGeometry | null {
  const parts = boards.map(({ island, colour }) => {
    const geometry = new THREE.ExtrudeGeometry(outline(island), {
      depth: top - bottom,
      bevelEnabled: false,
      curveSegments: 6,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, bottom, 0);
    const { count } = geometry.getAttribute("position");
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++)
      colours.set([colour.r, colour.g, colour.b], i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    return geometry;
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

/** The plated rings round every board's mounting holes, as one flat geometry. */
function holeRings(islands: readonly Island[]): THREE.BufferGeometry | null {
  const rings = islands.flatMap((island) =>
    holeSpots(island).map((spot) => {
      const ring = new THREE.RingGeometry(HOLE_RADIUS, RING_RADIUS, 20);
      ring.rotateX(-Math.PI / 2);
      ring.translate(spot.x, 0.004, spot.z);
      return ring;
    })
  );
  if (rings.length === 0) return null;
  const merged = mergeGeometries(rings);
  for (const ring of rings) ring.dispose();
  return merged;
}

/**
 * The copper pour: faint diagonal hatching that multiplies the mask colour, so the
 * open board reads as a plane of copper under the mask rather than as a flat box.
 */
function hatchTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "#dcdcdc";
    context.lineWidth = 6;
    // Three strokes so the line wraps across the tile's corners without a seam.
    for (const offset of [-size, 0, size]) {
      context.beginPath();
      context.moveTo(offset, size);
      context.lineTo(offset + size, 0);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // The extruded cap's coordinates are world units, so this sets the line pitch.
  texture.repeat.set(1 / HATCH, 1 / HATCH);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** One flat instance per spot, from a shape made once per mount. */
function useInstances(
  spots: readonly { x: number; z: number; y: number; turn?: number }[],
  scale: (index: number) => [number, number, number]
) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const at = new THREE.Object3D();
    spots.forEach((spot, i) => {
      at.position.set(spot.x, spot.y, spot.z);
      at.rotation.set(0, spot.turn ?? 0, 0);
      at.scale.set(...scale(i));
      at.updateMatrix();
      target.setMatrixAt(i, at.matrix);
    });
    target.count = spots.length;
    target.instanceMatrix.needsUpdate = true;
    target.computeBoundingSphere();
  }, [spots, scale]);
  return mesh;
}

const FINGER_SCALE = (): [number, number, number] => [
  FINGER_WIDTH,
  FINGER_HEIGHT,
  FINGER_REACH,
];
const UNIT_SCALE = (): [number, number, number] => [1, 1, 1];

/** A finger stands inside its edge, its long side running in from it. */
function fingerSpot(finger: Finger) {
  const inward = FINGER_REACH / 2;
  switch (finger.side) {
    case "north":
      return { x: finger.x, z: finger.z + inward, y: FINGER_HEIGHT / 2 };
    case "south":
      return { x: finger.x, z: finger.z - inward, y: FINGER_HEIGHT / 2 };
    case "west":
      return {
        x: finger.x + inward,
        z: finger.z,
        y: FINGER_HEIGHT / 2,
        turn: Math.PI / 2,
      };
    default:
      return {
        x: finger.x - inward,
        z: finger.z,
        y: FINGER_HEIGHT / 2,
        turn: Math.PI / 2,
      };
  }
}

/** A ref that keeps `materials` holding what React mounted under `key`. */
function trackMaterial<T>(materials: Map<string, T>, key: string) {
  return (held: T | null) => {
    if (held) materials.set(key, held);
    else materials.delete(key);
  };
}

/** The geometries and the texture the boards draw with, disposed with them. */
function useBoardGeometry(districts: District[], palette: BoardPalette) {
  const parts = useMemo(() => {
    const boards = districts.map((district) => ({
      island: islandOf(district),
      colour: slabColour(district.kind, palette),
    }));
    const core = tint(palette.land, palette.amber, 0.12).multiplyScalar(0.7);
    const copper = tint(palette.land, COPPER_COLOUR, 0.6);
    const recolour = (colour: THREE.Color) =>
      boards.map((board) => ({ ...board, colour }));
    return {
      mask: boardLayer(boards, -MASK, 0),
      copper: boardLayer(recolour(copper), -MASK - COPPER, -MASK),
      core: boardLayer(recolour(core), -SLAB_HEIGHT, -MASK - COPPER),
      rings: holeRings(boards.map((board) => board.island)),
      hatch: hatchTexture(),
    };
  }, [districts, palette]);
  useEffect(
    () => () => {
      parts.mask?.dispose();
      parts.copper?.dispose();
      parts.core?.dispose();
      parts.rings?.dispose();
      parts.hatch.dispose();
    },
    [parts]
  );
  const shapes = useMemo(
    () => ({
      box: new THREE.BoxGeometry(),
      via: (() => {
        const ring = new THREE.RingGeometry(VIA_DRILL, VIA_RADIUS, 12);
        ring.rotateX(-Math.PI / 2);
        return ring;
      })(),
    }),
    []
  );
  useEffect(
    () => () => {
      shapes.box.dispose();
      shapes.via.dispose();
    },
    [shapes]
  );
  return { parts, shapes };
}

/** Turns every district name 180 degrees in place when the camera is behind it. */
function useFlippedStamps(meshes: Map<string, THREE.Mesh>) {
  const camera = useThree((state) => state.camera);
  const flipped = useRef(false);
  const forward = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    camera.getWorldDirection(forward);
    flipped.current = labelsFlipped(forward.x, forward.z, flipped.current);
    // Every frame rather than on a change, because a render that rebuilds a stamp
    // sets its rotation back from the props.
    for (const mesh of meshes.values())
      mesh.rotation.z = flipped.current ? Math.PI : 0;
  });
}

type Materials = Map<string, THREE.Material>;

/** A board material that fades in with the boards, tracked by `name`. */
function Solid({
  materials,
  name,
  ...look
}: THREE.MeshStandardMaterialParameters & {
  materials: Materials;
  name: string;
}) {
  return (
    <meshStandardMaterial
      depthWrite
      metalness={0}
      opacity={0}
      ref={trackMaterial(materials, name)}
      roughness={1}
      transparent
      {...look}
    />
  );
}

/** One layer of every board, or nothing when there are no boards. */
function Layer({
  geometry,
  materials,
  name,
  look,
}: {
  geometry: THREE.BufferGeometry | null;
  materials: Materials;
  name: string;
  look: THREE.MeshStandardMaterialParameters;
}) {
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} receiveShadow renderOrder={-1}>
      <Solid materials={materials} name={name} {...look} />
    </mesh>
  );
}

/**
 * A nested folder or a block editor's socket is a patch on the board its members
 * stand on, which is what says where one block of a district ends and the next
 * starts.
 */
function Patches({
  folders,
  colour,
  materials,
}: {
  folders: (CityBounds & { id: string })[];
  colour: THREE.Color;
  materials: Materials;
}) {
  return folders.map((folder) => (
    <mesh
      key={folder.id}
      position={[
        folder.centre.x,
        FOLDER_TINT_HEIGHT / 2 - MASK / 2,
        folder.centre.z,
      ]}
      receiveShadow
      renderOrder={-1}
    >
      <boxGeometry
        args={[folder.width, MASK + FOLDER_TINT_HEIGHT, folder.depth]}
      />
      <Solid
        color={colour}
        materials={materials}
        name={`folder|${folder.id}`}
      />
    </mesh>
  ));
}

/** The gold fingers and the vias, one instanced mesh each. */
function Marks({
  fingers,
  vias,
  shapes,
  palette,
  materials,
}: {
  fingers: Finger[];
  vias: { x: number; z: number }[];
  shapes: { box: THREE.BufferGeometry; via: THREE.BufferGeometry };
  palette: BoardPalette;
  materials: Materials;
}) {
  const fingerSpots = useMemo(() => fingers.map(fingerSpot), [fingers]);
  const viaSpots = useMemo(
    () => vias.map((via) => ({ ...via, y: VIA_Y })),
    [vias]
  );
  const fingerMesh = useInstances(fingerSpots, FINGER_SCALE);
  const viaMesh = useInstances(viaSpots, UNIT_SCALE);
  const colours = useMemo(
    () => ({
      gold: tint(palette.land, GOLD_COLOUR, 0.55),
      copper: tint(palette.land, COPPER_COLOUR, 0.4),
    }),
    [palette]
  );
  return (
    <>
      <instancedMesh
        args={[shapes.box, undefined, Math.max(1, fingerSpots.length)]}
        frustumCulled={false}
        ref={fingerMesh}
        renderOrder={-1}
      >
        <Solid
          color={colours.gold}
          materials={materials}
          metalness={0.6}
          name="fingers"
          roughness={0.45}
        />
      </instancedMesh>
      <instancedMesh
        args={[shapes.via, undefined, Math.max(1, viaSpots.length)]}
        frustumCulled={false}
        ref={viaMesh}
        renderOrder={-1}
      >
        <Solid
          color={colours.copper}
          materials={materials}
          metalness={0.5}
          name="vias"
          roughness={0.5}
        />
      </instancedMesh>
    </>
  );
}

/**
 * The district's name printed flat on its board, in the band the layout held clear
 * along its south edge. It writes no depth, so the buildings, the traces and every
 * link stand over it, and it turns in place when the camera is behind it, as the
 * type names do.
 *
 * ponytail: the print holds its strength through a selection and through focus mode,
 * where the buildings around it fade. Fading it too means telling the boards which
 * districts are lit, which is a prop and a set they have no other use for.
 */
function Stamps({
  districts,
  palette,
  materials,
}: {
  districts: District[];
  palette: BoardPalette;
  materials: Materials;
}) {
  const meshes = useRef(new Map<string, THREE.Mesh>());
  useFlippedStamps(meshes.current);
  // One rasterised name per district, with the quad it prints on. The name is fixed
  // to its board, so the search for its spot runs once rather than every frame.
  const names = useMemo(
    () =>
      districts.map((district) => {
        const texture = stampTexture(district.name.toUpperCase(), palette.mono);
        const stamp = districtStamp(
          islandOf(district),
          texture.image.width / texture.image.height
        );
        return { id: district.id, texture, stamp };
      }),
    [districts, palette.mono]
  );
  return names.map(({ id, stamp, texture }) => (
    <mesh
      key={id}
      position={[stamp.x, STAMP_Y, stamp.z]}
      ref={trackMaterial(meshes.current, id)}
      renderOrder={1}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[stamp.width, stamp.height]} />
      <meshBasicMaterial
        color={palette.dim}
        depthWrite={false}
        map={texture}
        opacity={0}
        ref={trackMaterial(materials, `stamp|${id}`)}
        transparent
      />
    </mesh>
  ));
}

export function Boards({
  districts,
  folders,
  fingers,
  vias,
  palette,
  reducedMotion,
}: {
  districts: District[];
  /** The ground a nested folder's or a socket's members cover, for its patch. */
  folders: (CityBounds & { id: string })[];
  /** Where lanes leave their boards. Empty in focus mode, where the city is a map. */
  fingers: Finger[];
  /** Where the drawn traces turn. */
  vias: { x: number; z: number }[];
  palette: BoardPalette;
  reducedMotion: boolean;
}) {
  const { parts, shapes } = useBoardGeometry(districts, palette);
  const materials = useRef<Materials>(new Map());
  const colours = useMemo(
    () => ({
      patch: tint(palette.land, WHITE, 0.15),
      copper: tint(palette.land, COPPER_COLOUR, 0.4),
    }),
    [palette]
  );

  // Everything here fades in with the boards, and the names with the traces.
  useFrame((state) => {
    const progress = revealAt(state.clock.elapsedTime, reducedMotion);
    for (const [key, material] of materials.current)
      material.opacity = key.startsWith("stamp")
        ? STAMP_OPACITY * progress.links
        : progress.districts;
  });

  const held = materials.current;
  return (
    <>
      <Layer
        geometry={parts.mask}
        look={{ vertexColors: true, map: parts.hatch }}
        materials={held}
        name="mask"
      />
      <Layer
        geometry={parts.copper}
        look={{ vertexColors: true, metalness: 0.5, roughness: 0.5 }}
        materials={held}
        name="copper"
      />
      <Layer
        geometry={parts.core}
        look={{ vertexColors: true }}
        materials={held}
        name="core"
      />
      <Layer
        geometry={parts.rings}
        look={{ color: colours.copper, metalness: 0.5, roughness: 0.5 }}
        materials={held}
        name="rings"
      />
      <Patches colour={colours.patch} folders={folders} materials={held} />
      <Marks
        fingers={fingers}
        materials={held}
        palette={palette}
        shapes={shapes}
        vias={vias}
      />
      <Stamps districts={districts} materials={held} palette={palette} />
    </>
  );
}
