// The buildings on screen: the instanced parts `buildings.ts` lays out, their glowing
// edges, and the selection and hover frames. Kept out of Scene.tsx so the buildings
// and the boards and traces can change without touching each other.
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { Placement } from "../layout/city";
import {
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

const BOX = new THREE.BoxGeometry();
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
  // cylinderGeometry's default radius is 1, so scale by the radius directly.
  target.scale.set(cell.radius, PLAZA_HEIGHT, cell.radius);
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
  const meshes = useRef(new Map<FloorCellKind, THREE.InstancedMesh>());
  const plazaRef = useRef<THREE.InstancedMesh>(null);
  const windowRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const lastRise = useRef(buildingRiseAt(0, reducedMotion));
  const byKind = useMemo(() => {
    const grouped = Object.fromEntries(
      KINDS.map((kind) => [kind, [] as FloorCell[]])
    ) as Record<FloorCellKind, FloorCell[]>;
    for (const cell of cells) grouped[cell.kind].push(cell);
    return grouped;
  }, [cells]);

  // One material per part, made here rather than in JSX so the intro can fade each
  // to its own resting opacity. The windows and plazas are plain and fade to 1.
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

  const bases = useMemo(
    () =>
      new Map(placements.map((placement) => [placement.id, placement.y ?? 0])),
    [placements]
  );
  const baseOf = (id: string) => bases.get(id) ?? 0;
  const colours = useMemo(() => buildingColours(palette), [palette]);

  // Every part, the windows and the hit target rise about the same base.
  // Keep depth writes and render queues fixed so the fade cannot pop at its end.
  function updateBuildingGeometry(rise: number) {
    for (const [kind, mesh] of meshes.current)
      writeMatrices(mesh, byKind[kind], (cell, target) =>
        placeCell(cell, baseOf(cell.buildingId), rise, target)
      );
    writeMatrices(windowRef.current, windows, (cell, target) =>
      placeWindow(cell, baseOf(cell.buildingId), rise, target)
    );
    writeMatrices(hitRef.current, placements, (placement, target) =>
      placeBox(buildingBox(placement, heights, rise, 0, 0.999), target)
    );
  }

  useEffect(() => {
    updateBuildingGeometry(lastRise.current);
    writeMatrices(plazaRef.current, plazas, placePlaza);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byKind, windows, plazas, placements, heights]);

  useFrame((state) => {
    const rise = buildingRiseAt(state.clock.elapsedTime, reducedMotion);
    if (rise !== lastRise.current) {
      lastRise.current = rise;
      updateBuildingGeometry(rise);
    }
    const opacity = revealAt(state.clock.elapsedTime, reducedMotion).districts;
    for (const [material, resting] of fading)
      material.opacity = opacity * resting;
  });

  useEffect(() => {
    const paint: PaintState = {
      selected,
      hovered,
      neighbours,
      lens: lensColours(scale, colours),
      lensOn: scale !== null,
      district: new Map(placements.map((p) => [p.id, p.districtKind])),
      flatten: new Map(placements.map((p) => [p.id, p.flatten ?? 0])),
    };
    const colour = new THREE.Color();
    for (const [kind, mesh] of meshes.current)
      writeColours(mesh, byKind[kind], (cell) =>
        paintPart(kind, cell.buildingId, colours, paint, colour)
      );
    // A window is the slab's own colour turned up, so it carries the lens, the
    // selection and the fade without a second set of rules. Mandatory properties
    // are turned up further, which is the one thing the wall does not already say.
    writeColours(windowRef.current, windows, (cell) =>
      paintPart(
        cell.kind,
        cell.buildingId,
        colours,
        paint,
        colour
      ).multiplyScalar(cell.mandatory ? 1.9 : 1.45)
    );
    writeColours(plazaRef.current, plazas, (cell) =>
      paintPart("plaza", cell.buildingId, colours, paint, colour)
    );
  }, [
    byKind,
    windows,
    plazas,
    placements,
    selected,
    hovered,
    neighbours,
    colours,
    scale,
  ]);

  const pick = (event: ThreeEvent<MouseEvent | PointerEvent>) =>
    placements[event.instanceId ?? -1];

  return (
    <>
      {KINDS.filter((kind) => byKind[kind].length > 0).map((kind) => (
        <instancedMesh
          args={[BOX, materials.get(kind), byKind[kind].length]}
          castShadow={LOOKS[kind].castShadow}
          key={`${kind}|${byKind[kind].length}`}
          receiveShadow
          ref={(mesh) => {
            if (mesh) meshes.current.set(kind, mesh);
            else meshes.current.delete(kind);
          }}
          // Glass draws after every solid part, so the core shows through it.
          renderOrder={LOOKS[kind].glass ? 1 : 0}
        />
      ))}
      {windows.length > 0 && (
        <instancedMesh
          args={[undefined, plain.window, windows.length]}
          ref={windowRef}
        >
          <planeGeometry />
        </instancedMesh>
      )}
      {plazas.length > 0 && (
        <instancedMesh
          args={[undefined, plain.plaza, plazas.length]}
          receiveShadow
          ref={plazaRef}
        >
          <cylinderGeometry args={[1, 1, 1, 24]} />
        </instancedMesh>
      )}
      {placements.length > 0 && (
        // biome-ignore lint/a11y/noStaticElementInteractions: instancedMesh is a three.js object, not a DOM element; the keyboard path is the command palette.
        <instancedMesh
          args={[undefined, undefined, placements.length]}
          onClick={(event) => {
            event.stopPropagation();
            const placement = pick(event);
            if (placement) onSelect(placement.id);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            const placement = pick(event);
            if (placement) onFocus(placement.id);
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            onHover(pick(event)?.id ?? null);
          }}
          onPointerOut={() => onHover(null)}
          ref={hitRef}
        >
          <boxGeometry />
          <meshBasicMaterial depthWrite={false} opacity={0} transparent />
        </instancedMesh>
      )}
    </>
  );
}

const OUTLINE_POSITIONS = new THREE.EdgesGeometry(BOX).getAttribute("position")
  .array as Float32Array;

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
