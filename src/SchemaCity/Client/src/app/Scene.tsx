import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SchemaGraph, SchemaNode } from "../model/types";
import { cityBounds, layoutCity, type CityBounds, type Placement } from "./layout/city";
import {
  buildFloorCells,
  buildPlazaCells,
  type FloorCell,
  type FloorCellKind,
  type PlazaCell,
  smootherstep,
} from "./scene/buildings";
import { neighboursOf } from "./scene/graph-links";
import { buildRoadGeometry } from "./scene/roads";

type Palette = {
  phosphor: string;
  dim: string;
  signal: string;
  amber: string;
  background: string;
  separator: string;
};

/** Seconds a building takes to rise, once its own `introDelay` has passed. */
const INTRO_DURATION = 0.46;
const PLAZA_HEIGHT = 0.05;
const HOVER_BRIGHTEN = 1.4;
/** How far a faded building's colour moves toward the void, approximating 20% opacity. */
const FADE_MIX = 0.8;

function groupByKind(cells: FloorCell[]): Record<FloorCellKind, FloorCell[]> {
  const byKind: Record<FloorCellKind, FloorCell[]> = {
    own: [],
    composed: [],
    separator: [],
    element: [],
  };
  for (const cell of cells) byKind[cell.kind].push(cell);
  return byKind;
}

function Buildings({
  cellsByKind,
  plazas,
  heights,
  placements,
  selected,
  hovered,
  neighbours,
  reducedMotion,
  palette,
  onSelect,
  onHover,
}: {
  cellsByKind: Record<FloorCellKind, FloorCell[]>;
  plazas: PlazaCell[];
  heights: Map<string, number>;
  placements: Placement[];
  selected: string | null;
  hovered: string | null;
  neighbours: Set<string> | null;
  reducedMotion: boolean;
  palette: Palette;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const ownRef = useRef<THREE.InstancedMesh>(null);
  const composedRef = useRef<THREE.InstancedMesh>(null);
  const separatorRef = useRef<THREE.InstancedMesh>(null);
  const elementRef = useRef<THREE.InstancedMesh>(null);
  const plazaRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const introDone = useRef(reducedMotion);

  const meshRefs = useMemo(
    () => ({ own: ownRef, composed: composedRef, separator: separatorRef, element: elementRef }),
    [],
  );
  const introDelayById = useMemo(
    () => new Map(placements.map((p) => [p.id, p.introDelay])),
    [placements],
  );
  const introEnd = useMemo(
    () => Math.max(0, ...placements.map((p) => p.introDelay)) + INTRO_DURATION,
    [placements],
  );

  const colors = useMemo(() => {
    const phosphor = new THREE.Color(palette.phosphor);
    const dim = new THREE.Color(palette.dim);
    return {
      own: phosphor,
      // Desaturated phosphor: mixed toward phosphor-dim rather than a second hue.
      composed: phosphor.clone().lerp(dim, 0.55),
      separator: new THREE.Color(palette.separator),
      element: new THREE.Color(palette.amber),
      plaza: dim,
      signal: new THREE.Color(palette.signal),
      fade: new THREE.Color(palette.background),
    };
  }, [palette]);

  function applyCell(mesh: THREE.InstancedMesh, index: number, cell: FloorCell, progress: number) {
    scratch.position.set(cell.cx, cell.cy * progress, cell.cz);
    scratch.scale.set(cell.sx, Math.max(cell.sy * progress, 0.0001), cell.sz);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }

  // Sets every mesh to its resting position (or, unless reduced motion is on,
  // to the ground) before the first paint. The frame loop below takes over
  // from there until every building has risen.
  useEffect(() => {
    introDone.current = reducedMotion;
    const startProgress = reducedMotion ? 1 : 0;

    for (const kind of Object.keys(meshRefs) as (keyof typeof meshRefs)[]) {
      const mesh = meshRefs[kind].current;
      if (!mesh) continue;
      cellsByKind[kind].forEach((cell, i) => applyCell(mesh, i, cell, startProgress));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    const plaza = plazaRef.current;
    if (plaza) {
      plazas.forEach((cell, i) => {
        scratch.position.set(cell.cx, PLAZA_HEIGHT / 2, cell.cz);
        // cylinderGeometry's default radius is 1, so scale by the radius directly.
        scratch.scale.set(cell.radius, PLAZA_HEIGHT, cell.radius);
        scratch.updateMatrix();
        plaza.setMatrixAt(i, scratch.matrix);
      });
      plaza.instanceMatrix.needsUpdate = true;
      plaza.computeBoundingSphere();
    }

    const hit = hitRef.current;
    if (hit) {
      placements.forEach((placement, i) => {
        const height = heights.get(placement.id) ?? placement.height;
        scratch.position.set(placement.position.x, height / 2, placement.position.z);
        scratch.scale.set(placement.footprint, height, placement.footprint);
        scratch.updateMatrix();
        hit.setMatrixAt(i, scratch.matrix);
      });
      hit.instanceMatrix.needsUpdate = true;
      hit.computeBoundingSphere();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsByKind, plazas, placements, heights, reducedMotion]);

  useFrame((state) => {
    if (introDone.current) return;
    const elapsed = state.clock.elapsedTime;

    for (const kind of Object.keys(meshRefs) as (keyof typeof meshRefs)[]) {
      const mesh = meshRefs[kind].current;
      if (!mesh) continue;
      cellsByKind[kind].forEach((cell, i) => {
        const delay = introDelayById.get(cell.buildingId) ?? 0;
        applyCell(mesh, i, cell, smootherstep((elapsed - delay) / INTRO_DURATION));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (elapsed >= introEnd) introDone.current = true;
  });

  useEffect(() => {
    const lit = (id: string) => neighbours === null || neighbours.has(id);
    const colourFor = (kind: FloorCellKind, buildingId: string) => {
      const base = buildingId === selected ? colors.signal : colors[kind];
      const bright = buildingId === hovered ? base.clone().multiplyScalar(HOVER_BRIGHTEN) : base;
      return lit(buildingId) ? bright : bright.clone().lerp(colors.fade, FADE_MIX);
    };

    for (const kind of Object.keys(meshRefs) as (keyof typeof meshRefs)[]) {
      const mesh = meshRefs[kind].current;
      if (!mesh) continue;
      cellsByKind[kind].forEach((cell, i) => mesh.setColorAt(i, colourFor(cell.kind, cell.buildingId)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const plaza = plazaRef.current;
    if (plaza) {
      plazas.forEach((cell, i) => {
        const base = cell.buildingId === selected ? colors.signal : colors.plaza;
        const bright = cell.buildingId === hovered ? base.clone().multiplyScalar(HOVER_BRIGHTEN) : base;
        plaza.setColorAt(i, lit(cell.buildingId) ? bright : bright.clone().lerp(colors.fade, FADE_MIX));
      });
      if (plaza.instanceColor) plaza.instanceColor.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsByKind, plazas, selected, hovered, neighbours, colors]);

  const pick = (event: ThreeEvent<MouseEvent | PointerEvent>) => placements[event.instanceId ?? -1];

  return (
    <>
      {cellsByKind.own.length > 0 && (
        <instancedMesh args={[undefined, undefined, cellsByKind.own.length]} ref={ownRef}>
          <boxGeometry />
          <meshStandardMaterial metalness={0.1} roughness={0.45} />
        </instancedMesh>
      )}
      {cellsByKind.composed.length > 0 && (
        <instancedMesh args={[undefined, undefined, cellsByKind.composed.length]} ref={composedRef}>
          <boxGeometry />
          <meshStandardMaterial metalness={0.1} roughness={0.45} />
        </instancedMesh>
      )}
      {cellsByKind.separator.length > 0 && (
        <instancedMesh args={[undefined, undefined, cellsByKind.separator.length]} ref={separatorRef}>
          <boxGeometry />
          <meshStandardMaterial metalness={0.1} roughness={0.6} />
        </instancedMesh>
      )}
      {cellsByKind.element.length > 0 && (
        <instancedMesh args={[undefined, undefined, cellsByKind.element.length]} ref={elementRef}>
          <boxGeometry />
          <meshStandardMaterial metalness={0.05} roughness={0.7} />
        </instancedMesh>
      )}
      {plazas.length > 0 && (
        <instancedMesh args={[undefined, undefined, plazas.length]} ref={plazaRef}>
          <cylinderGeometry args={[1, 1, 1, 24]} />
          <meshStandardMaterial metalness={0} roughness={0.9} />
        </instancedMesh>
      )}
      {placements.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, placements.length]}
          onClick={(event) => {
            event.stopPropagation();
            const placement = pick(event);
            if (placement) onSelect(placement.id);
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            onHover(pick(event)?.id ?? null);
          }}
          onPointerOut={() => onHover(null)}
          ref={hitRef}
        >
          <boxGeometry />
          <meshBasicMaterial opacity={0} transparent />
        </instancedMesh>
      )}
    </>
  );
}

function Roads({
  placementsById,
  edges,
  selected,
  palette,
}: {
  placementsById: Map<string, Placement>;
  edges: SchemaGraph["edges"];
  selected: string | null;
  palette: Palette;
}) {
  const { positions, ranges } = useMemo(
    () => buildRoadGeometry(placementsById, edges ?? []),
    [placementsById, edges],
  );

  const colors = useMemo(() => {
    const dim = new THREE.Color(palette.dim);
    const faded = dim.clone().lerp(new THREE.Color(palette.background), FADE_MIX);
    const array = new Float32Array(positions.length);
    for (const range of ranges) {
      const lit = selected === null || range.edge.from === selected || range.edge.to === selected;
      const colour = lit ? dim : faded;
      for (let i = range.start; i < range.start + range.count; i++) {
        array[i * 3] = colour.r;
        array[i * 3 + 1] = colour.g;
        array[i * 3 + 2] = colour.b;
      }
    }
    return array;
  }, [positions, ranges, selected, palette]);

  if (positions.length === 0) return null;

  return (
    <mesh frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" />
        <bufferAttribute args={[colors, 3]} attach="attributes-color" />
      </bufferGeometry>
      <meshBasicMaterial side={THREE.DoubleSide} vertexColors />
    </mesh>
  );
}

/** How many neighbours of the selected node still get a label each. */
const MAX_NEIGHBOUR_LABELS = 8;

function Labels({
  nodesById,
  placementsById,
  heights,
  selected,
  hovered,
  neighbours,
}: {
  nodesById: Map<string, SchemaNode>;
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  selected: string | null;
  hovered: string | null;
  neighbours: Set<string> | null;
}) {
  const ids = useMemo(() => {
    const set = new Set<string>();
    // A faded building gets no label, not even under the cursor.
    if (hovered && (neighbours === null || neighbours.has(hovered))) set.add(hovered);
    if (selected) {
      set.add(selected);
      const direct = [...(neighbours ?? [])].filter((id) => id !== selected);
      // Home has 42 neighbours in the seeded schema, and 42 labels land on top of
      // each other in a district a few hundred pixels wide. Past this many the
      // scene shows none and the inspector's lists are where you read them.
      if (direct.length <= MAX_NEIGHBOUR_LABELS) for (const id of direct) set.add(id);
    }
    return set;
  }, [hovered, selected, neighbours]);

  return (
    <>
      {[...ids].map((id) => {
        const node = nodesById.get(id);
        const placement = placementsById.get(id);
        if (!node || !placement) return null;
        const height = heights.get(id) ?? placement.height;
        return (
          <Html
            key={id}
            position={[placement.position.x, height + 0.35, placement.position.z]}
            style={{ pointerEvents: "none" }}
            center
          >
            <span className="whitespace-nowrap border border-line-strong bg-panel-raised px-1.5 py-0.5 font-mono text-2xs text-phosphor">
              {node.name}
            </span>
          </Html>
        );
      })}
    </>
  );
}

/** A (1,1,1) view direction is a true isometric angle: 45° azimuth, ~35.26° elevation. */
const ISO_POLAR_ANGLE = Math.acos(1 / Math.sqrt(3));

/**
 * The camera's framing distance, in world units, and the height of what it sees.
 * The grid reuses it too, so the ground always reaches past whatever the camera
 * can see.
 *
 * At a true isometric angle a city `width` by `depth` on the ground covers
 * `(width + depth) / sqrt(6)` of that height, so the longer side on its own frames
 * the whole city with about a quarter of the height left for the buildings
 * standing up in it. The old 1.5x of that pushed the camera far enough back that
 * a single-group building came out under three pixels tall.
 */
function citySpan(bounds: CityBounds): number {
  return Math.max(bounds.width, bounds.depth, 4);
}

/** Fits the ortho camera to the city bounds, at a true isometric angle. */
function CameraFrame({ bounds }: { bounds: CityBounds }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera;
    const span = citySpan(bounds);
    const direction = new THREE.Vector3(1, 1, 1).normalize();
    ortho.position.set(
      bounds.centre.x + direction.x * span,
      direction.y * span,
      bounds.centre.z + direction.z * span,
    );
    ortho.lookAt(bounds.centre.x, 0, bounds.centre.z);
    ortho.zoom = Math.min(size.width, size.height) / span;
    // The camera sits `span` units from its target, so a fixed clip range (the
    // spike's original 500) clips the whole city once a real schema's bounds
    // grow past that. Scale it with the city instead.
    ortho.near = -span * 2;
    ortho.far = span * 3;
    ortho.updateProjectionMatrix();
  }, [bounds, camera, size]);

  return null;
}

export default function Scene({
  graph,
  selected,
  onSelect,
}: {
  graph: SchemaGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const placements = useMemo(() => layoutCity(graph), [graph]);
  const bounds = useMemo(() => cityBounds(placements), [placements]);
  const span = useMemo(() => citySpan(bounds), [bounds]);
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const placementsById = useMemo(() => new Map(placements.map((p) => [p.id, p])), [placements]);
  const neighbours = useMemo(
    () => (selected ? neighboursOf(graph, selected) : null),
    [graph, selected],
  );
  const { cellsByKind, heights } = useMemo(() => {
    const built = buildFloorCells(nodesById, placements);
    return { cellsByKind: groupByKind(built.cells), heights: built.heights };
  }, [nodesById, placements]);
  const plazas = useMemo(() => buildPlazaCells(nodesById, placements), [nodesById, placements]);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // The scene colours are the theme's own tokens, read once from an element inside
  // the shadow root, so the city and the chrome can never drift apart.
  useEffect(() => {
    const style = getComputedStyle(host.current as HTMLElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    setPalette({
      amber: token("--amber"),
      background: token("--background"),
      dim: token("--phosphor-dim"),
      phosphor: token("--phosphor"),
      separator: token("--panel-sunken"),
      signal: token("--signal"),
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelect(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSelect]);

  return (
    <div className="absolute inset-0" ref={host}>
      {palette ? (
        <Canvas orthographic>
          <ambientLight intensity={1.2} />
          <directionalLight intensity={2.4} position={[8, 16, 6]} />
          {/* ponytail: a flat, fixed-size grid stands in for real ground. A proper
              stage (sky, fog, seamless terrain, as fsn does) is a later pass. */}
          <gridHelper
            args={[span * 2, 20, palette.dim, palette.dim]}
            position={[bounds.centre.x, 0, bounds.centre.z]}
          />
          <Buildings
            cellsByKind={cellsByKind}
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            onHover={setHovered}
            onSelect={onSelect}
            palette={palette}
            placements={placements}
            plazas={plazas}
            reducedMotion={reducedMotion}
            selected={selected}
          />
          <Roads
            edges={graph.edges}
            palette={palette}
            placementsById={placementsById}
            selected={selected}
          />
          <Labels
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            nodesById={nodesById}
            placementsById={placementsById}
            selected={selected}
          />
          <CameraFrame bounds={bounds} />
          <OrbitControls
            makeDefault
            maxPolarAngle={ISO_POLAR_ANGLE}
            minPolarAngle={ISO_POLAR_ANGLE}
            target={[bounds.centre.x, 0, bounds.centre.z]}
          />
        </Canvas>
      ) : null}
    </div>
  );
}
