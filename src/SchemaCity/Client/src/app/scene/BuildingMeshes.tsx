// The buildings on screen: the instanced parts `buildings.ts` lays out, their glowing
// edges, and the selection and hover frames. Kept out of Scene.tsx so the buildings
// and the boards and traces can change without touching each other.
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { DistrictKind, Placement } from "../layout/city";
import {
  type BuildingColours,
  type BuildingPalette,
  buildingColours,
  lensColours,
  type PaintState,
  paintPart,
} from "./building-paint";
import {
  type Box,
  buildingBox,
  type FloorCell,
  type FloorCellKind,
  type PlazaCell,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  type WindowCell,
} from "./buildings";
import type { LensScale } from "./lens";
import { buildingRiseAt, revealAt } from "./reveal";

const PLAZA_HEIGHT = 0.05;

/**
 * How each part is lit. `edge` is the glow along the box's edges and `body` the glow
 * over its faces, both in the part's own colour, so hover, selection, the lens and
 * the fade carry into the glow with no rules of their own. `opacity` is the part's
 * opacity once the intro is over. Glass is the composed shell: see-through, drawn
 * after the solid parts and never hiding what is inside it.
 */
type Look = {
  edge: number;
  body: number;
  opacity: number;
  roughness: number;
  metalness: number;
  castShadow: boolean;
  glass?: boolean;
};

const LOOKS: Record<FloorCellKind, Look> = {
  own: {
    edge: 0.9,
    body: 0.05,
    opacity: 1,
    roughness: 0.45,
    metalness: 0.1,
    castShadow: true,
  },
  composed: {
    edge: 1.5,
    body: 0.22,
    opacity: 0.5,
    roughness: 0.2,
    metalness: 0.1,
    castShadow: false,
    glass: true,
  },
  core: {
    edge: 0,
    body: 0,
    opacity: 1,
    roughness: 0.85,
    metalness: 0,
    castShadow: true,
  },
  separator: {
    edge: 0.8,
    body: 0.1,
    opacity: 1,
    roughness: 0.6,
    metalness: 0.1,
    castShadow: false,
  },
  element: {
    edge: 0.9,
    body: 0.05,
    opacity: 1,
    roughness: 0.6,
    metalness: 0.05,
    castShadow: true,
  },
  plinth: {
    edge: 0.5,
    body: 0,
    opacity: 1,
    roughness: 0.75,
    metalness: 0.1,
    castShadow: true,
  },
  pin: {
    edge: 0,
    body: 0.25,
    opacity: 1,
    roughness: 0.35,
    metalness: 0.6,
    castShadow: false,
  },
  litLid: {
    edge: 0.8,
    body: 0.25,
    opacity: 1,
    roughness: 0.4,
    metalness: 0.1,
    castShadow: false,
  },
  lid: {
    edge: 0.6,
    body: 0,
    opacity: 1,
    roughness: 0.7,
    metalness: 0.1,
    castShadow: false,
  },
  marker: {
    edge: 0,
    body: 0.9,
    opacity: 1,
    roughness: 0.5,
    metalness: 0,
    castShadow: false,
  },
};

const KINDS = Object.keys(LOOKS) as FloorCellKind[];

/** Glow width along an edge, in world units, before the one-pixel floor. */
const EDGE_WIDTH = "0.03";

const GLOW_VARYINGS = "varying vec3 vBoxLocal;\nvarying vec3 vBoxScale;";

/**
 * Lights the edges of every instanced box from its own colour, measured in world
 * units so a thin slab and a tall core get the same line. The box's local position
 * says how far a fragment is from each pair of faces; on a face one of those is zero,
 * and the next smallest is the distance to the nearest edge. `fwidth` keeps a far
 * edge at least a pixel wide, clamped so a face seen edge-on does not light up whole.
 */
function glowing(look: Look): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: look.roughness,
    metalness: look.metalness,
    transparent: true,
    opacity: 0,
    depthWrite: !look.glass,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.edgeGlow = { value: look.edge };
    shader.uniforms.bodyGlow = { value: look.body };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${GLOW_VARYINGS}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vBoxLocal = position;
vBoxScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${GLOW_VARYINGS}\nuniform float edgeGlow;\nuniform float bodyGlow;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
vec3 boxGap = (0.5 - abs(vBoxLocal)) * vBoxScale;
float nearestFace = min(boxGap.x, min(boxGap.y, boxGap.z));
float farthestFace = max(boxGap.x, max(boxGap.y, boxGap.z));
float edgeGap = boxGap.x + boxGap.y + boxGap.z - nearestFace - farthestFace;
float edgeLine = 1.0 - smoothstep(0.0, ${EDGE_WIDTH} + min(fwidth(edgeGap), 0.06), edgeGap);
totalEmissiveRadiance += diffuseColor.rgb * (bodyGlow + edgeGlow * edgeLine);`
      );
  };
  return material;
}

/**
 * The unit shapes every instance scales, made per mount and disposed with it. Shared
 * at module level, each renderer that drew them left a dispose listener on them, and
 * a remounted canvas kept its old renderer and its lost context alive through it.
 */
function useUnitShapes() {
  const shapes = useMemo(
    () => ({
      box: new THREE.BoxGeometry(),
      plane: new THREE.PlaneGeometry(),
      // A radius of 1, so a plaza scales by its radius directly.
      disc: new THREE.CylinderGeometry(1, 1, 1, 24),
    }),
    []
  );
  useEffect(
    () => () => {
      shapes.box.dispose();
      shapes.plane.dispose();
      shapes.disc.dispose();
    },
    [shapes]
  );
  return shapes;
}
/** One transform written through for every instance. Each placer sets all of it. */
const SCRATCH = new THREE.Object3D();

/** Writes one matrix per item and tells three.js the mesh moved. */
function writeMatrices<T>(
  mesh: THREE.InstancedMesh | null | undefined,
  items: readonly T[],
  place: (item: T, target: THREE.Object3D) => void
) {
  if (!mesh) return;
  items.forEach((item, i) => {
    place(item, SCRATCH);
    SCRATCH.updateMatrix();
    mesh.setMatrixAt(i, SCRATCH.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function writeColours<T>(
  mesh: THREE.InstancedMesh | null | undefined,
  items: readonly T[],
  colourOf: (item: T) => THREE.Color
) {
  if (!mesh) return;
  items.forEach((item, i) => {
    mesh.setColorAt(i, colourOf(item));
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** A zero-sized box is one the raycaster cannot hit. */
const NO_BOX: Box = { x: 0, y: 0, z: 0, sx: 0, sy: 0, sz: 0 };

function placeBox(box: Box | null, target: THREE.Object3D) {
  const { x, y, z, sx, sy, sz } = box ?? NO_BOX;
  target.position.set(x, y, z);
  target.rotation.set(0, 0, 0);
  target.scale.set(sx, sy, sz);
}

/** A part at `rise` of its height, grown about the ground its building stands on. */
function placeCell(
  cell: FloorCell,
  base: number,
  rise: number,
  target: THREE.Object3D
) {
  target.position.set(cell.cx, base + (cell.cy - base) * rise, cell.cz);
  target.rotation.set(0, 0, 0);
  target.scale.set(cell.sx, cell.sy * rise, cell.sz);
}

/** Windows share their slab's growth and stay on its wall. */
function placeWindow(
  cell: WindowCell,
  base: number,
  rise: number,
  target: THREE.Object3D
) {
  target.position.set(cell.cx, base + (cell.cy - base) * rise, cell.cz);
  target.rotation.set(0, cell.rotY, 0);
  target.scale.set(WINDOW_WIDTH, WINDOW_HEIGHT * rise, 1);
}

function placePlaza(cell: PlazaCell, target: THREE.Object3D) {
  target.position.set(cell.cx, cell.cy + PLAZA_HEIGHT / 2, cell.cz);
  target.rotation.set(0, 0, 0);
  target.scale.set(cell.radius, PLAZA_HEIGHT, cell.radius);
}

type Slot = FloorCellKind | "window" | "plaza" | "hit";

/** The instanced meshes one city of buildings is drawn with, while they are mounted. */
type Meshes = Map<Slot, THREE.InstancedMesh>;

/** Keeps a mesh while it is mounted, so the writers can reach it. */
function hold(meshes: Meshes, slot: Slot, mesh: THREE.InstancedMesh | null) {
  if (mesh) meshes.set(slot, mesh);
  else meshes.delete(slot);
}

/** One instanced mesh, left out while it has nothing to draw. */
function Instances({
  count,
  geometry,
  material,
  held,
  slot,
  castShadow = false,
  renderOrder = 0,
}: {
  count: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | undefined;
  held: Meshes;
  slot: Slot;
  castShadow?: boolean;
  renderOrder?: number;
}) {
  if (count === 0) return null;
  return (
    <instancedMesh
      args={[geometry, material, count]}
      castShadow={castShadow}
      receiveShadow
      ref={(mesh) => hold(held, slot, mesh)}
      renderOrder={renderOrder}
    />
  );
}

/** What the meshes draw, grouped the way they draw it. */
type Parts = {
  byKind: Record<FloorCellKind, FloorCell[]>;
  windows: WindowCell[];
  plazas: PlazaCell[];
  placements: Placement[];
  heights: Map<string, number>;
  /** The ground each building stands on, which its parts rise from. */
  bases: Map<string, number>;
  district: Map<string, DistrictKind>;
  flatten: Map<string, number>;
};

function partsOf(
  cells: FloorCell[],
  windows: WindowCell[],
  plazas: PlazaCell[],
  placements: Placement[],
  heights: Map<string, number>
): Parts {
  const byKind = Object.fromEntries(
    KINDS.map((kind) => [kind, [] as FloorCell[]])
  ) as Record<FloorCellKind, FloorCell[]>;
  for (const cell of cells) byKind[cell.kind].push(cell);
  return {
    byKind,
    windows,
    plazas,
    placements,
    heights,
    bases: new Map(placements.map((p) => [p.id, p.y ?? 0])),
    district: new Map(placements.map((p) => [p.id, p.districtKind])),
    flatten: new Map(placements.map((p) => [p.id, p.flatten ?? 0])),
  };
}

/**
 * Every part, the windows and the hit targets at `rise` of their height, grown about
 * the same base. Depth writes and render queues stay fixed, so the fade cannot pop.
 */
function placeParts(meshes: Meshes, parts: Parts, rise: number) {
  const baseOf = (id: string) => parts.bases.get(id) ?? 0;
  for (const kind of KINDS)
    writeMatrices(meshes.get(kind), parts.byKind[kind], (cell, target) =>
      placeCell(cell, baseOf(cell.buildingId), rise, target)
    );
  writeMatrices(meshes.get("window"), parts.windows, (cell, target) =>
    placeWindow(cell, baseOf(cell.buildingId), rise, target)
  );
  writeMatrices(meshes.get("hit"), parts.placements, (placement, target) =>
    placeBox(buildingBox(placement, parts.heights, rise, 0, 0.999), target)
  );
  writeMatrices(meshes.get("plaza"), parts.plazas, placePlaza);
}

function paintParts(
  meshes: Meshes,
  parts: Parts,
  colours: BuildingColours,
  paint: PaintState
) {
  const colour = new THREE.Color();
  for (const kind of KINDS)
    writeColours(meshes.get(kind), parts.byKind[kind], (cell) =>
      paintPart(kind, cell.buildingId, colours, paint, colour)
    );
  // A window is the slab's own colour turned up, so it carries the lens, the
  // selection and the fade without a second set of rules. Mandatory properties
  // are turned up further, which is the one thing the wall does not already say.
  writeColours(meshes.get("window"), parts.windows, (cell) =>
    paintPart(
      cell.kind,
      cell.buildingId,
      colours,
      paint,
      colour
    ).multiplyScalar(cell.mandatory ? 1.9 : 1.45)
  );
  writeColours(meshes.get("plaza"), parts.plazas, (cell) =>
    paintPart("plaza", cell.buildingId, colours, paint, colour)
  );
}

/** Repaints every part whenever the parts, the selection, the hover or the lens change. */
function usePaintedParts(
  meshes: Meshes,
  parts: Parts,
  palette: BuildingPalette,
  {
    selected,
    hovered,
    neighbours,
    scale,
  }: {
    selected: string | null;
    hovered: string | null;
    neighbours: Set<string> | null;
    scale: LensScale | null;
  }
) {
  const colours = useMemo(() => buildingColours(palette), [palette]);
  useEffect(() => {
    paintParts(meshes, parts, colours, {
      selected,
      hovered,
      neighbours,
      lens: lensColours(scale, colours),
      lensOn: scale !== null,
      district: parts.district,
      flatten: parts.flatten,
    });
  }, [meshes, parts, colours, selected, hovered, neighbours, scale]);
}

/** Places the parts whenever they change, and again each frame the intro rises. */
function useRisingParts(meshes: Meshes, parts: Parts, reducedMotion: boolean) {
  const lastRise = useRef(buildingRiseAt(0, reducedMotion));
  useEffect(() => {
    placeParts(meshes, parts, lastRise.current);
  }, [meshes, parts]);
  useFrame((state) => {
    const rise = buildingRiseAt(state.clock.elapsedTime, reducedMotion);
    if (rise === lastRise.current) return;
    lastRise.current = rise;
    placeParts(meshes, parts, rise);
  });
}

/**
 * One material per part, made here rather than in JSX so the intro can fade each to
 * its own resting opacity. The windows and plazas are plain and fade to 1.
 */
function useBuildingMaterials(reducedMotion: boolean) {
  const materials = useMemo(
    () => new Map(KINDS.map((kind) => [kind, glowing(LOOKS[kind])])),
    []
  );
  const plain = useMemo(
    () => ({
      window: new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        opacity: 0,
      }),
      plaza: new THREE.MeshStandardMaterial({
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: 0,
      }),
    }),
    []
  );
  const fading = useMemo(
    (): [THREE.Material, number][] => [
      ...KINDS.map((kind): [THREE.Material, number] => [
        materials.get(kind) as THREE.Material,
        LOOKS[kind].opacity,
      ]),
      [plain.window, 1],
      [plain.plaza, 1],
    ],
    [materials, plain]
  );
  useEffect(
    () => () => {
      for (const [material] of fading) material.dispose();
    },
    [fading]
  );
  useFrame((state) => {
    const opacity = revealAt(state.clock.elapsedTime, reducedMotion).districts;
    for (const [material, resting] of fading)
      material.opacity = opacity * resting;
  });
  return { materials, plain };
}

export function Buildings({
  cells,
  windows,
  plazas,
  heights,
  placements,
  selected,
  hovered,
  neighbours,
  reducedMotion,
  palette,
  scale,
  onSelect,
  onFocus,
  onHover,
}: {
  cells: FloorCell[];
  windows: WindowCell[];
  plazas: PlazaCell[];
  heights: Map<string, number>;
  placements: Placement[];
  selected: string | null;
  hovered: string | null;
  neighbours: Set<string> | null;
  reducedMotion: boolean;
  palette: BuildingPalette;
  /** The lens colouring, or null when no lens is on. */
  scale: LensScale | null;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const meshes = useRef<Meshes>(new Map());
  const shapes = useUnitShapes();
  const { materials, plain } = useBuildingMaterials(reducedMotion);
  const parts = useMemo(
    () => partsOf(cells, windows, plazas, placements, heights),
    [cells, windows, plazas, placements, heights]
  );

  useRisingParts(meshes.current, parts, reducedMotion);

  usePaintedParts(meshes.current, parts, palette, {
    selected,
    hovered,
    neighbours,
    scale,
  });

  const held = meshes.current;
  return (
    <>
      {KINDS.map((kind) => (
        <Instances
          castShadow={LOOKS[kind].castShadow}
          count={parts.byKind[kind].length}
          geometry={shapes.box}
          held={held}
          key={`${kind}|${parts.byKind[kind].length}`}
          material={materials.get(kind)}
          // Glass draws after every solid part, so the core shows through it.
          renderOrder={LOOKS[kind].glass ? 1 : 0}
          slot={kind}
        />
      ))}
      <Instances
        count={windows.length}
        geometry={shapes.plane}
        held={held}
        material={plain.window}
        slot="window"
      />
      <Instances
        count={plazas.length}
        geometry={shapes.disc}
        held={held}
        material={plain.plaza}
        slot="plaza"
      />
      <HitTargets
        held={held}
        onFocus={onFocus}
        onHover={onHover}
        onSelect={onSelect}
        placements={placements}
      />
    </>
  );
}

/** One invisible box per building, which is what hover, click and double-click hit. */
function HitTargets({
  placements,
  onSelect,
  onFocus,
  onHover,
  held,
}: {
  placements: Placement[];
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
  held: Meshes;
}) {
  if (placements.length === 0) return null;
  const pick = (event: ThreeEvent<MouseEvent | PointerEvent>) => {
    event.stopPropagation();
    return placements[event.instanceId ?? -1]?.id;
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: instancedMesh is a three.js object, not a DOM element; the keyboard path is the command palette.
    <instancedMesh
      args={[undefined, undefined, placements.length]}
      onClick={(event) => {
        const id = pick(event);
        if (id) onSelect(id);
      }}
      onDoubleClick={(event) => {
        const id = pick(event);
        if (id) onFocus(id);
      }}
      onPointerMove={(event) => onHover(pick(event) ?? null)}
      onPointerOut={() => onHover(null)}
      ref={(mesh) => hold(held, "hit", mesh)}
    >
      <boxGeometry />
      <meshBasicMaterial depthWrite={false} opacity={0} transparent />
    </instancedMesh>
  );
}

/** A unit box's twelve edges as line segment ends, read once and kept as plain data. */
const OUTLINE_POSITIONS = (() => {
  const box = new THREE.BoxGeometry();
  const edges = new THREE.EdgesGeometry(box);
  const positions = Float32Array.from(edges.getAttribute("position").array);
  edges.dispose();
  box.dispose();
  return positions;
})();

/**
 * A box of screen-space lines around one building, after fsn's selection and aim
 * boxes: a little wider than the footprint and a little taller than the roof, so it
 * reads as a frame around the component rather than as another of its edges.
 */
function BuildingFrame({
  id,
  colour,
  width,
  opacity,
  grow,
  placementsById,
  heights,
  reducedMotion,
}: {
  id: string | null;
  colour: string;
  width: number;
  opacity: number;
  grow: number;
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  reducedMotion: boolean;
}) {
  const lines = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(OUTLINE_POSITIONS);
    return new LineSegments2(
      geometry,
      new LineMaterial({
        color: colour,
        linewidth: width,
        worldUnits: false,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
      })
    );
  }, [colour, width, opacity]);
  useEffect(
    () => () => {
      lines.geometry.dispose();
      lines.material.dispose();
    },
    [lines]
  );

  useFrame((state) => {
    const placement = id === null ? undefined : placementsById.get(id);
    const rise = buildingRiseAt(state.clock.elapsedTime, reducedMotion);
    // A building on its way to a flat plate has left the conversation.
    const box = placement && buildingBox(placement, heights, rise, grow, 0.5);
    lines.visible = Boolean(box);
    if (box) {
      lines.position.set(box.x, box.y, box.z);
      lines.scale.set(box.sx, box.sy, box.sz);
    }
  });

  return <primitive frustumCulled={false} object={lines} />;
}

/** The selected building's frame in the signal colour, and a quieter one on hover. */
export function BuildingFrames({
  selected,
  hovered,
  palette,
  placementsById,
  heights,
  reducedMotion,
}: {
  selected: string | null;
  hovered: string | null;
  palette: BuildingPalette;
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  reducedMotion: boolean;
}) {
  const shared = { placementsById, heights, reducedMotion };
  return (
    <>
      <BuildingFrame
        colour={palette.signal}
        grow={0.08}
        id={selected}
        opacity={0.95}
        width={2}
        {...shared}
      />
      <BuildingFrame
        colour={palette.phosphor}
        grow={0.16}
        id={hovered === selected ? null : hovered}
        opacity={0.55}
        width={1.4}
        {...shared}
      />
    </>
  );
}
