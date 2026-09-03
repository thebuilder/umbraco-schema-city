import { OrbitControls } from "@react-three/drei";
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
import { CHAR_PX, LABEL_CAP, pickLabels } from "./scene/labels";
import { type Anchor, buildLinkGeometry, type Layer, type LinkRange } from "./scene/layers";
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

/**
 * One colour per vertex, so selecting a node fades every edge it does not touch
 * without the geometry being rebuilt. In focus mode nothing is faded, because
 * every edge drawn there already belongs to the focused node.
 */
function fadeColors(
  ranges: LinkRange[],
  vertices: number,
  colour: THREE.Color,
  background: string,
  selected: string | null,
  focus: string | null,
): Float32Array {
  const faded = colour.clone().lerp(new THREE.Color(background), FADE_MIX);
  const array = new Float32Array(vertices);
  for (const range of ranges) {
    const lit =
      focus !== null ||
      selected === null ||
      range.edge.from === selected ||
      range.edge.to === selected;
    const shown = lit ? colour : faded;
    for (let i = range.start; i < range.start + range.count; i++) {
      array[i * 3] = shown.r;
      array[i * 3 + 1] = shown.g;
      array[i * 3 + 2] = shown.b;
    }
  }
  return array;
}

/** The Structure layer: every allowedChild edge as a ribbon on the ground. */
function Roads({
  placementsById,
  edges,
  selected,
  focus,
  palette,
}: {
  placementsById: Map<string, Placement>;
  edges: SchemaEdge[];
  selected: string | null;
  focus: string | null;
  palette: Palette;
}) {
  const { positions, ranges } = useMemo(
    () => buildRoadGeometry(placementsById, edges),
    [placementsById, edges],
  );
  const colors = useMemo(
    () =>
      fadeColors(
        ranges,
        positions.length,
        new THREE.Color(palette.dim),
        palette.background,
        selected,
        focus,
      ),
    [positions, ranges, selected, focus, palette],
  );

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

/**
 * One of the three link layers, merged into a single line geometry. The geometry is
 * rebuilt when the graph, the layout or the layer set changes, and never for a
 * selection: that only rewrites the colour attribute.
 */
function Links({
  layer,
  edges,
  anchors,
  colour,
  opacity,
  palette,
  selected,
  focus,
}: {
  layer: Exclude<Layer, "structure">;
  edges: SchemaEdge[];
  anchors: Map<string, Anchor>;
  colour: string;
  opacity: number;
  palette: Palette;
  selected: string | null;
  focus: string | null;
}) {
  const { positions, ranges } = useMemo(
    () => buildLinkGeometry(layer, edges, anchors),
    [layer, edges, anchors],
  );
  const colors = useMemo(
    () =>
      fadeColors(
        ranges,
        positions.length,
        new THREE.Color(colour),
        palette.background,
        selected,
        focus,
      ),
    [positions, ranges, colour, palette, selected, focus],
  );

  if (positions.length === 0) return null;

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" />
        <bufferAttribute args={[colors, 3]} attach="attributes-color" />
      </bufferGeometry>
      <lineBasicMaterial opacity={opacity} transparent vertexColors />
    </lineSegments>
  );
}

const touches = (edge: SchemaEdge, id: string) => edge.from === id || edge.to === id;

/**
 * The three layers drawn as lines: the theme token each is coloured with, and how
 * solid it draws. The seeded schema has 62 composition arcs and 38 references,
 * which read as lines, against 302 block links into a district of 15 element
 * types. At full strength that many amber lines are a wall rather than a layer,
 * so the block layer draws faint and the fan reads as a haze over the district it
 * lands on. Which property makes which link is the inspector's job.
 */
const LINK_LAYERS = [
  { layer: "compositions", token: "azure", opacity: 0.85 },
  { layer: "blocks", token: "amber", opacity: 0.3 },
  { layer: "references", token: "violet", opacity: 0.85 },
] as const satisfies readonly {
  layer: Exclude<Layer, "structure">;
  token: keyof Palette;
  opacity: number;
}[];


/** How many neighbours of the selected node still get a label each. */
const MAX_NEIGHBOUR_LABELS = 8;
/** World units between the top face of a building and the bottom of its label. */
const LABEL_LIFT = 0.35;
const LABEL_CLASS =
  "absolute top-0 left-0 hidden whitespace-nowrap border border-line-strong bg-panel-raised px-1.5 py-0.5 font-mono text-2xs text-phosphor";

/**
 * The names on the city, in one DOM layer over the canvas. Candidates are the
 * same as they always were, but which of them are drawn is decided in screen
 * space every time the camera or the layout moves: `pickLabels` keeps the best
 * ranked ones that do not land on each other, and drops the rest.
 *
 * The layer is built and written to by hand rather than through React, because
 * this runs inside the frame loop and forty spans that only ever change their
 * transform are not worth a render each.
 */
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
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const spans = useRef<HTMLSpanElement[]>([]);
  const charPx = useRef(CHAR_PX);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  // The layer is repainted when the camera has moved or the inputs changed, and
  // skipped otherwise, so a still city costs one matrix comparison a frame.
  const dirty = useRef(true);
  const framedAt = useRef(new THREE.Matrix4());
  const framedZoom = useRef(0);

  const candidates = useMemo(() => {
    const ids = new Set<string>();
    // A faded building gets no label, not even under the cursor.
    if (hovered && (neighbours === null || neighbours.has(hovered))) ids.add(hovered);
    // The focus layout spreads the whole neighbourhood over its own compass, so
    // every placed building is a candidate there.
    if (focusNeighbours) for (const id of focusNeighbours) ids.add(id);
    else if (selected) {
      ids.add(selected);
      const direct = [...(neighbours ?? [])].filter((id) => id !== selected);
      // Past this many the scene stops offering the neighbours at all, so a hub
      // does not spend the whole screen budget on one selection.
      if (direct.length <= MAX_NEIGHBOUR_LABELS) for (const id of direct) ids.add(id);
    }

    const built: {
      id: string;
      text: string;
      rank: number;
      footprint: number;
      x: number;
      y: number;
      z: number;
    }[] = [];
    for (const id of ids) {
      const node = nodesById.get(id);
      const placement = placementsById.get(id);
      if (!node || !placement) continue;
      built.push({
        id,
        text: node.name,
        rank: id === selected ? 0 : id === hovered ? 1 : 2,
        footprint: placement.footprint,
        x: placement.position.x,
        y: (placement.y ?? 0) + (heights.get(id) ?? placement.height) + LABEL_LIFT,
        z: placement.position.z,
      });
    }
    return built;
  }, [hovered, selected, neighbours, focusNeighbours, nodesById, placementsById, heights]);

  useEffect(() => {
    dirty.current = true;
  }, [candidates, size]);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const layer = document.createElement("div");
    layer.className = "pointer-events-none absolute inset-0 overflow-hidden";
    // The canvas is aria-hidden and so is everything drawn over it; the
    // inspector and the type list are the accessible reading of the same names.
    layer.setAttribute("aria-hidden", "true");
    const made = Array.from({ length: LABEL_CAP }, () => {
      const span = document.createElement("span");
      span.className = LABEL_CLASS;
      layer.append(span);
      return span;
    });
    parent.append(layer);
    spans.current = made;

    // One measurement of the real font beats a guess at the mono advance, and a
    // wrong width is either labels that touch or labels dropped for nothing.
    const context = document.createElement("canvas").getContext("2d");
    if (context) {
      const style = getComputedStyle(made[0]);
      context.font = `${style.fontSize} ${style.fontFamily}`;
      charPx.current = context.measureText("M").width || CHAR_PX;
    }
    dirty.current = true;

    return () => {
      layer.remove();
      spans.current = [];
    };
  }, [gl]);

  useFrame(() => {
    if (
      !dirty.current &&
      camera.zoom === framedZoom.current &&
      camera.matrixWorld.equals(framedAt.current)
    ) {
      return;
    }
    dirty.current = false;
    framedZoom.current = camera.zoom;
    framedAt.current.copy(camera.matrixWorld);

    const kept = pickLabels(
      candidates.map((candidate) => {
        anchor.set(candidate.x, candidate.y, candidate.z).project(camera);
        return {
          id: candidate.id,
          text: candidate.text,
          rank: candidate.rank,
          pinned: candidate.rank < 2,
          x: (anchor.x * 0.5 + 0.5) * size.width,
          y: (0.5 - anchor.y * 0.5) * size.height,
          // ponytail: an orthographic camera's zoom is exactly its pixels per
          // world unit. The Explore toggle's perspective camera will have to
          // project a second point instead.
          buildingPx: anchor.z > 1 ? 0 : candidate.footprint * camera.zoom,
        };
      }),
      { charPx: charPx.current, width: size.width, height: size.height },
    );

    spans.current.forEach((span, index) => {
      const box = kept[index];
      if (!box) {
        span.style.display = "none";
        return;
      }
      span.style.display = "block";
      span.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
      if (span.textContent !== box.text) span.textContent = box.text;
    });
  });

  return null;
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
  layers,
  onSelect,
  onFocus,
}: {
  graph: SchemaGraph;
  selected: string | null;
  focus: string | null;
  layers: readonly Layer[];
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

  // In focus mode the city's other edges are noise around a layout that is about
  // one node, so only the edges that touch it are built at all. Structure is on
  // there whatever the toolbar says, because a hub without its roads is a list.
  const drawnEdges = useMemo(
    () => (focus ? (graph.edges ?? []).filter((edge) => touches(edge, focus)) : graph.edges ?? []),
    [graph.edges, focus],
  );
  const active = useMemo(
    () => new Set<Layer>(focus ? [...layers, "structure"] : layers),
    [layers, focus],
  );
  // A link leaves from the roof of the building it belongs to, so it stays visible
  // over a tall neighbour and moves with the focus tween.
  const anchors = useMemo(() => {
    const map = new Map<string, Anchor>();
    for (const placement of placements) {
      map.set(placement.id, {
        x: placement.position.x,
        y: (placement.y ?? 0) + (heights.get(placement.id) ?? placement.height) * 0.8,
        z: placement.position.z,
      });
    }
    return map;
  }, [placements, heights]);

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
          {active.has("structure") ? (
            <Roads
              edges={drawnEdges}
              focus={focus}
              palette={palette}
              placementsById={placementsById}
              selected={selected}
            />
          ) : null}
          {LINK_LAYERS.map(({ layer, token, opacity }) =>
            active.has(layer) ? (
              <Links
                anchors={anchors}
                colour={palette[token]}
                edges={drawnEdges}
                focus={focus}
                key={layer}
                layer={layer}
                opacity={opacity}
                palette={palette}
                selected={selected}
              />
            ) : null,
          )}
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
