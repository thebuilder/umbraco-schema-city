import { Html, OrbitControls } from "@react-three/drei";
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { neighbourhoods } from "../model/neighbourhood";
import { reachableWithin } from "../model/reach";
import type { SchemaComparison } from "../model/snapshots";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../model/types";
import {
  type CityBounds,
  cityBounds,
  cityDistricts,
  type District,
  type DistrictKind,
  ISLAND_PAD,
  type Placement,
} from "./layout/city";
import { comparisonCity } from "./layout/comparison";
import { expandFocusLayout } from "./layout/expanded-focus";
import {
  type FocusBounds,
  focusAnchor,
  focusBounds,
  layoutFocus,
} from "./layout/focus";
import { describeRelationship, uniqueConnections } from "./relationship";
import {
  buildFloorCells,
  buildPlazaCells,
  type FloorCell,
  type FloorCellKind,
  type PlazaCell,
  smootherstep,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  type WindowCell,
} from "./scene/buildings";
import {
  type BootPhase,
  connectionBootAt,
  connectionEmphasis,
  connectionPickable,
  connectionTraceAt,
  visibleConnections,
} from "./scene/connection-visibility";
import {
  approach,
  BOOST,
  desiredVelocity,
  FLIGHT_CODES,
  flySpeed,
  groundAxes,
  groundedTarget,
  TURN_SPEED,
  translateFlightEndpoints,
  turnedOffset,
  turnRates,
} from "./scene/flight";
import { framingDistance } from "./scene/framing";
import { neighboursOf } from "./scene/graph-links";
import { iconColour, rasteriseIcon } from "./scene/icons";
import {
  CHAR_PX,
  LABEL_CAP,
  labelAnchors,
  pickLabels,
  visibleLabelIds,
} from "./scene/labels";
import { type Anchor, buildLinkGeometry, type Layer } from "./scene/layers";
import type { LensScale, Ramp } from "./scene/lens";
import {
  buildBoardOutlinePositions,
  buildBuildingOutlinePositions,
  buildingRiseAt,
  growBuildingOutline,
  revealAt,
  traceOutlinePositions,
  transitionToward,
} from "./scene/reveal";
import { buildRoadGeometry, roadTracePositions } from "./scene/roads";
import {
  atmosphere,
  CAMERA_FOV,
  districtStamp,
  FOLDER_TINT_HEIGHT,
  framingAction,
  GRID_FRAGMENT_SHADER,
  GRID_VERTEX_SHADER,
  pixelsPerUnit,
  SKY_FRAGMENT_SHADER,
  SKY_VERTEX_SHADER,
} from "./scene/stage";

/** Retain geometry through exits, then stop drawing a fully hidden layer. */
function useLayerReveal(
  material: RefObject<THREE.Material | null>,
  object: RefObject<THREE.Object3D | null>,
  visible: boolean,
  reducedMotion: boolean,
  geometry?: THREE.BufferGeometry | RefObject<THREE.BufferGeometry | null>,
  segmentCount?: number
) {
  const opacity = useRef(0);
  useFrame((state, delta) => {
    const progress = revealAt(state.clock.elapsedTime, reducedMotion);
    const boot = connectionBootAt(state.clock.elapsedTime, reducedMotion);
    // The bright moving trace owns the entrance; settled paths crossfade under it.
    const target = progress.links * Number(visible && boot.phase !== "trace");
    opacity.current = reducedMotion
      ? target
      : transitionToward(opacity.current, target, Math.min(delta, 0.1));
    const drawGeometry =
      geometry && "current" in geometry ? geometry.current : geometry;
    if (drawGeometry) {
      const drawProgress = boot.trace;
      const drawCount = Math.floor((segmentCount ?? 0) * drawProgress);
      const instanced = drawGeometry as THREE.BufferGeometry & {
        instanceCount?: number;
        isInstancedBufferGeometry?: boolean;
      };
      if (instanced.isInstancedBufferGeometry && segmentCount !== undefined) {
        instanced.instanceCount = drawCount;
      } else {
        drawGeometry.setDrawRange(0, Math.floor(drawCount / 3) * 3);
      }
    }
    if (material.current) material.current.opacity = opacity.current;
    if (object.current) object.current.visible = opacity.current > 0.001;
  });
}

function BootProgress({
  reducedMotion,
  onPhase,
}: {
  reducedMotion: boolean;
  onPhase: (phase: BootPhase) => void;
}) {
  const last = useRef<BootPhase>(reducedMotion ? "done" : "trace");
  useFrame((state) => {
    const { phase } = connectionBootAt(state.clock.elapsedTime, reducedMotion);
    if (phase !== last.current) {
      last.current = phase;
      onPhase(phase);
    }
  });
  return null;
}

type ConnectionPick = {
  edges: SchemaEdge[];
  position: [number, number, number];
};
type PickConnection = (pick: ConnectionPick) => void;

function pickConnectionRange(
  event: ThreeEvent<MouseEvent>,
  vertex: number,
  ranges: readonly { start: number; count: number; edges: SchemaEdge[] }[],
  onPick: PickConnection,
  colors: Float32Array
) {
  const range = ranges.find(
    (item) => vertex >= item.start && vertex < item.start + item.count
  );
  if (!range) return;
  // Hidden incident ranges still share the same pick geometry. Keep the canvas
  // interaction aligned with vertex alpha so an invisible edge cannot open a
  // connection inspector.
  if ((colors[vertex * 4 + 3] as number) < 0.01) return;
  event.stopPropagation();
  onPick({
    edges: uniqueConnections(range.edges),
    position: event.point.toArray(),
  });
}

type Palette = {
  phosphor: string;
  dim: string;
  signal: string;
  amber: string;
  azure: string;
  violet: string;
  background: string;
  separator: string;
  land: string;
  /** The theme's mono stack, for the names printed on the ground. */
  mono: string;
};

const PLAZA_HEIGHT = 0.05;
const HOVER_BRIGHTEN = 1.4;
/** How far a faded building's colour moves toward the void, approximating 20% opacity. */
const FADE_MIX = 0.8;
/** The same, for a building focus mode has pressed flat: about 12% opacity. */
const PLATE_MIX = 0.88;
/** How far an inherits arc is mixed toward white, off the composition azure. */
const INHERITS_MIX = 0.4;

/**
 * Where one building lands on the lens's ramp. Amber to azure both ways, with
 * phosphor-dim as the diverging middle and the unused lens's quiet end, because
 * phosphor against signal is the pair colour-vision deficiency ruins.
 */
function rampColour(
  ramp: Ramp,
  t: number,
  colors: {
    amber: THREE.Color;
    azure: THREE.Color;
    dim: THREE.Color;
    signal: THREE.Color;
  }
): THREE.Color {
  if (ramp === "binary")
    return t >= 0.5 ? colors.signal.clone() : colors.dim.clone();
  if (ramp === "diverging") {
    return t < 0.5
      ? colors.amber.clone().lerp(colors.dim, t * 2)
      : colors.dim.clone().lerp(colors.azure, (t - 0.5) * 2);
  }
  return colors.amber.clone().lerp(colors.azure, t);
}

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
  cellsByKind: Record<FloorCellKind, FloorCell[]>;
  windows: WindowCell[];
  plazas: PlazaCell[];
  heights: Map<string, number>;
  placements: Placement[];
  selected: string | null;
  hovered: string | null;
  neighbours: Set<string> | null;
  reducedMotion: boolean;
  palette: Palette;
  /** The lens colouring, or null when no lens is on. */
  scale: LensScale | null;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const ownRef = useRef<THREE.InstancedMesh>(null);
  const composedRef = useRef<THREE.InstancedMesh>(null);
  const separatorRef = useRef<THREE.InstancedMesh>(null);
  const elementRef = useRef<THREE.InstancedMesh>(null);
  const plazaRef = useRef<THREE.InstancedMesh>(null);
  const windowRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const solidMaterials = useRef(new Map<number, THREE.Material>());
  const lastRise = useRef(buildingRiseAt(0, reducedMotion));
  const bases = useMemo(
    () =>
      new Map(placements.map((placement) => [placement.id, placement.y ?? 0])),
    [placements]
  );
  const scratch = useMemo(() => new THREE.Object3D(), []);
  // Windows are the only thing here that is turned, and a shared scratch object
  // would leave that rotation on the next floor box written through it.
  const turned = useMemo(() => new THREE.Object3D(), []);

  const meshRefs = useMemo(
    () => ({
      own: ownRef,
      composed: composedRef,
      separator: separatorRef,
      element: elementRef,
    }),
    []
  );
  const flatById = useMemo(
    () => new Map(placements.map((p) => [p.id, p.flatten ?? 0])),
    [placements]
  );
  const districtById = useMemo(
    () => new Map(placements.map((p) => [p.id, p.districtKind])),
    [placements]
  );

  const colors = useMemo(() => {
    const phosphor = new THREE.Color(palette.phosphor);
    const dim = new THREE.Color(palette.dim);
    return {
      own: phosphor,
      separator: new THREE.Color(palette.separator),
      element: new THREE.Color(palette.amber),
      plaza: dim,
      signal: new THREE.Color(palette.signal),
      fade: new THREE.Color(palette.background),
      amber: new THREE.Color(palette.amber),
      azure: new THREE.Color(palette.azure),
      dim,
    };
  }, [palette]);

  function applyCell(
    mesh: THREE.InstancedMesh,
    index: number,
    cell: FloorCell,
    rise: number
  ) {
    const base = bases.get(cell.buildingId) ?? 0;
    scratch.position.set(cell.cx, base + (cell.cy - base) * rise, cell.cz);
    scratch.scale.set(cell.sx, cell.sy * rise, cell.sz);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }

  /** Windows share the floor's growth and stay attached to its wall. */
  function applyWindow(
    mesh: THREE.InstancedMesh,
    index: number,
    cell: WindowCell,
    rise: number
  ) {
    const base = bases.get(cell.buildingId) ?? 0;
    turned.position.set(cell.cx, base + (cell.cy - base) * rise, cell.cz);
    turned.rotation.set(0, cell.rotY, 0);
    turned.scale.set(WINDOW_WIDTH, WINDOW_HEIGHT * rise, 1);
    turned.updateMatrix();
    mesh.setMatrixAt(index, turned.matrix);
  }

  function updateWindowGeometry(rise: number) {
    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) => {
        applyWindow(window, i, cell, rise);
      });
      window.instanceMatrix.needsUpdate = true;
      window.computeBoundingSphere();
    }
  }

  // The mesh, windows, hit target and outline use the same rise about each base.
  // Keep depth writes and render queues fixed so the fade cannot pop at its end.
  function updateBuildingGeometry(rise: number) {
    for (const kind of Object.keys(meshRefs) as (keyof typeof meshRefs)[]) {
      const mesh = meshRefs[kind].current;
      if (!mesh) continue;
      cellsByKind[kind].forEach((cell, i) => {
        applyCell(mesh, i, cell, rise);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    updateWindowGeometry(rise);

    const hit = hitRef.current;
    if (hit) {
      placements.forEach((placement, i) => {
        const height = (heights.get(placement.id) ?? placement.height) * rise;
        // A building pressed flat is out of the conversation, so it stops taking the
        // pointer as well: a zero-sized box is one the raycaster cannot hit.
        const pickable = (placement.flatten ?? 0) < 0.999;
        scratch.position.set(
          placement.position.x,
          (placement.y ?? 0) + height / 2,
          placement.position.z
        );
        scratch.scale.set(
          pickable ? placement.footprint : 0,
          pickable ? height : 0,
          pickable ? placement.footprint : 0
        );
        scratch.updateMatrix();
        hit.setMatrixAt(i, scratch.matrix);
      });
      hit.instanceMatrix.needsUpdate = true;
      hit.computeBoundingSphere();
    }
  }

  useEffect(() => {
    updateBuildingGeometry(lastRise.current);
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

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsByKind, windows, plazas, placements, heights, reducedMotion]);

  useFrame((state) => {
    const rise = buildingRiseAt(state.clock.elapsedTime, reducedMotion);
    if (rise !== lastRise.current) {
      lastRise.current = rise;
      updateBuildingGeometry(rise);
    }
    const opacity = revealAt(state.clock.elapsedTime, reducedMotion).districts;
    for (const material of solidMaterials.current.values())
      material.opacity = opacity;
  });

  useEffect(() => {
    const lit = (id: string) => neighbours === null || neighbours.has(id);
    // A building pressed flat is further out of the way than a merely faded one, so
    // the focus layout stands on a map rather than in a crowd.
    const fadeOf = (id: string) =>
      FADE_MIX + (PLATE_MIX - FADE_MIX) * (flatById.get(id) ?? 0);
    // A lens repaints the buildings it has a number for. The ones it says nothing
    // about are Element Types, which have no content of their own, and under a lens
    // they go phosphor-dim: amber is the zero end of the ramp, and an amber district
    // sitting next to it reads as the emptiest place in the city.
    const lensColour = (buildingId: string) => {
      const t = scale?.t.get(buildingId);
      return t === undefined || !scale
        ? null
        : rampColour(scale.ramp, t, colors);
    };
    // A building takes its colour from the district it stands in, not from what it
    // is: a structure district is phosphor, an element district amber, and a
    // composition or mixed district phosphor-dim. A composed floor is the same
    // colour desaturated, whichever district that is.
    const districtColour = (buildingId: string) => {
      const district = districtById.get(buildingId);
      if (district === "elements") return colors.element;
      if (district === "structure") return colors.own;
      return colors.dim;
    };
    const colourFor = (kind: FloorCellKind, buildingId: string) => {
      const district = districtColour(buildingId);
      const unlit =
        kind === "separator"
          ? colors.separator
          : kind === "composed"
            ? district.clone().lerp(colors.dim, 0.55)
            : scale && kind === "element"
              ? colors.dim
              : district;
      const base =
        buildingId === selected
          ? colors.signal
          : (lensColour(buildingId) ?? unlit);
      const bright =
        buildingId === hovered
          ? base.clone().multiplyScalar(HOVER_BRIGHTEN)
          : base;
      return lit(buildingId)
        ? bright
        : bright.clone().lerp(colors.fade, fadeOf(buildingId));
    };

    for (const kind of Object.keys(meshRefs) as (keyof typeof meshRefs)[]) {
      const mesh = meshRefs[kind].current;
      if (!mesh) continue;
      cellsByKind[kind].forEach((cell, i) => {
        mesh.setColorAt(i, colourFor(cell.kind, cell.buildingId));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // A window is the floor's own colour turned up, so it carries the lens, the
    // selection and the fade without a second set of rules. Mandatory properties
    // are turned up further, which is the one thing the wall does not already say.
    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) => {
        window.setColorAt(
          i,
          colourFor(cell.kind, cell.buildingId)
            .clone()
            .multiplyScalar(cell.mandatory ? 1.9 : 1.45)
        );
      });
      if (window.instanceColor) window.instanceColor.needsUpdate = true;
    }

    const plaza = plazaRef.current;
    if (plaza) {
      plazas.forEach((cell, i) => {
        const base =
          cell.buildingId === selected ? colors.signal : colors.plaza;
        const bright =
          cell.buildingId === hovered
            ? base.clone().multiplyScalar(HOVER_BRIGHTEN)
            : base;
        plaza.setColorAt(
          i,
          lit(cell.buildingId)
            ? bright
            : bright.clone().lerp(colors.fade, fadeOf(cell.buildingId))
        );
      });
      if (plaza.instanceColor) plaza.instanceColor.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cellsByKind,
    windows,
    plazas,
    selected,
    hovered,
    neighbours,
    colors,
    scale,
    flatById,
    districtById,
  ]);

  const pick = (event: ThreeEvent<MouseEvent | PointerEvent>) =>
    placements[event.instanceId ?? -1];

  return (
    <>
      {cellsByKind.own.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, cellsByKind.own.length]}
          castShadow
          receiveShadow
          ref={ownRef}
        >
          <boxGeometry />
          <meshStandardMaterial
            metalness={0.1}
            opacity={reducedMotion ? 1 : 0}
            ref={trackMaterial(solidMaterials.current, 0)}
            roughness={0.45}
            transparent
          />
        </instancedMesh>
      )}
      {cellsByKind.composed.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, cellsByKind.composed.length]}
          castShadow
          receiveShadow
          ref={composedRef}
        >
          <boxGeometry />
          <meshStandardMaterial
            metalness={0.1}
            opacity={reducedMotion ? 1 : 0}
            ref={trackMaterial(solidMaterials.current, 1)}
            roughness={0.45}
            transparent
          />
        </instancedMesh>
      )}
      {cellsByKind.separator.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, cellsByKind.separator.length]}
          castShadow
          receiveShadow
          ref={separatorRef}
        >
          <boxGeometry />
          <meshStandardMaterial
            metalness={0.1}
            opacity={reducedMotion ? 1 : 0}
            ref={trackMaterial(solidMaterials.current, 2)}
            roughness={0.6}
            transparent
          />
        </instancedMesh>
      )}
      {cellsByKind.element.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, cellsByKind.element.length]}
          castShadow
          receiveShadow
          ref={elementRef}
        >
          <boxGeometry />
          <meshStandardMaterial
            metalness={0.05}
            opacity={reducedMotion ? 1 : 0}
            ref={trackMaterial(solidMaterials.current, 3)}
            roughness={0.7}
            transparent
          />
        </instancedMesh>
      )}
      {windows.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, windows.length]}
          ref={windowRef}
        >
          <planeGeometry />
          <meshBasicMaterial
            opacity={reducedMotion ? 1 : 0}
            ref={trackMaterial(solidMaterials.current, 4)}
            toneMapped={false}
            transparent
          />
        </instancedMesh>
      )}
      {plazas.length > 0 && (
        <instancedMesh
          args={[undefined, undefined, plazas.length]}
          receiveShadow
          ref={plazaRef}
        >
          <cylinderGeometry args={[1, 1, 1, 24]} />
          <meshStandardMaterial
            metalness={0}
            opacity={reducedMotion ? 1 : 0}
            ref={trackMaterial(solidMaterials.current, 5)}
            roughness={0.9}
            transparent
          />
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

/** Screen-space strokes with a continuously advancing endpoint, not whole-edge jumps. */
function IntroOutline({
  positions,
  colour,
  reducedMotion,
  strength = 1,
  grow = false,
  phase = "stage",
  width = 1.3,
}: {
  positions: Float32Array;
  phase?: "stage" | "connections";
  width?: number;
  grow?: boolean;
  colour: string;
  reducedMotion: boolean;
  strength?: number;
}) {
  const traced = useMemo(() => positions.slice(), [positions]);
  const geometry = useMemo(() => {
    const next = new LineSegmentsGeometry();
    next.setPositions(traced);
    next.instanceCount = 0;
    return next;
  }, [traced]);
  const material = useMemo(
    () =>
      new LineMaterial({
        color: colour,
        linewidth: width,
        worldUnits: false,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        toneMapped: false,
      }),
    [colour, width]
  );
  const lines = useMemo(
    () => new LineSegments2(geometry, material),
    [geometry, material]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    const reveal = revealAt(state.clock.elapsedTime, reducedMotion);
    const progress =
      phase === "connections"
        ? connectionTraceAt(state.clock.elapsedTime, reducedMotion)
        : { trace: reveal.trace, opacity: reveal.wireframe };
    material.opacity = progress.opacity * strength;
    lines.visible = material.opacity > 0.001;
    if (!lines.visible) return;
    geometry.instanceCount =
      traceOutlinePositions(positions, traced, progress.trace) / 2;
    if (grow)
      growBuildingOutline(
        traced,
        buildingRiseAt(state.clock.elapsedTime, reducedMotion)
      );
    (
      geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute
    ).data.needsUpdate = true;
  });
  return <primitive frustumCulled={false} object={lines} />;
}

function BuildingOutlines({
  cellsByKind,
  palette,
  reducedMotion,
}: {
  cellsByKind: Record<FloorCellKind, FloorCell[]>;
  palette: Palette;
  reducedMotion: boolean;
}) {
  const positions = useMemo(
    () => buildBuildingOutlinePositions(Object.values(cellsByKind).flat()),
    [cellsByKind]
  );
  return (
    <IntroOutline
      colour={palette.phosphor}
      grow
      positions={positions}
      reducedMotion={reducedMotion}
      strength={0.75}
    />
  );
}

/** Fraction of the footprint one roof icon covers, and the cap under it. */
const ICON_FOOTPRINT = 0.7;
const CAP_FOOTPRINT = 0.88;
/**
 * A building narrower than this on screen gets no icon. Most of a schema shares two
 * or three icons, so a city of 12 px smudges reads as noise rather than as identity.
 * It was 40 px, from when an icon was extruded and needed the size to read as a
 * shape; flat on the roof it holds together at 24, which is most of a district at
 * the framing zoom rather than a handful of buildings. The inspector header carries
 * the same icon at any zoom.
 */
const ICON_MIN_PX = 24;

/** One rasterised icon, the buildings that wear it, and where its caps start. */
type IconGroup = {
  key: string;
  texture: THREE.Texture;
  ids: string[];
  offset: number;
};

/**
 * The icons, rasterised once per name and colour and kept until the graph changes.
 * The map is empty until they have decoded, which is a frame or two after the city
 * paints, and a type whose icon the host did not hand over is simply not in it.
 */
function useIconGroups(
  icons: Record<string, string> | undefined,
  nodesById: Map<string, SchemaNode>,
  phosphor: string
): IconGroup[] {
  const wanted = useMemo(() => {
    const byKey = new Map<
      string,
      { svg: string; colour: string; ids: string[] }
    >();
    // The palette arrives one render in, and rasterising against a colour that is
    // not the theme's yet would do every icon twice.
    if (!(icons && phosphor)) return byKey;
    // Sorted, so the draw order of the icon meshes is the same city to city.
    for (const node of [...nodesById.values()].sort((a, b) =>
      a.alias.localeCompare(b.alias)
    )) {
      const svg = icons[node.icon];
      if (!svg) continue;
      const colour = iconColour(node.iconColor, phosphor);
      const key = `${node.icon}|${colour}`;
      const group = byKey.get(key) ?? { svg, colour, ids: [] };
      group.ids.push(node.id);
      byKey.set(key, group);
    }
    return byKey;
  }, [icons, nodesById, phosphor]);

  const [groups, setGroups] = useState<IconGroup[]>([]);

  useEffect(() => {
    let live = true;
    const made: IconGroup[] = [];
    Promise.all(
      [...wanted].map(async ([key, { svg, colour, ids }]) => {
        // An icon the browser cannot draw is one the city goes without.
        const canvas = await rasteriseIcon(key, svg, colour).catch(() => null);
        if (!canvas) return;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        made.push({ key, texture, ids, offset: 0 });
      })
    ).then(() => {
      if (!live) return;
      // The caps are one mesh across every group, so each group is told where its
      // own instances start in it.
      let offset = 0;
      for (const group of made) {
        group.offset = offset;
        offset += group.ids.length;
      }
      setGroups(made);
    });

    return () => {
      live = false;
      for (const group of made) group.texture.dispose();
    };
  }, [wanted]);

  return groups;
}

/**
 * The Umbraco icon of each type, painted flat on its roof over a darker cap. Flat
 * rather than billboarded, because a sprite standing over the roof lands behind the
 * label of the very building it names. One instanced mesh per
 * icon and colour, which the seeded schema makes 15 of, and the whole set is
 * rewritten every frame, which is 78 matrices: nothing next to the buildings.
 *
 * An icon whose building is under `ICON_MIN_PX` across is scaled away rather than
 * drawn, the same projected measure the label layer culls names by, except for the
 * selected and the hovered building, which keep theirs at any zoom. Each icon sits
 * over a darker cap on the roof, so a pale glyph still has something to read against.
 */
function RoofIcons({
  groups,
  placementsById,
  heights,
  neighbours,
  selected,
  hovered,
  palette,
  reducedMotion,
}: {
  groups: IconGroup[];
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  neighbours: Set<string> | null;
  selected: string | null;
  hovered: string | null;
  palette: Palette;
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const meshes = useRef(new Map<string, THREE.InstancedMesh>());
  const capRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const cap = useMemo(() => new THREE.Object3D(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const caps = groups.reduce((total, group) => total + group.ids.length, 0);

  useEffect(() => {
    const lit = new THREE.Color(1, 1, 1);
    const faded = new THREE.Color(palette.background).lerp(lit, 0.22);
    for (const group of groups) {
      const mesh = meshes.current.get(group.key);
      if (!mesh) continue;
      group.ids.forEach((id, index) => {
        mesh.setColorAt(
          index,
          neighbours === null || neighbours.has(id) ? lit : faded
        );
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [groups, neighbours, palette]);

  useFrame((state) => {
    const detailOpacity = revealAt(
      state.clock.elapsedTime,
      reducedMotion
    ).links;
    const plate = capRef.current;
    if (plate)
      (plate.material as THREE.Material).opacity = detailOpacity * 0.55;
    for (const group of groups) {
      const mesh = meshes.current.get(group.key);
      if (!mesh) continue;
      (mesh.material as THREE.Material).opacity = detailOpacity;
      group.ids.forEach((id, index) => {
        const placement = placementsById.get(id);
        const side = (placement?.footprint ?? 0) * ICON_FOOTPRINT;
        const roof = placement
          ? (placement.y ?? 0) + (heights.get(id) ?? placement.height)
          : 0;
        if (placement)
          anchor.set(placement.position.x, roof, placement.position.z);
        const px = placement
          ? placement.footprint *
            pixelsPerUnit(size.height, camera.position.distanceTo(anchor))
          : 0;
        const shown =
          placement !== undefined &&
          (px >= ICON_MIN_PX || id === selected || id === hovered);

        scratch.position.set(anchor.x, roof + 0.03, anchor.z);
        scratch.rotation.set(-Math.PI / 2, 0, 0);
        scratch.scale.setScalar(shown ? side : 0);
        scratch.updateMatrix();
        mesh.setMatrixAt(index, scratch.matrix);

        if (!plate) return;
        cap.position.set(
          placement?.position.x ?? 0,
          roof + 0.02,
          placement?.position.z ?? 0
        );
        cap.rotation.set(-Math.PI / 2, 0, 0);
        cap.scale.setScalar(
          shown ? (placement?.footprint ?? 0) * CAP_FOOTPRINT : 0
        );
        cap.updateMatrix();
        plate.setMatrixAt(group.offset + index, cap.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (plate) plate.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {caps > 0 && (
        <instancedMesh
          args={[undefined, undefined, caps]}
          frustumCulled={false}
          ref={capRef}
        >
          <planeGeometry />
          <meshBasicMaterial
            color={palette.background}
            depthWrite={false}
            opacity={reducedMotion ? 0.55 : 0}
            transparent
          />
        </instancedMesh>
      )}
      {groups.map((group) => (
        <instancedMesh
          args={[undefined, undefined, group.ids.length]}
          frustumCulled={false}
          key={group.key}
          ref={(mesh) => {
            if (mesh) meshes.current.set(group.key, mesh);
            else meshes.current.delete(group.key);
          }}
          renderOrder={1}
        >
          <planeGeometry />
          <meshBasicMaterial
            alphaTest={0.08}
            depthWrite={false}
            map={group.texture}
            opacity={reducedMotion ? 1 : 0}
            side={THREE.DoubleSide}
            transparent
          />
        </instancedMesh>
      ))}
    </>
  );
}

/** Colour and strength for one edge's vertices. */
type Paint = { colour: THREE.Color; alpha: number };

/**
 * One rgba colour per vertex, so selecting a node fades every edge it does not touch
 * without the geometry being rebuilt, and one edge can draw at its own colour and
 * strength inside a merged geometry. In focus mode nothing is faded, because every
 * edge drawn there already belongs to the focused node.
 */
function edgeColors(
  ranges: readonly { edges: SchemaEdge[]; start: number; count: number }[],
  vertices: number,
  paint: (edges: SchemaEdge[]) => Paint
): Float32Array {
  const array = new Float32Array(vertices * 4);
  for (const range of ranges) {
    const { colour, alpha } = paint(range.edges);
    for (let i = range.start; i < range.start + range.count; i++)
      array.set([colour.r, colour.g, colour.b, alpha], i * 4);
  }
  return array;
}

/**
 * The Structure layer: every allowedChild edge as a ribbon on the ground.
 *
 * Phosphor-dim keeps the overview's hundreds of roads behind the buildings. Focus
 * mode draws one node's edges and nothing else, so there is no crowd to hold back
 * and the roads take the full phosphor, which is what makes them read at the width
 * the README's screenshot is taken at.
 */
function useFadedEdgeColors(
  colors: Float32Array,
  reducedMotion: boolean,
  geometry: RefObject<THREE.BufferGeometry | null>
) {
  const fadedColors = useMemo(() => colors.slice(), [colors.length]);
  useFrame((_, delta) => {
    const step = reducedMotion ? 1 : Math.min(delta, 0.1);
    for (let i = 0; i < colors.length; i += 4) {
      fadedColors[i] = colors[i] as number;
      fadedColors[i + 1] = colors[i + 1] as number;
      fadedColors[i + 2] = colors[i + 2] as number;
      fadedColors[i + 3] = transitionToward(
        fadedColors[i + 3] as number,
        colors[i + 3] as number,
        step
      );
    }
    const attribute = geometry.current?.getAttribute("color");
    if (attribute) attribute.needsUpdate = true;
  });

  return fadedColors;
}

function Roads({
  placementsById,
  edges,
  focus,
  selected,
  hovered,
  boot,
  palette,
  reducedMotion,
  visible,
  enabled,
  onPick,
}: {
  placementsById: Map<string, Placement>;
  edges: SchemaEdge[];
  focus: string | null;
  selected: string | null;
  hovered: string | null;
  boot: BootPhase;
  palette: Palette;
  reducedMotion: boolean;
  visible: boolean;
  enabled: boolean;
  onPick: PickConnection;
}) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useRef<THREE.BufferGeometry>(null);
  const { positions, ranges } = useMemo(
    () => buildRoadGeometry(placementsById, edges),
    [placementsById, edges]
  );
  useLayerReveal(
    material,
    mesh,
    visible,
    reducedMotion,
    geometry,
    positions.length / 3
  );
  const colors = useMemo(() => {
    const colour = new THREE.Color(palette.phosphor);
    return edgeColors(ranges, positions.length / 3, (rangeEdges) => ({
      colour,
      alpha: connectionEmphasis(
        rangeEdges,
        selected,
        hovered,
        focus !== null,
        boot,
        enabled
      ),
    }));
  }, [positions, ranges, focus, selected, hovered, boot, palette, enabled]);
  const fadedColors = useFadedEdgeColors(colors, reducedMotion, geometry);

  function pickRoad(event: ThreeEvent<MouseEvent>) {
    if (
      !connectionPickable(
        visible,
        material.current?.opacity ?? 0,
        event.faceIndex,
        3,
        fadedColors
      )
    )
      return;
    pickConnectionRange(
      event,
      (event.faceIndex as number) * 3,
      ranges,
      onPick,
      fadedColors
    );
  }

  if (positions.length === 0) return null;

  return (
    <>
      <ConnectionIntro boot={boot} enabled={enabled} visible={visible}>
        <RoadIntroTrace
          colour={palette.phosphor}
          edges={edges}
          placementsById={placementsById}
          reducedMotion={reducedMotion}
        />
      </ConnectionIntro>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three mesh; keyboard users inspect the same connections in the inspector. */}
      <mesh frustumCulled={false} onClick={pickRoad} ref={mesh}>
        <bufferGeometry ref={geometry}>
          <bufferAttribute args={[positions, 3]} attach="attributes-position" />
          <bufferAttribute args={[fadedColors, 4]} attach="attributes-color" />
        </bufferGeometry>
        <meshBasicMaterial
          depthWrite={false}
          opacity={0}
          ref={material}
          side={THREE.DoubleSide}
          transparent
          vertexColors
        />
      </mesh>
    </>
  );
}

function ConnectionIntro({
  enabled,
  visible,
  boot,
  children,
}: {
  visible: boolean;
  boot: BootPhase;
  children: ReactNode;
  enabled: boolean;
}) {
  return enabled && visible && boot !== "done" ? children : null;
}

function RoadIntroTrace({
  placementsById,
  edges,
  colour,
  reducedMotion,
}: {
  placementsById: Map<string, Placement>;
  edges: SchemaEdge[];
  colour: string;
  reducedMotion: boolean;
}) {
  const positions = useMemo(
    () => roadTracePositions(placementsById, edges),
    [placementsById, edges]
  );
  return (
    <IntroOutline
      colour={colour}
      phase="connections"
      positions={positions}
      reducedMotion={reducedMotion}
      width={1.7}
    />
  );
}

/** Screen-space line material with the same per-segment alpha as the schema geometry. */
function createLinkMaterial(): LineMaterial {
  const next = new LineMaterial({
    color: 0xff_ff_ff,
    depthWrite: false,
    opacity: 0,
    transparent: true,
    vertexColors: true,
    linewidth: 1.7,
    worldUnits: false,
  });
  next.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <color_pars_vertex>",
        "#include <color_pars_vertex>\nattribute float instanceAlpha;\nvarying float linkAlpha;"
      )
      .replace(
        "vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;",
        "vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;\n\t\t\tlinkAlpha = instanceAlpha;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <color_pars_fragment>",
        "#include <color_pars_fragment>\nvarying float linkAlpha;"
      )
      .replace("float alpha = opacity;", "float alpha = opacity * linkAlpha;");
  };
  return next;
}

/**
 * One of the three link layers, merged into a single line geometry. The geometry is
 * rebuilt when the graph, the layout or the layer set changes, and never for a
 * selection: that only rewrites the colour attribute.
 *
 * The layer's strength rides in the vertex alpha rather than on the material, so an
 * inherits arc draws solid in its own brighter azure while the compositions around
 * it stay at the layer's opacity, out of the one geometry.
 */
function Links({
  layer,
  selected,
  hovered,
  focused,
  boot,
  edges,
  anchors,
  placementsById,
  colour,
  opacity,
  reducedMotion,
  visible,
  enabled,
  onPick,
}: {
  layer: Exclude<Layer, "structure">;
  selected: string | null;
  hovered: string | null;
  focused: boolean;
  boot: BootPhase;
  edges: SchemaEdge[];
  anchors: Map<string, Anchor>;
  placementsById: Map<string, Placement>;
  colour: string;
  opacity: number;
  reducedMotion: boolean;
  visible: boolean;
  enabled: boolean;
  onPick: PickConnection;
}) {
  const { positions, ranges } = useMemo(
    () => buildLinkGeometry(layer, edges, anchors, placementsById),
    [layer, edges, anchors, placementsById]
  );
  const colors = useMemo(() => {
    const layerPaint = { colour: new THREE.Color(colour), alpha: opacity };
    // Inheritance is the stronger fact between two types, so it takes the layer's
    // azure mixed toward white and draws solid. It used to be two arcs a hair apart
    // faking a thicker line, which read as two lines.
    const inheritsPaint = {
      colour: tint(colour, WHITE, INHERITS_MIX),
      alpha: 1,
    };
    return edgeColors(ranges, positions.length / 3, (range) => {
      const paint = range[0]?.kind === "inherits" ? inheritsPaint : layerPaint;
      return {
        ...paint,
        alpha:
          paint.alpha *
          connectionEmphasis(range, selected, hovered, focused, boot, enabled),
      };
    });
  }, [
    positions,
    ranges,
    colour,
    opacity,
    selected,
    hovered,
    focused,
    boot,
    enabled,
  ]);

  return (
    <>
      <ConnectionIntro boot={boot} enabled={enabled} visible={visible}>
        <IntroOutline
          colour={colour}
          phase="connections"
          positions={positions}
          reducedMotion={reducedMotion}
          width={1.7}
        />
      </ConnectionIntro>
      <LinkStrokes
        colors={colors}
        onPick={onPick}
        positions={positions}
        ranges={ranges}
        reducedMotion={reducedMotion}
        visible={visible}
      />
    </>
  );
}

/** Own the GPU resources independently of graph selection and layer styling. */
function LinkStrokes({
  colors,
  ranges,
  positions,
  reducedMotion,
  visible,
  onPick,
}: {
  colors: Float32Array;
  ranges: { edges: SchemaEdge[]; start: number; count: number }[];
  positions: Float32Array;
  reducedMotion: boolean;
  visible: boolean;
  onPick: PickConnection;
}) {
  const geometry = useMemo(() => {
    const next = new LineSegmentsGeometry();
    next.setPositions(positions);
    return next;
  }, [positions]);
  const material = useMemo(createLinkMaterial, []);
  const lines = useMemo(
    () => new LineSegments2(geometry, material),
    [geometry, material]
  );
  const materialRef = useRef<LineMaterial>(material);
  const linesRef = useRef<LineSegments2>(null);
  useLayerReveal(
    materialRef,
    linesRef,
    visible,
    reducedMotion,
    geometry,
    positions.length / 6
  );
  useEffect(() => {
    const rgb: number[] = [];
    const alpha: number[] = [];
    for (let i = 0; i < colors.length; i += 8) {
      rgb.push(
        colors[i] as number,
        colors[i + 1] as number,
        colors[i + 2] as number,
        colors[i + 4] as number,
        colors[i + 5] as number,
        colors[i + 6] as number
      );
      alpha.push(colors[i + 3] as number);
    }
    geometry.setColors(rgb);
    if (!geometry.getAttribute("instanceAlpha"))
      geometry.setAttribute(
        "instanceAlpha",
        new THREE.InstancedBufferAttribute(new Float32Array(alpha), 1)
      );
  }, [colors, geometry]);
  useFrame((_, delta) => {
    const attribute = geometry.getAttribute("instanceAlpha");
    if (!attribute) return;
    for (let i = 0; i < attribute.count; i++) {
      const target = colors[i * 8 + 3] as number;
      attribute.setX(
        i,
        reducedMotion
          ? target
          : transitionToward(attribute.getX(i), target, Math.min(delta, 0.1))
      );
    }
    attribute.needsUpdate = true;
  });
  // LineSegments2 updates resolution from the active viewport before each draw.
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  if (positions.length === 0) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Three lines; keyboard users inspect the same connections in the inspector.
    <primitive
      object={lines}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (
          !visible ||
          material.opacity < 0.1 ||
          typeof event.faceIndex !== "number"
        )
          return;
        pickConnectionRange(event, event.faceIndex * 2, ranges, onPick, colors);
      }}
      ref={linesRef}
    />
  );
}

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
  { layer: "blocks", token: "amber", opacity: 0.85 },
  { layer: "references", token: "violet", opacity: 0.85 },
] as const satisfies readonly {
  layer: Exclude<Layer, "structure">;
  token: keyof Palette;
  opacity: number;
}[];

const LABEL_CLASS =
  "absolute top-0 left-0 hidden whitespace-nowrap border border-line-strong bg-panel-raised px-1.5 py-0.5 font-mono text-2xs text-phosphor";

/**
 * The building names, in one DOM layer over the canvas. Which of the candidates are
 * drawn is decided in screen space every time the camera or the layout moves.
 * `pickLabels` keeps the best ranked ones that do not land on each other, and drops
 * the rest. District names are not candidates: they are printed on the ground.
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
  graph,
  neighbours,
  focusNeighbours,
  reducedMotion,
}: {
  nodesById: Map<string, SchemaNode>;
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  selected: string | null;
  hovered: string | null;
  graph: SchemaGraph;
  neighbours: Set<string> | null;
  focusNeighbours: Set<string> | null;
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const labelLayer = useRef<HTMLDivElement | null>(null);
  const spans = useRef<HTMLSpanElement[]>([]);
  const charPx = useRef(CHAR_PX);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  // The layer is repainted when the camera has moved or the inputs changed, and
  // skipped otherwise, so a still city costs one matrix comparison a frame.
  const dirty = useRef(true);
  const framedAt = useRef(new THREE.Matrix4());

  const candidates = useMemo(() => {
    const ids = visibleLabelIds({
      hovered,
      selected,
      neighbours,
      hoveredNeighbours: hovered ? neighboursOf(graph, hovered) : null,
      focusNeighbours,
    });

    return labelAnchors(ids, {
      nodesById,
      placementsById,
      heights,
      selected,
      hovered,
    });
  }, [
    hovered,
    selected,
    graph,
    neighbours,
    focusNeighbours,
    nodesById,
    placementsById,
    heights,
  ]);

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
    layer.style.opacity = reducedMotion ? "1" : "0";
    labelLayer.current = layer;
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
      labelLayer.current = null;
      spans.current = [];
    };
  }, [gl, reducedMotion]);

  useFrame((state) => {
    if (labelLayer.current)
      labelLayer.current.style.opacity = String(
        revealAt(state.clock.elapsedTime, reducedMotion).links
      );
    if (!dirty.current && camera.matrixWorld.equals(framedAt.current)) return;
    dirty.current = false;
    framedAt.current.copy(camera.matrixWorld);

    const kept = pickLabels(
      candidates.map((candidate) => {
        anchor.set(candidate.x, candidate.y, candidate.z);
        // How big the building is on screen, which depends on how far away this
        // particular building is.
        const perUnit = pixelsPerUnit(
          size.height,
          camera.position.distanceTo(anchor)
        );
        anchor.project(camera);
        // A point behind the camera projects mirrored onto the screen, so it is
        // moved off it instead, which drops even a pinned name.
        const behind = anchor.z > 1;
        return {
          id: candidate.id,
          text: candidate.text,
          rank: candidate.rank,
          pinned: candidate.rank < 2,
          x: behind ? -1 : (anchor.x * 0.5 + 0.5) * size.width,
          y: (0.5 - anchor.y * 0.5) * size.height - candidate.lift,
          buildingPx: behind ? 0 : candidate.footprint * perUnit,
        };
      }),
      { charPx: charPx.current, width: size.width, height: size.height }
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

/** Thickness of the slab of land an island is, whose top face is y = 0. */
const SLAB_HEIGHT = 0.4;
const RIM_HEIGHT = 0.18;
/** How far the rim stands out past the slab. */
const RIM_OVERHANG = 0.9;
/** Ground around a nested folder's members that its tint covers. */
const FOLDER_PAD = 1;
/** The grid sits under the rim, so the two can never z-fight. */
const GRID_Y = -(SLAB_HEIGHT + RIM_HEIGHT + 0.05);

/**
 * A hint of `toward` in `base`, mixed the way CSS mixes two colours rather than in
 * the linear space three works in. A twelfth of amber is a hint of warmth in one and
 * a brown field in the other, and these colours are picked against the panel colour
 * as the stylesheet writes it.
 */
function tint(base: string, toward: string, amount: number): THREE.Color {
  return new THREE.Color(base)
    .convertLinearToSRGB()
    .lerp(new THREE.Color(toward).convertLinearToSRGB(), amount)
    .convertSRGBToLinear();
}

const WHITE = "#ffffff";

/**
 * Font size a district's name is rasterised at. Its cap height comes out around 72 px,
 * and the stamp is at most four world units tall, so the print carries about
 * 18 px of texture per world unit. The ground needs 2 to stay crisp at the framing zoom, and
 * the rest is what Explore leans on when the camera comes down to street level.
 */
const STAMP_FONT_PX = 100;
/**
 * How heavy the letters are cut. A mono face at its normal weight leaves a stroke
 * about a pixel wide once the whole city is framed, and a stroke that thin at 0.55
 * opacity averages away into the slab under it.
 */
const STAMP_WEIGHT = 600;
/** Silkscreen text is spaced out. Ems of extra gap between two letters. */
const STAMP_TRACKING = "0.32em";
/**
 * How solid the print reads against the island under it. Phosphor-dim at 0.8 comes
 * out around #3f6b60 over the panel colour, which is still darker than any building
 * and half the strength of a road. Lower than this and the letters go, because the
 * whole city framed shrinks a 100 px raster to a 22 px cap and the mipmap averages a
 * thin stroke into the slab.
 */
const STAMP_OPACITY = 0.8;
/**
 * How far the print stands off the slab it is on. Above the slab so the two never
 * z-fight, and under the road ribbons at 0.015, so a road crossing an island's margin
 * runs over the name the way a trace runs over a board's silkscreen.
 */
const STAMP_Y = 0.01;

/** One texture per name and font, kept for the life of the page. */
const stamps = new Map<string, THREE.CanvasTexture>();

/**
 * A district's name rasterised into a texture that is exactly the ink: as wide as the
 * tracked-out name and as tall as its cap height. Sizing the texture to the cap rather
 * than to the font's line box is what lets the caller place the quad by cap height
 * alone, with no per-font fudge for the ascender and descender space around it.
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

/**
 * The land under a district. Structure is the same panel colour the chrome uses,
 * compositions and mixed are a touch lighter and elements a touch warmer, so the
 * islands read as different places without turning into four colours.
 *
 * The panel colour is lifted toward phosphor-dim first. Under the scene's lights the
 * panel colour itself comes out close to black, and a shadow on black does not show,
 * so the buildings would stand on their islands without casting anything.
 */
function slabColour(kind: DistrictKind, palette: Palette): THREE.Color {
  const land = `#${tint(palette.land, palette.dim, SLAB_LIFT).getHexString()}`;
  if (kind === "structure") return new THREE.Color(land);
  if (kind === "elements") return tint(land, palette.amber, 0.09);
  return tint(land, WHITE, 0.07);
}

/** How far the land is lifted from the panel colour toward phosphor-dim. */
const SLAB_LIFT = 0.25;

/** The lip of land around an island, the same for every district and for the focus one. */
function rimColour(palette: Palette): THREE.Color {
  return new THREE.Color(palette.land).lerp(
    new THREE.Color(palette.background),
    0.6
  );
}

/**
 * How high the focus island's top face sits. Above the district slabs at 0 and the
 * names printed on them at 0.01, so neither z-fights it, and under the roads at
 * 0.015, so the focused node's roads still run over the island it stands on.
 *
 * ponytail: that leaves it under the sunk city plates as well, which stand 0.1 up,
 * so the flattened city still reads through the island as ghost footprints. Hiding
 * them means the buildings pass would have to know about the island; sinking the
 * plates under it is the upgrade if that ever reads as debris rather than as a map.
 */
const FOCUS_ISLAND_Y = 0.012;

/**
 * The island under a focused neighbourhood: the slab and rim a district stands on, in
 * the focused node's district colour, over the city the neighbourhood came from.
 *
 * It grows out of the focused node's own ground over the same 400 ms the buildings
 * take to gather around it, and shrinks back into it on the way out, which is why the
 * island it last drew is held after `island` goes null.
 */
function FocusIsland({
  island,
  palette,
  reducedMotion,
}: {
  island:
    | (FocusBounds & { anchor: { x: number; z: number }; kind: DistrictKind })
    | null;
  palette: Palette;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const grown = useRef(island ? 1 : 0);
  const shown = useRef(island);
  if (island) shown.current = island;
  const at = shown.current;

  useFrame((_, delta) => {
    const to = island ? 1 : 0;
    const step = reducedMotion ? 1 : (delta * 1000) / TWEEN_MS;
    grown.current = Math.min(
      1,
      Math.max(0, grown.current + Math.sign(to - grown.current) * step)
    );
    if (!group.current) return;
    group.current.visible = grown.current > 0;
    // A group at the anchor scales about it, so the island opens out of the focused
    // node rather than appearing whole. Never exactly zero: a zero scale has no
    // normal matrix and three warns about it.
    group.current.scale.setScalar(Math.max(smootherstep(grown.current), 1e-4));
  });

  if (!at) return null;
  const width = at.maxX - at.minX;
  const depth = at.maxZ - at.minZ;
  const rim = RIM_OVERHANG * 2;
  return (
    <group position={[at.anchor.x, FOCUS_ISLAND_Y, at.anchor.z]} ref={group}>
      <group
        position={[at.centre.x - at.anchor.x, 0, at.centre.z - at.anchor.z]}
      >
        <mesh position={[0, -SLAB_HEIGHT / 2, 0]} receiveShadow>
          <boxGeometry args={[width, SLAB_HEIGHT, depth]} />
          <meshStandardMaterial
            color={slabColour(at.kind, palette)}
            metalness={0}
            roughness={1}
          />
        </mesh>
        <mesh position={[0, -SLAB_HEIGHT - RIM_HEIGHT / 2, 0]}>
          <boxGeometry args={[width + rim, RIM_HEIGHT, depth + rim]} />
          <meshStandardMaterial
            color={rimColour(palette)}
            metalness={0}
            roughness={1}
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The world stage, borrowed from fsn: a sky and fog that meet at one horizon colour,
 * one ground plane that follows the camera so it never runs out, and an island of land
 * per district. `span` is the city's own, not the focus layout's, so entering focus
 * does not rescale the world, and the islands come from the city layout as well, so
 * the focused neighbourhood stands on whatever island it lands over.
 *
 * District outlines precede the slabs, then the stamped labels join the circuits.
 */
function trackMaterial<T extends THREE.Material>(
  materials: Map<number, T>,
  index: number
) {
  return (material: T | null) => {
    if (material) materials.set(index, material);
    else materials.delete(index);
  };
}

function revealMaterials(materials: Iterable<THREE.Material>, opacity: number) {
  for (const material of materials) material.opacity = opacity;
}

function DistrictBoards({
  districts,
  palette,
  materials,
  reducedMotion,
}: {
  districts: District[];
  reducedMotion: boolean;
  palette: Palette;
  materials: {
    solid: Map<number, THREE.MeshStandardMaterial>;
  };
}) {
  const rim = useMemo(() => rimColour(palette), [palette]);
  const outline = useMemo(
    () =>
      buildBoardOutlinePositions(
        districts.map((district) => ({
          x: district.centre.x,
          y: -SLAB_HEIGHT,
          z: district.centre.z,
          width: district.maxX - district.minX + ISLAND_PAD * 2,
          height: SLAB_HEIGHT,
          depth: district.maxZ - district.minZ + ISLAND_PAD * 2,
        }))
      ),
    [districts]
  );
  return (
    <>
      {districts.map((district, index) => {
        const width = district.maxX - district.minX + ISLAND_PAD * 2;
        const depth = district.maxZ - district.minZ + ISLAND_PAD * 2;
        const overhang = RIM_OVERHANG * 2;
        return (
          <group
            key={district.id}
            position={[district.centre.x, 0, district.centre.z]}
          >
            <mesh
              position={[0, -SLAB_HEIGHT / 2, 0]}
              receiveShadow
              renderOrder={-1}
            >
              <boxGeometry args={[width, SLAB_HEIGHT, depth]} />
              <meshStandardMaterial
                color={slabColour(district.kind, palette)}
                depthWrite
                metalness={0}
                opacity={0}
                ref={trackMaterial(materials.solid, index * 2)}
                roughness={1}
                transparent
              />
            </mesh>
            <mesh
              position={[0, -SLAB_HEIGHT - RIM_HEIGHT / 2, 0]}
              receiveShadow
              renderOrder={-1}
            >
              <boxGeometry
                args={[width + overhang, RIM_HEIGHT, depth + overhang]}
              />
              <meshStandardMaterial
                color={rim}
                depthWrite
                metalness={0}
                opacity={0}
                ref={trackMaterial(materials.solid, index * 2 + 1)}
                roughness={1}
                transparent
              />
            </mesh>
          </group>
        );
      })}
      <IntroOutline
        colour={palette.phosphor}
        positions={outline}
        reducedMotion={reducedMotion}
        strength={0.6}
      />
    </>
  );
}

/** fsn's count. Faint and small, so the sky reads as depth rather than decoration. */
const STAR_COUNT = 700;
/**
 * How far the key light's shadow reaches from the orbit target, as a share of the
 * camera's distance to it. Close in, the map covers less ground and the edges sharpen.
 */
const SHADOW_REACH = 0.9;
/** Texels along each side of the key light's shadow map. */
const SHADOW_MAP = 2048;
/**
 * Where the key light stands relative to what the camera looks at: up to the left of
 * the default view at about 40 degrees, so shadows fall to the right on screen,
 * across open ground, rather than behind the buildings or under them.
 */
const KEY_DIRECTION = new THREE.Vector3(-0.8, 0.9, 0.3).normalize();
/** Stands in for the orbit target in the frame before the controls exist. */
const ORIGIN = new THREE.Vector3();

/**
 * Stars on a unit dome, all above the horizon so none of them ever sits on the
 * ground. fsn scatters them at random; a fixed seed keeps the sky the same on every
 * load.
 */
function starPositions(): Float32Array {
  const positions = new Float32Array(STAR_COUNT * 3);
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let index = 0; index < STAR_COUNT; index++) {
    const theta = random() * Math.PI * 2;
    // Uniform over the cap, stopping about five degrees above the horizon, where the
    // band of light takes over.
    const phi = Math.acos(0.08 + random() * 0.92);
    const radius = 0.9 + random() * 0.08;
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  return positions;
}

/**
 * The world around the city, after fsn: a sky dome and a star field that ride with
 * the camera, fog in the horizon colour, a ground plane re-centred under the camera,
 * and the lights.
 *
 * Every distance here follows the camera's distance to its target through
 * `atmosphere`, so dollying out pushes the horizon back rather than finding an edge,
 * and the far plane is pulled in to where fog has already hidden everything, which
 * keeps the depth buffer's precision on the city.
 *
 * The lights are fsn's: a hemisphere for the ambient, a key light with soft shadows,
 * a cyan rim from behind, and a headlight on the camera so no face the reader can
 * see is ever unlit. The key light and its shadow follow the orbit target.
 */
function World({ palette, span }: { palette: Palette; span: number }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as {
    target: THREE.Vector3;
  } | null;
  const gl = useThree((state) => state.gl);
  const grid = useRef<THREE.Mesh>(null);
  const sky = useRef<THREE.Group>(null);
  const fog = useRef<THREE.Fog>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const head = useRef<THREE.DirectionalLight>(null);
  const reach = useRef(0);
  const stars = useMemo(starPositions, []);
  const colours = useMemo(
    () => ({
      // A teal band where the ground meets the sky, out of the chrome's own dim
      // phosphor, under a zenith darker than the void the panels sit on.
      horizon: tint(palette.background, palette.dim, 0.3),
      zenith: tint(palette.background, "#000000", 0.55),
    }),
    [palette]
  );
  const gridUniforms = useMemo(
    () => ({
      uGround: { value: new THREE.Color(palette.background) },
      // The minor lines are the same phosphor-dim mixed back toward the void, so the
      // grid reads as one thing at two strengths rather than as two colours.
      uMinorColour: {
        value: new THREE.Color(palette.dim).lerp(
          new THREE.Color(palette.background),
          0.5
        ),
      },
      uMajorColour: { value: new THREE.Color(palette.dim) },
      uHorizon: { value: colours.horizon },
      uFogNear: { value: 1 },
      uFogFar: { value: 2 },
    }),
    [palette, colours]
  );
  const skyUniforms = useMemo(
    () => ({
      uZenith: { value: colours.zenith },
      uHorizon: { value: colours.horizon },
    }),
    [colours]
  );

  useFrame(() => {
    const target = controls?.target ?? ORIGIN;
    const distance = camera.position.distanceTo(target);
    const { near, far } = atmosphere(span, distance);
    if (fog.current) {
      fog.current.near = near;
      fog.current.far = far;
    }
    // The material's own uniforms, because the renderer copies the ones it is handed.
    const ground = (grid.current?.material as THREE.ShaderMaterial | undefined)
      ?.uniforms;
    if (ground) {
      ground.uFogNear.value = near;
      ground.uFogFar.value = far;
    }
    // Past the fog's far end everything is the horizon colour, which is what the sky
    // below the horizon already is, so nothing further out needs drawing.
    const cut = far * 1.2;
    if (Math.abs(camera.far - cut) > cut * 0.01) {
      camera.far = cut;
      camera.updateProjectionMatrix();
    }
    // The plane's half width clears the fog's end even along its own axes.
    grid.current?.position.set(camera.position.x, GRID_Y, camera.position.z);
    grid.current?.scale.setScalar(far * 2.2);
    sky.current?.position.copy(camera.position);
    sky.current?.scale.setScalar(far * 1.1);

    const light = key.current;
    if (light) {
      // In steps of a square root of two, so a dolly refits the shadow camera a few
      // times on the way rather than on every frame.
      const wanted = Math.max(12, Math.min(distance * SHADOW_REACH, span));
      const stepped = Math.SQRT2 ** Math.ceil(Math.log2(wanted) * 2);
      if (stepped !== reach.current) {
        reach.current = stepped;
        const shadow = light.shadow.camera;
        shadow.left = -stepped;
        shadow.right = stepped;
        shadow.top = stepped;
        shadow.bottom = -stepped;
        shadow.near = 1;
        shadow.far = stepped * 6 + 60;
        shadow.updateProjectionMatrix();
      }
      // Moving the light in whole shadow texels keeps a pan from making the shadow
      // edges crawl as each one lands on a different row of the map.
      const texel = (stepped * 2) / SHADOW_MAP;
      light.target.position.set(
        Math.round(target.x / texel) * texel,
        0,
        Math.round(target.z / texel) * texel
      );
      light.position
        .copy(light.target.position)
        .addScaledVector(KEY_DIRECTION, stepped * 3 + 30);
      light.target.updateMatrixWorld();
    }
    if (head.current) {
      head.current.position.copy(camera.position);
      head.current.target.position.copy(target);
      head.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <color args={[colours.horizon]} attach="background" />
      {/* Fog, the ground's own fade and the sky below the horizon all end on this one
          colour, or the far ground ends in a ring instead of dissolving. */}
      <fog args={[colours.horizon, 1, 2]} attach="fog" ref={fog} />
      <hemisphereLight args={["#a8e8ff", "#101c1e", 0.7]} />
      <directionalLight
        castShadow
        color="#ffeef0"
        intensity={2.1}
        ref={key}
        shadow-bias={-0.0006}
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
        shadow-normalBias={0.05}
        shadow-radius={3}
      />
      <directionalLight
        color="#6fffe0"
        intensity={0.85}
        position={[-14, 8, -12]}
      />
      <directionalLight color="#cdeee5" intensity={0.55} ref={head} />
      <group ref={sky}>
        <mesh frustumCulled={false} renderOrder={-2}>
          <sphereGeometry args={[1, 32, 16]} />
          <shaderMaterial
            depthTest={false}
            depthWrite={false}
            fragmentShader={SKY_FRAGMENT_SHADER}
            side={THREE.BackSide}
            uniforms={skyUniforms}
            vertexShader={SKY_VERTEX_SHADER}
          />
        </mesh>
        <points frustumCulled={false} renderOrder={-2}>
          <bufferGeometry>
            <bufferAttribute args={[stars, 3]} attach="attributes-position" />
          </bufferGeometry>
          {/* An unattenuated point is sized in buffer pixels, so it is told the
              ratio, or a sharper buffer shrinks the sky to specks. */}
          <pointsMaterial
            color={palette.dim}
            depthWrite={false}
            fog={false}
            opacity={0.6}
            size={1.3 * gl.getPixelRatio()}
            sizeAttenuation={false}
            transparent
          />
        </points>
      </group>
      <mesh
        frustumCulled={false}
        ref={grid}
        renderOrder={-1}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry />
        <shaderMaterial
          depthWrite={false}
          fragmentShader={GRID_FRAGMENT_SHADER}
          uniforms={gridUniforms}
          vertexShader={GRID_VERTEX_SHADER}
        />
      </mesh>
    </>
  );
}

function Stage({
  districts,
  folders,
  span,
  palette,
  reducedMotion,
}: {
  districts: District[];
  /** The ground a nested folder's members cover, for the tint on the island. */
  folders: (CityBounds & { id: string })[];
  span: number;
  palette: Palette;
  reducedMotion: boolean;
}) {
  const folderColour = useMemo(
    () => tint(palette.land, WHITE, 0.15),
    [palette]
  );
  const solidMaterials = useRef(new Map<number, THREE.MeshStandardMaterial>());
  const folderMaterials = useRef(new Map<number, THREE.MeshStandardMaterial>());
  const stampMaterials = useRef(new Map<number, THREE.MeshBasicMaterial>());

  // One rasterised name per district, with the quad it prints on. The name is fixed
  // to its island, so the search for its spot runs once rather than every frame.
  const stampsOf = useMemo(
    () =>
      districts.map((district) => {
        const texture = stampTexture(district.name.toUpperCase(), palette.mono);
        const stamp = districtStamp(
          {
            minX: district.minX - ISLAND_PAD,
            maxX: district.maxX + ISLAND_PAD,
            minZ: district.minZ - ISLAND_PAD,
            maxZ: district.maxZ + ISLAND_PAD,
          },
          texture.image.width / texture.image.height
        );
        return { id: district.id, texture, stamp };
      }),
    [districts, palette.mono]
  );

  useFrame((state) => {
    const progress = revealAt(state.clock.elapsedTime, reducedMotion);
    revealMaterials(solidMaterials.current.values(), progress.districts);
    revealMaterials(folderMaterials.current.values(), progress.districts);
    revealMaterials(
      stampMaterials.current.values(),
      STAMP_OPACITY * progress.links
    );
  });

  return (
    <>
      <World palette={palette} span={span} />
      <DistrictBoards
        districts={districts}
        materials={{
          solid: solidMaterials.current,
        }}
        palette={palette}
        reducedMotion={reducedMotion}
      />
      {/* A nested folder is a lighter rectangle on the island its members stand on,
          which is what says where one block of a district ends and the next starts.
          Like the district boards, it draws before connections so its reveal material
          cannot paint over lines that do not write depth. */}
      {folders.map((folder, index) => (
        <mesh
          key={folder.id}
          position={[
            folder.centre.x,
            FOLDER_TINT_HEIGHT / 2 - SLAB_HEIGHT / 2,
            folder.centre.z,
          ]}
          receiveShadow
          renderOrder={-1}
        >
          <boxGeometry
            args={[
              folder.width,
              SLAB_HEIGHT + FOLDER_TINT_HEIGHT,
              folder.depth,
            ]}
          />
          <meshStandardMaterial
            color={folderColour}
            depthWrite
            metalness={0}
            opacity={0}
            ref={trackMaterial(folderMaterials.current, index)}
            roughness={1}
            transparent
          />
        </mesh>
      ))}
      {/* The district's name printed flat on its island, in the band the layout held
          clear along the quietest of its four edges. It writes no depth, so the
          buildings, the roads and every link stand over it.

          ponytail: the print holds its strength through a selection and through focus
          mode, where the buildings around it fade. Fading it too means telling the
          stage which islands are lit, which is a prop and a set the stage has no other
          use for. ponytail: a nested folder's tint is opaque and stands a hundredth of
          a unit higher, so it would cover a name that reached under it. No folder in
          either fixture reaches into the margin the name is printed in. */}
      {stampsOf.map(({ id, stamp, texture }, index) => (
        <mesh
          key={id}
          position={[stamp.x, STAMP_Y, stamp.z]}
          renderOrder={1}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[stamp.width, stamp.height]} />
          <meshBasicMaterial
            color={palette.dim}
            depthWrite={false}
            map={texture}
            opacity={0}
            ref={trackMaterial(stampMaterials.current, index)}
            transparent
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * The size of the city, in world units: its longer side. The fog, the horizon and
 * the camera's dolly range scale by it, so a schema of ten types and one of three
 * hundred sit in the same world at the same proportions.
 */
function citySpan(bounds: CityBounds): number {
  return Math.max(bounds.width, bounds.depth, 4);
}

type View = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

/** What a framing shows: the ground it has to fit, and the point it centres on. */
type Framed = {
  centre: { x: number; z: number };
  grounds: readonly {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }[];
};

/** The orbit controls, as far as the camera code touches them. */
type Rig = {
  target: THREE.Vector3;
  enabled: boolean;
  maxPolarAngle: number;
};

/** Milliseconds the camera takes to reach a new framing. */
const FLIGHT_MS = 700;
/** Home is a shorter trip: the city is already on screen, only badly aimed. */
const REFRAME_MS = 400;
/**
 * The establishing shot, which lands about as the connections finish drawing. fsn's
 * runs 2.6 seconds over a skyline that rises for longer.
 */
const INTRO_MS = 2400;
/** How much further out the establishing shot opens than it lands, and how far round. */
const INTRO_PULL_BACK = 1.75;
const INTRO_SWING = 0.42;

/** fsn's easing for a flight. */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * The default view looks down the isometric diagonal, from the south-east at about
 * 35 degrees, so the city opens on the overview it always has, now with depth.
 */
const FRAMING_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
/** Screen-right on the ground from that direction. */
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Where the camera stands to frame `bounds` from the default direction: every corner
 * of every piece of ground, at the ground and at the height of the tallest building.
 *
 * `shift` is how many CSS pixels the framed centre moves left on screen, which is
 * half the inspector's width when it is open. The target moves that many pixels'
 * worth of ground along screen-right, measured at the target's own distance, and the
 * framed centre lands in the middle of the canvas the panel does not cover.
 */
function viewOf(
  bounds: Framed,
  size: { width: number; height: number },
  shift: number,
  fill: number,
  buildingHeight: number
): View {
  const corners = bounds.grounds.flatMap((ground) =>
    [ground.minX, ground.maxX].flatMap((x) =>
      [ground.minZ, ground.maxZ].flatMap((z) =>
        [0, buildingHeight].map((y) => ({
          x: x - bounds.centre.x,
          y: y - buildingHeight / 2,
          z: z - bounds.centre.z,
        }))
      )
    )
  );
  const distance = framingDistance(
    corners,
    FRAMING_DIRECTION,
    size,
    shift * 2,
    fill,
    CAMERA_FOV
  );
  const target = new THREE.Vector3(
    bounds.centre.x,
    buildingHeight / 2,
    bounds.centre.z
  ).addScaledVector(SCREEN_RIGHT, shift / pixelsPerUnit(size.height, distance));
  return {
    position: target.clone().addScaledVector(FRAMING_DIRECTION, distance),
    target,
  };
}

/**
 * fsn's opening pose: wider, swung round and looking at the same point, so the
 * establishing shot falls into the framing as the city finishes building.
 */
function introOf(view: View): View {
  const offset = view.position
    .clone()
    .sub(view.target)
    .multiplyScalar(INTRO_PULL_BACK)
    .applyAxisAngle(UP, INTRO_SWING);
  return {
    position: view.target.clone().add(offset),
    target: view.target.clone(),
  };
}

function placeCamera(camera: THREE.Camera, controls: Rig | null, view: View) {
  camera.position.copy(view.position);
  if (controls) controls.target.copy(view.target);
  camera.lookAt(view.target);
}

type CameraFlight = {
  from: View;
  to: View;
  started: number;
  ms: number;
  ease: (t: number) => number;
};

/** Stands in for the orbit target in the frame before the controls exist. */
const LOOSE_TARGET = new THREE.Vector3();

/**
 * Frames the city, and flies to a new framing when focus changes it. The first
 * framing is fsn's establishing shot. A keyboard move translates a flight as it
 * runs; a pointer press or the wheel stops it where it is and hands the camera
 * straight to the controls. A resize is not a new framing, so the view it has is
 * the view it keeps.
 *
 * While a flight runs the controls are switched off. Their update re-derives the
 * camera from its own orbit state and clamps it to the dolly range, which is a tug
 * of war with a flight writing the pose, and the establishing shot opens outside
 * that range on purpose.
 */
function CameraRig({
  bounds,
  buildingHeight,
  inspectorWidth,
  reframe,
  reducedMotion,
  overview,
  flightRef,
}: {
  bounds: Framed;
  buildingHeight: number;
  /** CSS pixels of canvas the inspector covers on the right, 0 when it is closed. */
  inspectorWidth: number;
  /** Bumped by Home to ask for the same city to be framed again. */
  reframe: number;
  reducedMotion: boolean;
  overview: boolean;
  flightRef: RefObject<CameraFlight | null>;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as Rig | null;
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const flight = flightRef;
  const framed = useRef<{
    bounds: Framed;
    controls: unknown;
    reframe: number;
  } | null>(null);

  // Half the panel, because the middle of the uncovered canvas is that far left of
  // the middle of the whole of it.
  const view = useMemo(
    () =>
      viewOf(
        bounds,
        size,
        inspectorWidth / 2,
        overview ? 0.94 : 0.9,
        buildingHeight
      ),
    [bounds, buildingHeight, inspectorWidth, overview, size]
  );

  useEffect(() => {
    // Captured, so it runs before the controls' own listener on the same canvas:
    // handing them the camera first is what lets the press that stops a flight also
    // start an orbit, rather than being spent on stopping the camera.
    const cancel = () => {
      flight.current = null;
      if (controls) controls.enabled = true;
    };
    const options = { capture: true, passive: true };
    gl.domElement.addEventListener("pointerdown", cancel, options);
    gl.domElement.addEventListener("wheel", cancel, options);
    return () => {
      gl.domElement.removeEventListener("pointerdown", cancel, options);
      gl.domElement.removeEventListener("wheel", cancel, options);
    };
  }, [controls, flight, gl]);

  useEffect(() => {
    // This effect runs again every time the viewport is measured, which a resize
    // does a dozen times over, and hover, selection and lens changes all re-render
    // the scene around it. Framing again on any of those puts the camera back where
    // it started, so only a new set of bounds is allowed to move it.
    const first = framed.current === null;
    const asked = !first && framed.current?.reframe !== reframe;
    const action = framingAction(framed.current, { bounds, controls, reframe });
    framed.current = { bounds, controls, reframe };
    if (action === "none") return;
    // The controls arriving mid-establishing-shot need nothing: the flight writes
    // their target every frame and hands them the camera when it lands.
    if (action === "snap" && !first && flight.current) return;
    if (reducedMotion || action === "snap") {
      if (reducedMotion || !first) {
        flight.current = null;
        placeCamera(camera, controls, view);
        return;
      }
      const opening = introOf(view);
      placeCamera(camera, controls, opening);
      flight.current = {
        from: opening,
        to: view,
        started: performance.now(),
        ms: INTRO_MS,
        ease: smootherstep,
      };
      return;
    }
    flight.current = {
      from: {
        position: camera.position.clone(),
        target: (controls?.target ?? view.target).clone(),
      },
      to: view,
      started: performance.now(),
      ms: asked ? REFRAME_MS : FLIGHT_MS,
      ease: asked ? smootherstep : easeInOutCubic,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bounds, controls, reframe, reducedMotion]);

  useFrame(() => {
    const moving = flight.current;
    if (controls) controls.enabled = moving === null;
    if (!moving) return;
    const t = moving.ease(
      Math.min(1, (performance.now() - moving.started) / moving.ms)
    );
    const target = controls?.target ?? LOOSE_TARGET;
    camera.position.lerpVectors(moving.from.position, moving.to.position, t);
    target.lerpVectors(moving.from.target, moving.to.target, t);
    camera.lookAt(target);
    if (t >= 1) flight.current = null;
  });

  return null;
}

/**
 * The polar angle the orbit stops at: just above the ground, so the camera can come
 * down to street level and look along a road without ever going under it.
 */
const MAX_POLAR = Math.PI * 0.49;

/**
 * fsn's orbit controls. Left drag orbits, right drag pans along the ground, and the
 * wheel dollies toward the point under the cursor. Damping gives the camera weight.
 * The dolly range scales with the city, and the horizon moves out with the camera,
 * so no distance in it shows an edge.
 */
function Controls({ span }: { span: number }) {
  return (
    <OrbitControls
      dampingFactor={0.065}
      makeDefault
      maxDistance={span * 6}
      maxPolarAngle={MAX_POLAR}
      minDistance={3}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      screenSpacePanning={false}
      zoomToCursor
    />
  );
}

/**
 * Whether this keystroke is one the city flies by. The app's own handler reads the
 * target the same way: an event that crossed a shadow boundary reports the host as
 * its target, so the path says where it really started, and a field being typed into
 * or anything inside a dialog keeps its letters. A modifier other than Shift means
 * the key belongs to the browser or to the backoffice around us.
 */
/** The tag names whose own keyboard handling wins over the shortcut keys. */
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

function flownBy(event: KeyboardEvent): boolean {
  if (!FLIGHT_CODES.has(event.code)) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const [from] = event.composedPath();
  return !(
    from instanceof HTMLElement &&
    (from.isContentEditable ||
      FIELD.test(from.tagName) ||
      from.closest('[role="dialog"]'))
  );
}

/** Scratch, so flying allocates nothing per frame. */
const FLIGHT_STEP = new THREE.Vector3();
/** How low the camera may fly, in world units above the ground. */
const MIN_EYE = 1;

/**
 * Keyboard flight, after fsn. Held keys become a velocity that eases in and out,
 * which moves the camera and its orbit target together, so the controls pick the
 * pose back up unchanged the moment a hand goes back to the mouse. The arrows turn
 * and tilt by walking the target around a camera that stays put.
 *
 * The speed grows with the distance to the target, so a key crosses about the same
 * share of the screen from the overview as from close in.
 */
function Flight({
  cameraFlight,
}: {
  cameraFlight: RefObject<CameraFlight | null>;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as Rig | null;
  const held = useMemo(() => new Set<string>(), []);
  const boosting = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const turn = useRef({ yaw: 0, pitch: 0 });

  useEffect(() => {
    const release = () => {
      held.clear();
      boosting.current = false;
    };
    const down = (event: KeyboardEvent) => {
      boosting.current = event.shiftKey;
      if (!flownBy(event)) {
        // While a command key is down macOS withholds the keyup of everything else,
        // so a key let go inside a shortcut would fly on forever. The same goes for
        // a field or a dialog taking the keyboard mid-flight: stop rather than coast.
        release();
        return;
      }
      // Without this the arrows scroll the backoffice around the city.
      event.preventDefault();
      held.add(event.code);
    };
    const up = (event: KeyboardEvent) => {
      boosting.current = event.shiftKey;
      // Anything released during a Cmd or Ctrl chord reported no keyup of its own,
      // so the modifier's own release is the first moment the set can be trusted.
      if (event.key === "Meta" || event.key === "Control") release();
      else held.delete(event.code);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      release();
    };
  }, [held]);

  useFrame((_, delta) => {
    if (!controls) return;
    const moving = velocity.current;
    const turning = turn.current;
    if (
      held.size === 0 &&
      moving.lengthSq() === 0 &&
      turning.yaw === 0 &&
      turning.pitch === 0
    )
      return;
    // A tab that was in the background hands back one enormous delta, which would
    // teleport the camera as far as the whole time it was away.
    const step = Math.min(delta, 0.05);
    const boost = boosting.current ? BOOST : 1;

    const rates = turnRates(held);
    // Under a thousandth of a radian a second is a stop.
    const settle = (value: number) => (Math.abs(value) < 1e-3 ? 0 : value);
    turning.yaw = settle(
      approach(turning.yaw, rates.yaw * TURN_SPEED * boost, step)
    );
    turning.pitch = settle(
      approach(turning.pitch, rates.pitch * TURN_SPEED * boost, step)
    );
    if (turning.yaw !== 0 || turning.pitch !== 0) {
      // A turn aims the camera itself, so it takes over from a framing flight.
      cameraFlight.current = null;
      const turned = turnedOffset(
        FLIGHT_STEP.subVectors(camera.position, controls.target),
        turning.yaw * step,
        turning.pitch * step,
        controls.maxPolarAngle
      );
      const aim = groundedTarget(camera.position, {
        x: camera.position.x - turned.x,
        y: camera.position.y - turned.y,
        z: camera.position.z - turned.z,
      });
      controls.target.set(aim.x, aim.y, aim.z);
      camera.lookAt(controls.target);
    }

    const wanted = desiredVelocity(
      held,
      groundAxes(camera.position, controls.target),
      flySpeed(camera.position.distanceTo(controls.target)) * boost
    );
    moving.set(
      approach(moving.x, wanted.x, step),
      approach(moving.y, wanted.y, step),
      approach(moving.z, wanted.z, step)
    );
    // A hundredth of a world unit a second is a stop, and rounding it to one keeps
    // the frame from doing this work on every idle frame for ever.
    if (moving.lengthSq() < 1e-4) {
      moving.set(0, 0, 0);
      return;
    }
    FLIGHT_STEP.copy(moving).multiplyScalar(step);
    // Neither the camera nor the point it orbits goes under the ground.
    FLIGHT_STEP.y = Math.max(
      FLIGHT_STEP.y,
      Math.min(0, MIN_EYE - camera.position.y),
      Math.min(0, -controls.target.y)
    );
    // Keep a framing flight's endpoints in the same translated frame as the camera,
    // so a held key moves the view during the flight without the interpolation
    // snapping back on the next frame.
    if (cameraFlight.current) {
      translateFlightEndpoints(cameraFlight.current, FLIGHT_STEP);
    }
    camera.position.add(FLIGHT_STEP);
    controls.target.add(FLIGHT_STEP);
  });

  return null;
}

function ComparisonMarks({
  comparison,
  placements,
  palette,
}: {
  comparison?: SchemaComparison | null;
  placements: Placement[];
  palette: Palette;
}) {
  const marks = useMemo(
    () =>
      new Map(
        (comparison ? [...comparison.added, ...comparison.changed] : []).map(
          (change) => [change.currentId, change.status]
        )
      ),
    [comparison]
  );
  return (
    <group>
      {placements
        .filter((at) => marks.has(at.id) && (at.flatten ?? 0) < 0.5)
        .map((at) => (
          <mesh
            key={at.id}
            position={[at.position.x, (at.y ?? 0) + 0.08, at.position.z]}
            rotation={[-Math.PI / 2, 0, Math.PI / 4]}
          >
            <ringGeometry
              args={[
                at.footprint / Math.SQRT2 + 0.45,
                at.footprint / Math.SQRT2 + 0.7,
                4,
              ]}
            />
            <meshBasicMaterial
              color={
                marks.get(at.id) === "added" ? palette.azure : palette.amber
              }
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
    </group>
  );
}

/** Milliseconds a building takes to move between its city spot and its focus spot. */
const TWEEN_MS = 400;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export default function Scene({
  graph,
  baseline,
  comparison,
  focusDepth = 1,
  scale,
  selected,
  focus,
  layers,
  icons,
  inspectorWidth = 0,
  reframe = 0,
  onSelect,
  onFocus,
}: {
  graph: SchemaGraph;
  baseline?: SchemaGraph | null;
  comparison?: SchemaComparison | null;
  focusDepth?: number;
  /** Umbraco icon name to SVG, for the roofs. The harness usually passes none. */
  icons?: Record<string, string>;
  /** The lens colouring App computed. Absent or null means no lens is on. */
  scale?: LensScale | null;
  selected: string | null;
  focus: string | null;
  layers: readonly Layer[];
  /**
   * CSS pixels of the canvas the inspector covers on the right, 0 when it is closed.
   * Every framing flight aims at the middle of what it leaves rather than at the
   * middle of the canvas, so a focused neighbourhood is not half behind the panel.
   */
  inspectorWidth?: number;
  /**
   * Bumped to frame the whole city again. It is a count rather than a flag because
   * the camera has to answer Home a second time from wherever the reader took it.
   */
  reframe?: number;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const cameraFlight = useRef<CameraFlight | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [bootPhase, setBootPhase] = useState<BootPhase>(
    reducedMotion ? "done" : "trace"
  );
  const [connectionPick, setConnectionPick] = useState<ConnectionPick | null>(
    null
  );
  const city = useMemo(
    () =>
      baseline && comparison
        ? comparisonCity(baseline, graph, comparison.matches)
        : cityDistricts(graph),
    [baseline, comparison, graph]
  );
  // The ground a nested folder's members cover, which tints that patch of its island.
  // The city layout, not what is on screen, so the islands hold still through a focus.
  const folderTints = useMemo(() => {
    const members = new Map<string, Placement[]>();
    for (const placement of city.placements) {
      if (!placement.folder) continue;
      const held = members.get(placement.folder);
      if (held) held.push(placement);
      else members.set(placement.folder, [placement]);
    }
    return [...members].map(([id, held]) => ({
      id,
      ...cityBounds(held, FOLDER_PAD),
    }));
  }, [city]);
  const neighbourhoodById = useMemo(() => neighbourhoods(graph), [graph]);
  const focusNeighbours = useMemo(
    () => (focus ? reachableWithin(graph, focus, focusDepth) : null),
    [graph, focus, focusDepth]
  );
  const focusLayout = useMemo(() => {
    const neighbourhood = focus ? neighbourhoodById.get(focus) : undefined;
    if (!(focus && neighbourhood)) return null;
    let laid = layoutFocus(graph, neighbourhood, focus, city.placements);
    const directIds = reachableWithin(graph, focus, 1);
    for (let depth = 2; depth <= focusDepth; depth++)
      laid = expandFocusLayout(
        city.placements,
        laid,
        directIds,
        reachableWithin(graph, focus, depth)
      );
    // The layout keeps the neighbourhood around the origin, so the anchor is what
    // stands it back on the focused node's own ground: that node holds still and
    // everything it is joined to gathers around it.
    const anchor = focusAnchor(city.placements, focus);
    const inFocus = focusNeighbours ?? new Set<string>();
    const moved: Placement[] = [];
    // Everything the focused node has nothing to do with becomes ground: the
    // neighbourhood is laid out over the city it came from, and a city still standing
    // at full height under it reads as two layouts on top of each other. A placement
    // the layout returned unchanged is one it did not place.
    const placements = laid.map((placement, index) => {
      if (placement === city.placements[index]) {
        return inFocus.has(placement.id)
          ? placement
          : { ...placement, flatten: 1 };
      }
      const at = {
        ...placement,
        position: {
          x: placement.position.x + anchor.x,
          z: placement.position.z + anchor.z,
        },
      };
      moved.push(at);
      return at;
    });
    const kind = city.placements.find(
      (placement) => placement.id === focus
    )?.districtKind;
    return { anchor, kind: kind ?? "mixed", moved, placements };
  }, [focus, focusDepth, focusNeighbours, graph, neighbourhoodById, city]);
  const target = focusLayout?.placements ?? city.placements;
  // The ground the neighbourhood covers, which the island is drawn on and the camera
  // frames. The moved placements only: the flattened city around them is not part of
  // what focus mode is about.
  const focusIsland = useMemo(
    () =>
      focusLayout && {
        ...focusBounds(focusLayout.moved),
        anchor: focusLayout.anchor,
        kind: focusLayout.kind,
      },
    [focusLayout]
  );

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
    const from = new Map(
      shown.current.map((placement) => [placement.id, placement])
    );
    const started = performance.now();
    let frame = requestAnimationFrame(function step() {
      const t = smootherstep((performance.now() - started) / TWEEN_MS);
      const mixed =
        t >= 1
          ? target
          : target.map((to) => {
              const at = from.get(to.id);
              // Nothing to tween when the placement is the same object and neither
              // end is flattened, which is most of the city on the way in.
              if (!at || (at === to && (at.flatten ?? 0) === (to.flatten ?? 0)))
                return to;
              return {
                ...to,
                position: {
                  x: lerp(at.position.x, to.position.x, t),
                  z: lerp(at.position.z, to.position.z, t),
                },
                y: lerp(at.y ?? 0, to.y ?? 0, t),
                flatten: lerp(at.flatten ?? 0, to.flatten ?? 0, t),
              };
            });
      shown.current = mixed;
      setPlacements(mixed);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, reducedMotion]);

  // Every island, with the ground each one carries around its buildings.
  const ground = useMemo(() => {
    if (city.districts.length === 0)
      return cityBounds(city.placements, ISLAND_PAD);
    const minX = Math.min(...city.districts.map((d) => d.minX)) - ISLAND_PAD;
    const maxX = Math.max(...city.districts.map((d) => d.maxX)) + ISLAND_PAD;
    const minZ = Math.min(...city.districts.map((d) => d.minZ)) - ISLAND_PAD;
    const maxZ = Math.max(...city.districts.map((d) => d.maxZ)) + ISLAND_PAD;
    return {
      width: maxX - minX,
      depth: maxZ - minZ,
      centre: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    };
  }, [city]);
  // The stage is scaled by the city's own span, whatever the focus layout does, so
  // entering focus never rescales the world around it.
  const span = citySpan(ground);
  // The camera frames every island rather than the rectangle around them all, which
  // leaves out the empty corners of a city that is not itself a rectangle. In focus
  // it frames the focus layout instead, the focused node and everything moved around
  // it, not the whole city behind them.
  const bounds = useMemo((): Framed => {
    if (focusIsland)
      return { centre: focusIsland.centre, grounds: [focusIsland] };
    const grounds =
      city.districts.length > 0
        ? city.districts.map((district) => ({
            minX: district.minX - ISLAND_PAD,
            maxX: district.maxX + ISLAND_PAD,
            minZ: district.minZ - ISLAND_PAD,
            maxZ: district.maxZ + ISLAND_PAD,
          }))
        : [
            {
              minX: ground.centre.x - ground.width / 2,
              maxX: ground.centre.x + ground.width / 2,
              minZ: ground.centre.z - ground.depth / 2,
              maxZ: ground.centre.z + ground.depth / 2,
            },
          ];
    return { centre: ground.centre, grounds };
  }, [city, focusIsland, ground]);
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph]
  );
  const placementsById = useMemo(
    () => new Map(placements.map((p) => [p.id, p])),
    [placements]
  );
  const selectionNeighbours = useMemo(
    () => (selected ? neighboursOf(graph, selected) : null),
    [graph, selected]
  );
  // In focus mode the lit set is the focused node's, so clicking through the
  // neighbourhood does not dim the layout you are standing in.
  const neighbours = focusNeighbours ?? selectionNeighbours;
  const { cellsByKind, windows, heights } = useMemo(() => {
    const built = buildFloorCells(nodesById, placements);
    return {
      cellsByKind: groupByKind(built.cells),
      windows: built.windows,
      heights: built.heights,
    };
  }, [nodesById, placements]);
  const plazas = useMemo(
    () => buildPlazaCells(nodesById, placements),
    [nodesById, placements]
  );
  const iconGroups = useIconGroups(icons, nodesById, palette?.phosphor ?? "");

  // Keep the overview graph stable; interaction changes its emphasis, not its routes.
  const drawnEdges = useMemo(
    () => visibleConnections(graph.edges ?? [], focusNeighbours),
    [graph.edges, focusNeighbours]
  );
  const active = useMemo(() => new Set<Layer>(layers), [layers]);
  const interactionActive = selected !== null || hovered !== null;
  const pickConnection: PickConnection = (pick) => setConnectionPick(pick);
  // A link leaves from the roof of the building it belongs to, so it stays visible
  // over a tall neighbour and moves with the focus tween.
  const anchors = useMemo(() => {
    const map = new Map<string, Anchor>();
    for (const placement of placements) {
      map.set(placement.id, {
        x: placement.position.x,
        y:
          (placement.y ?? 0) +
          (heights.get(placement.id) ?? placement.height) * 0.8,
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
      land: token("--panel"),
      mono: token("--font-mono") || "ui-monospace, monospace",
      phosphor: token("--phosphor"),
      separator: token("--panel-sunken"),
      signal: token("--signal"),
      violet: token("--violet"),
    });
  }, []);

  return (
    <div className="absolute inset-0" ref={host}>
      {palette ? (
        <Canvas
          // The far plane is the world's to set, from where the fog ends.
          camera={{ fov: CAMERA_FOV, near: 0.5, far: 1000 }}
          // A click on paving or on the void is a click on nothing, which is how the
          // city goes back the way it was without hunting for a close button.
          onPointerMissed={() => {
            setConnectionPick(null);
            onSelect(null);
          }}
          shadows="percentage"
        >
          <BootProgress onPhase={setBootPhase} reducedMotion={reducedMotion} />
          <Stage
            districts={city.districts}
            folders={folderTints}
            palette={palette}
            reducedMotion={reducedMotion}
            span={span}
          />
          <FocusIsland
            island={focusIsland}
            palette={palette}
            reducedMotion={reducedMotion}
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
            scale={scale ?? null}
            selected={selected}
            windows={windows}
          />
          <BuildingOutlines
            cellsByKind={cellsByKind}
            palette={palette}
            reducedMotion={reducedMotion}
          />
          {iconGroups.length > 0 ? (
            <RoofIcons
              groups={iconGroups}
              heights={heights}
              hovered={hovered}
              neighbours={neighbours}
              palette={palette}
              placementsById={placementsById}
              reducedMotion={reducedMotion}
              selected={selected}
            />
          ) : null}
          <Roads
            boot={bootPhase}
            edges={drawnEdges}
            enabled={active.has("structure")}
            focus={focus}
            hovered={hovered}
            onPick={pickConnection}
            palette={palette}
            placementsById={placementsById}
            reducedMotion={reducedMotion}
            selected={selected}
            visible={active.has("structure") || interactionActive}
          />
          {LINK_LAYERS.map(({ layer, token, opacity }) => (
            <Links
              anchors={anchors}
              boot={bootPhase}
              colour={palette[token]}
              edges={drawnEdges}
              enabled={active.has(layer)}
              focused={focus !== null}
              hovered={hovered}
              key={layer}
              layer={layer}
              onPick={pickConnection}
              opacity={opacity}
              placementsById={placementsById}
              reducedMotion={reducedMotion}
              selected={selected}
              visible={active.has(layer) || interactionActive}
            />
          ))}
          {connectionPick ? (
            <Html
              center
              position={connectionPick.position}
              zIndexRange={[20, 10]}
            >
              <div
                className="w-72 border border-line bg-panel p-3 text-xs text-phosphor shadow-panel"
                role="status"
              >
                <button
                  aria-label="Close connection details"
                  className="float-right px-1 text-phosphor-bright"
                  onClick={() => setConnectionPick(null)}
                  type="button"
                >
                  ×
                </button>
                {connectionPick.edges.slice(0, 5).map((edge) => (
                  <p
                    className="mb-1"
                    key={`${edge.kind}|${edge.from}|${edge.to}|${edge.propertyAlias ?? ""}|${edge.role ?? ""}`}
                  >
                    {
                      describeRelationship(
                        edge,
                        nodesById,
                        selected ?? edge.from
                      ).detail
                    }
                  </p>
                ))}
                {connectionPick.edges.length > 5 ? (
                  <p>
                    {connectionPick.edges.length - 5} more shared relationships
                    · see inspector
                  </p>
                ) : null}
              </div>
            </Html>
          ) : null}
          <ComparisonMarks
            comparison={comparison}
            palette={palette}
            placements={placements}
          />
          <Labels
            focusNeighbours={focusNeighbours}
            graph={graph}
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            nodesById={nodesById}
            placementsById={placementsById}
            reducedMotion={reducedMotion}
            selected={selected}
          />
          <Flight cameraFlight={cameraFlight} />
          <CameraRig
            bounds={bounds}
            buildingHeight={Math.max(1, ...heights.values())}
            flightRef={cameraFlight}
            inspectorWidth={inspectorWidth}
            overview={focus === null}
            reducedMotion={reducedMotion}
            reframe={reframe}
          />
          <Controls span={span} />
        </Canvas>
      ) : null}
    </div>
  );
}
