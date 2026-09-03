import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { neighbourhoods } from "../model/neighbourhood";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../model/types";
import { cityBounds, layoutCity, type CityBounds, type Placement } from "./layout/city";
import { layoutFocus } from "./layout/focus";
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
  azure: string;
  violet: string;
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
  onFocus,
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
  onFocus: (id: string) => void;
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
  // from there until every building has risen. It runs again on every frame of
  // a focus tween, which is why it reads the intro's progress rather than
  // resetting it; resetting would replay the rise every time a building moves.
  useEffect(() => {
    const startProgress = introDone.current ? 1 : 0;

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
        scratch.position.set(cell.cx, cell.cy + PLAZA_HEIGHT / 2, cell.cz);
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
        scratch.position.set(
          placement.position.x,
          (placement.y ?? 0) + height / 2,
          placement.position.z,
        );
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
  focus,
  palette,
}: {
  placementsById: Map<string, Placement>;
  edges: SchemaGraph["edges"];
  selected: string | null;
  focus: string | null;
  palette: Palette;
}) {
  // In focus mode the city's other roads are noise around a layout that is about
  // one node, so only the roads that touch it get built at all.
  const drawn = useMemo(
    () => (focus ? (edges ?? []).filter((edge) => touches(edge, focus)) : (edges ?? [])),
    [edges, focus],
  );
  const { positions, ranges } = useMemo(
    () => buildRoadGeometry(placementsById, drawn),
    [placementsById, drawn],
  );

  const colors = useMemo(() => {
    const dim = new THREE.Color(palette.dim);
    const faded = dim.clone().lerp(new THREE.Color(palette.background), FADE_MIX);
    const array = new Float32Array(positions.length);
    for (const range of ranges) {
      const lit =
        focus !== null ||
        selected === null ||
        range.edge.from === selected ||
        range.edge.to === selected;
      const colour = lit ? dim : faded;
      for (let i = range.start; i < range.start + range.count; i++) {
        array[i * 3] = colour.r;
        array[i * 3 + 1] = colour.g;
        array[i * 3 + 2] = colour.b;
      }
    }
    return array;
  }, [positions, ranges, selected, focus, palette]);

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

const touches = (edge: SchemaEdge, id: string) => edge.from === id || edge.to === id;

/** How high a composition link arches over the two buildings it joins. */
const LINK_ARCH = 3;
/** How close to the ground a block link dips on its way to the element district. */
const LINK_DIP = 0.25;
const DASH_ON = 0.55;
const DASH_OFF = 0.4;

/**
 * The compositions, blocks and references of the focused node, as straight lines
 * bent over one midpoint. Compositions and inheritance arch above the roofs, block
 * links dip to the ground, and references are dotted. The city draws none of these;
 * they are what makes the inspector's lists visible in focus mode.
 */
function FocusLinks({
  focus,
  edges,
  placementsById,
  heights,
  palette,
}: {
  focus: string;
  edges: SchemaGraph["edges"];
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  palette: Palette;
}) {
  const lines = useMemo(() => {
    const built: Record<"composition" | "block" | "reference", number[]> = {
      composition: [],
      block: [],
      reference: [],
    };
    const roofOf = (id: string) => {
      const placement = placementsById.get(id);
      if (!placement) return null;
      const height = heights.get(id) ?? placement.height;
      return new THREE.Vector3(
        placement.position.x,
        (placement.y ?? 0) + height * 0.8,
        placement.position.z,
      );
    };

    const origin = roofOf(focus);
    if (!origin) return built;

    for (const edge of edges ?? []) {
      // Inheritance is the thicker composition in the plan; one arch covers both
      // until a real ribbon geometry replaces these lines.
      const kind = edge.kind === "inherits" ? "composition" : edge.kind;
      if (kind !== "composition" && kind !== "block" && kind !== "reference") continue;
      if (!touches(edge, focus)) continue;
      const other = roofOf(edge.from === focus ? edge.to : edge.from);
      if (!other) continue;

      const mid = origin.clone().add(other).multiplyScalar(0.5);
      if (kind === "composition") mid.y = Math.max(origin.y, other.y) + LINK_ARCH;
      if (kind === "block") mid.y = LINK_DIP;
      const out = built[kind];
      if (kind === "reference") {
        pushDashes(out, origin, mid);
        pushDashes(out, mid, other);
      } else {
        out.push(origin.x, origin.y, origin.z, mid.x, mid.y, mid.z);
        out.push(mid.x, mid.y, mid.z, other.x, other.y, other.z);
      }
    }
    return built;
  }, [focus, edges, placementsById, heights]);

  const styles = [
    { kind: "composition", colour: palette.azure },
    { kind: "block", colour: palette.amber },
    { kind: "reference", colour: palette.violet },
  ] as const;

  return (
    <>
      {styles.map(({ kind, colour }) =>
        lines[kind].length === 0 ? null : (
          <lineSegments frustumCulled={false} key={kind}>
            <bufferGeometry>
              <bufferAttribute
                args={[new Float32Array(lines[kind]), 3]}
                attach="attributes-position"
              />
            </bufferGeometry>
            <lineBasicMaterial color={colour} />
          </lineSegments>
        ),
      )}
    </>
  );
}

// ponytail: dashes are cut into the geometry rather than drawn with
// LineDashedMaterial, which would need computeLineDistances on a geometry React
// has not attached yet. A dozen reference links is nothing to rebuild.
function pushDashes(out: number[], from: THREE.Vector3, to: THREE.Vector3) {
  const span = from.distanceTo(to);
  for (let at = 0; at < span; at += DASH_ON + DASH_OFF) {
    const a = from.clone().lerp(to, at / span);
    const b = from.clone().lerp(to, Math.min(1, (at + DASH_ON) / span));
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
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
  focusNeighbours,
}: {
  nodesById: Map<string, SchemaNode>;
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  selected: string | null;
  hovered: string | null;
  neighbours: Set<string> | null;
  focusNeighbours: Set<string> | null;
}) {
  const ids = useMemo(() => {
    const set = new Set<string>();
    // A faded building gets no label, not even under the cursor.
    if (hovered && (neighbours === null || neighbours.has(hovered))) set.add(hovered);
    // The focus layout spreads the whole neighbourhood over its own compass, so
    // there every building has room for its name, however many there are.
    if (focusNeighbours) {
      for (const id of focusNeighbours) set.add(id);
      return set;
    }
    if (selected) {
      set.add(selected);
      const direct = [...(neighbours ?? [])].filter((id) => id !== selected);
      // Home has 42 neighbours in the seeded schema, and 42 labels land on top of
      // each other in a district a few hundred pixels wide. Past this many the
      // scene shows none and the inspector's lists are where you read them.
      if (direct.length <= MAX_NEIGHBOUR_LABELS) for (const id of direct) set.add(id);
    }
    return set;
  }, [hovered, selected, neighbours, focusNeighbours]);

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
            position={[
              placement.position.x,
              (placement.y ?? 0) + height + 0.35,
              placement.position.z,
            ]}
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

type View = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
  span: number;
};

/** Milliseconds the camera takes to reach a new framing. */
const FLIGHT_MS = 700;

/** fsn's easing for the establishing shot. */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Where the ortho camera stands to frame `bounds` at a true isometric angle. */
function viewOf(bounds: CityBounds, size: { width: number; height: number }): View {
  const span = citySpan(bounds);
  const direction = new THREE.Vector3(1, 1, 1).normalize();
  return {
    position: new THREE.Vector3(
      bounds.centre.x + direction.x * span,
      direction.y * span,
      bounds.centre.z + direction.z * span,
    ),
    target: new THREE.Vector3(bounds.centre.x, 0, bounds.centre.z),
    zoom: Math.min(size.width, size.height) / span,
    span,
  };
}

/**
 * Frames the city, and flies to a new framing when focus changes it. The flight is
 * an establishing shot in fsn's sense: any pointer down on the canvas ends it where
 * it is, because a camera that keeps moving after you grab it is a camera fighting
 * you. A resize is not a new framing, so it snaps.
 */
function CameraRig({ bounds, reducedMotion }: { bounds: CityBounds; reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const controls = useThree((state) => state.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const flight = useRef<{ from: View; to: View; started: number } | null>(null);
  const framed = useRef<CityBounds | null>(null);

  const view = useMemo(() => viewOf(bounds, size), [bounds, size]);

  useEffect(() => {
    const cancel = () => {
      flight.current = null;
    };
    gl.domElement.addEventListener("pointerdown", cancel);
    return () => gl.domElement.removeEventListener("pointerdown", cancel);
  }, [gl]);

  useEffect(() => {
    const apply = (to: View) => {
      camera.position.copy(to.position);
      camera.zoom = to.zoom;
      // The camera sits `span` units from its target, so a fixed clip range (the
      // spike's original 500) clips the whole city once a real schema's bounds
      // grow past that. Scale it with the city instead.
      camera.near = -to.span * 2;
      camera.far = to.span * 3;
      camera.updateProjectionMatrix();
      if (controls) {
        controls.target.copy(to.target);
        controls.update();
      } else camera.lookAt(to.target);
    };

    const changed = framed.current !== null && framed.current !== bounds;
    framed.current = bounds;
    if (!changed || reducedMotion) {
      apply(view);
      return;
    }
    flight.current = {
      from: {
        position: camera.position.clone(),
        target: controls ? controls.target.clone() : new THREE.Vector3(),
        zoom: camera.zoom,
        span: -camera.near / 2,
      },
      to: view,
      started: performance.now(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bounds, controls, reducedMotion]);

  useFrame(() => {
    const moving = flight.current;
    if (!moving) return;
    const t = easeInOutCubic(Math.min(1, (performance.now() - moving.started) / FLIGHT_MS));
    const span = moving.from.span + (moving.to.span - moving.from.span) * t;

    camera.position.lerpVectors(moving.from.position, moving.to.position, t);
    camera.zoom = moving.from.zoom + (moving.to.zoom - moving.from.zoom) * t;
    camera.near = -span * 2;
    camera.far = span * 3;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.lerpVectors(moving.from.target, moving.to.target, t);
      controls.update();
    }
    if (t >= 1) flight.current = null;
  });

  return null;
}

/** Milliseconds a building takes to move between its city spot and its focus spot. */
const TWEEN_MS = 400;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export default function Scene({
  graph,
  selected,
  focus,
  onSelect,
  onFocus,
}: {
  graph: SchemaGraph;
  selected: string | null;
  focus: string | null;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const city = useMemo(() => layoutCity(graph), [graph]);
  const neighbourhoodById = useMemo(() => neighbourhoods(graph), [graph]);
  const focusNeighbours = useMemo(
    () => (focus ? neighboursOf(graph, focus) : null),
    [graph, focus],
  );
  const target = useMemo(() => {
    const neighbourhood = focus ? neighbourhoodById.get(focus) : undefined;
    return focus && neighbourhood ? layoutFocus(graph, neighbourhood, focus, city) : city;
  }, [focus, graph, neighbourhoodById, city]);

  // The placements on screen right now. They are the city's or the focus layout's
  // everywhere except during the 400 ms between the two.
  const [placements, setPlacements] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    if (shown.current === target) return;
    if (reducedMotion) {
      shown.current = target;
      setPlacements(target);
      return;
    }

    // Tweening from what is on screen, not from the city, is what lets a second
    // focus interrupt the first halfway and carry on from there.
    const from = new Map(shown.current.map((placement) => [placement.id, placement]));
    const started = performance.now();
    let frame = requestAnimationFrame(function step() {
      const t = smootherstep((performance.now() - started) / TWEEN_MS);
      const mixed =
        t >= 1
          ? target
          : target.map((to) => {
              const at = from.get(to.id);
              if (!at || at === to) return to;
              return {
                ...to,
                position: {
                  x: lerp(at.position.x, to.position.x, t),
                  z: lerp(at.position.z, to.position.z, t),
                },
                y: lerp(at.y ?? 0, to.y ?? 0, t),
              };
            });
      shown.current = mixed;
      setPlacements(mixed);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, reducedMotion]);

  // The ground stays the city's however far the focus layout roams, so it never
  // slides out from under the buildings.
  const ground = useMemo(() => cityBounds(city), [city]);
  const span = citySpan(ground);
  // The camera frames the focus layout instead, which is the focused node and
  // everything moved around it, not the whole city behind them.
  const bounds = useMemo(
    () =>
      focusNeighbours
        ? cityBounds(target.filter((placement) => focusNeighbours.has(placement.id)))
        : ground,
    [focusNeighbours, target, ground],
  );
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const placementsById = useMemo(() => new Map(placements.map((p) => [p.id, p])), [placements]);
  const selectionNeighbours = useMemo(
    () => (selected ? neighboursOf(graph, selected) : null),
    [graph, selected],
  );
  // In focus mode the lit set is the focused node's, so clicking through the
  // neighbourhood does not dim the layout you are standing in.
  const neighbours = focusNeighbours ?? selectionNeighbours;
  const { cellsByKind, heights } = useMemo(() => {
    const built = buildFloorCells(nodesById, placements);
    return { cellsByKind: groupByKind(built.cells), heights: built.heights };
  }, [nodesById, placements]);
  const plazas = useMemo(() => buildPlazaCells(nodesById, placements), [nodesById, placements]);

  // The scene colours are the theme's own tokens, read once from an element inside
  // the shadow root, so the city and the chrome can never drift apart.
  useEffect(() => {
    const style = getComputedStyle(host.current as HTMLElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    setPalette({
      amber: token("--amber"),
      azure: token("--azure"),
      background: token("--background"),
      dim: token("--phosphor-dim"),
      phosphor: token("--phosphor"),
      separator: token("--panel-sunken"),
      signal: token("--signal"),
      violet: token("--violet"),
    });
  }, []);

  return (
    <div className="absolute inset-0" ref={host}>
      {palette ? (
        <Canvas orthographic>
          <ambientLight intensity={1.2} />
          <directionalLight intensity={2.4} position={[8, 16, 6]} />
          {/* ponytail: a flat, fixed-size grid stands in for real ground. A proper
              stage (sky, fog, seamless terrain, as fsn does) is a later pass. */}
          <gridHelper
            args={[span * 3, 30, palette.dim, palette.dim]}
            position={[ground.centre.x, 0, ground.centre.z]}
          />
          <Buildings
            cellsByKind={cellsByKind}
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            onFocus={onFocus}
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
            focus={focus}
            palette={palette}
            placementsById={placementsById}
            selected={selected}
          />
          {focus ? (
            <FocusLinks
              edges={graph.edges}
              focus={focus}
              heights={heights}
              palette={palette}
              placementsById={placementsById}
            />
          ) : null}
          <Labels
            focusNeighbours={focusNeighbours}
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            nodesById={nodesById}
            placementsById={placementsById}
            selected={selected}
          />
          <CameraRig bounds={bounds} reducedMotion={reducedMotion} />
          <OrbitControls
            makeDefault
            maxPolarAngle={ISO_POLAR_ANGLE}
            minPolarAngle={ISO_POLAR_ANGLE}
          />
        </Canvas>
      ) : null}
    </div>
  );
}
