import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { neighbourhoods } from "../model/neighbourhood";
import type { SchemaEdge, SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import {
  cityBounds,
  cityDistricts,
  ISLAND_PAD,
  type CityBounds,
  type District,
  type DistrictKind,
  type Placement,
} from "./layout/city";
import { layoutFocus } from "./layout/focus";
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
import { neighboursOf } from "./scene/graph-links";
import { iconColour, rasteriseIcon } from "./scene/icons";
import { CHAR_PX, LABEL_CAP, LABEL_HEIGHT_PX, pickLabels } from "./scene/labels";
import { type LensScale, type Ramp, usageBadge } from "./scene/lens";
import { type Anchor, buildLinkGeometry, type Layer } from "./scene/layers";
import {
  approach,
  BOOST,
  desiredVelocity,
  FLIGHT_CODES,
  FLY_SPEED,
  groundAxes,
  panSpeed,
  TURN_SPEED,
  turnedOffset,
  turnRates,
} from "./scene/flight";
import { buildRoadGeometry, roadFan } from "./scene/roads";
import {
  fogRange,
  framingAction,
  GRID_FRAGMENT_SHADER,
  GRID_VERTEX_SHADER,
  districtStamp,
  pixelsPerUnit,
  stageMetrics,
  zoomRange,
} from "./scene/stage";

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

/** Seconds a building takes to rise, once its own `introDelay` has passed. */
const INTRO_DURATION = 0.46;
const PLAZA_HEIGHT = 0.05;
const HOVER_BRIGHTEN = 1.4;
/** How far a faded building's colour moves toward the void, approximating 20% opacity. */
const FADE_MIX = 0.8;
/** The same, for a building focus mode has pressed flat: about 12% opacity. */
const PLATE_MIX = 0.88;

/**
 * Where one building lands on the lens's ramp. Amber to azure both ways, with
 * phosphor-dim as the diverging middle and the unused lens's quiet end, because
 * phosphor against signal is the pair colour-vision deficiency ruins.
 */
function rampColour(
  ramp: Ramp,
  t: number,
  colors: { amber: THREE.Color; azure: THREE.Color; dim: THREE.Color; signal: THREE.Color },
): THREE.Color {
  if (ramp === "binary") return t >= 0.5 ? colors.signal.clone() : colors.dim.clone();
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
  const scratch = useMemo(() => new THREE.Object3D(), []);
  // Windows are the only thing here that is turned, and a shared scratch object
  // would leave that rotation on the next floor box written through it.
  const turned = useMemo(() => new THREE.Object3D(), []);
  const introDone = useRef(reducedMotion);

  const meshRefs = useMemo(
    () => ({ own: ownRef, composed: composedRef, separator: separatorRef, element: elementRef }),
    [],
  );
  const introDelayById = useMemo(
    () => new Map(placements.map((p) => [p.id, p.introDelay])),
    [placements],
  );
  const flatById = useMemo(
    () => new Map(placements.map((p) => [p.id, p.flatten ?? 0])),
    [placements],
  );
  const districtById = useMemo(
    () => new Map(placements.map((p) => [p.id, p.districtKind])),
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

  function applyCell(mesh: THREE.InstancedMesh, index: number, cell: FloorCell, progress: number) {
    scratch.position.set(cell.cx, cell.cy * progress, cell.cz);
    scratch.scale.set(cell.sx, Math.max(cell.sy * progress, 0.0001), cell.sz);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }

  /** A window rises with the floor it is cut into, on the same progress. */
  function applyWindow(mesh: THREE.InstancedMesh, index: number, cell: WindowCell, progress: number) {
    turned.position.set(cell.cx, cell.cy * progress, cell.cz);
    turned.rotation.set(0, cell.rotY, 0);
    turned.scale.set(WINDOW_WIDTH, Math.max(WINDOW_HEIGHT * progress, 0.0001), 1);
    turned.updateMatrix();
    mesh.setMatrixAt(index, turned.matrix);
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

    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) => applyWindow(window, i, cell, startProgress));
      window.instanceMatrix.needsUpdate = true;
      window.computeBoundingSphere();
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
        // A building pressed flat is out of the conversation, so it stops taking the
        // pointer as well: a zero-sized box is one the raycaster cannot hit.
        const pickable = (placement.flatten ?? 0) < 0.999;
        scratch.position.set(
          placement.position.x,
          (placement.y ?? 0) + height / 2,
          placement.position.z,
        );
        scratch.scale.set(
          pickable ? placement.footprint : 0,
          pickable ? height : 0,
          pickable ? placement.footprint : 0,
        );
        scratch.updateMatrix();
        hit.setMatrixAt(i, scratch.matrix);
      });
      hit.instanceMatrix.needsUpdate = true;
      hit.computeBoundingSphere();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsByKind, windows, plazas, placements, heights, reducedMotion]);

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
    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) =>
        applyWindow(
          window,
          i,
          cell,
          smootherstep((elapsed - (introDelayById.get(cell.buildingId) ?? 0)) / INTRO_DURATION),
        ),
      );
      window.instanceMatrix.needsUpdate = true;
    }
    if (elapsed >= introEnd) introDone.current = true;
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
      return t === undefined || !scale ? null : rampColour(scale.ramp, t, colors);
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
          : lensColour(buildingId) ?? unlit;
      const bright = buildingId === hovered ? base.clone().multiplyScalar(HOVER_BRIGHTEN) : base;
      return lit(buildingId) ? bright : bright.clone().lerp(colors.fade, fadeOf(buildingId));
    };

    for (const kind of Object.keys(meshRefs) as (keyof typeof meshRefs)[]) {
      const mesh = meshRefs[kind].current;
      if (!mesh) continue;
      cellsByKind[kind].forEach((cell, i) => mesh.setColorAt(i, colourFor(cell.kind, cell.buildingId)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // A window is the floor's own colour turned up, so it carries the lens, the
    // selection and the fade without a second set of rules. Mandatory properties
    // are turned up further, which is the one thing the wall does not already say.
    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) =>
        window.setColorAt(
          i,
          colourFor(cell.kind, cell.buildingId)
            .clone()
            .multiplyScalar(cell.mandatory ? 1.9 : 1.45),
        ),
      );
      if (window.instanceColor) window.instanceColor.needsUpdate = true;
    }

    const plaza = plazaRef.current;
    if (plaza) {
      plazas.forEach((cell, i) => {
        const base = cell.buildingId === selected ? colors.signal : colors.plaza;
        const bright = cell.buildingId === hovered ? base.clone().multiplyScalar(HOVER_BRIGHTEN) : base;
        plaza.setColorAt(
          i,
          lit(cell.buildingId) ? bright : bright.clone().lerp(colors.fade, fadeOf(cell.buildingId)),
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
      {windows.length > 0 && (
        <instancedMesh args={[undefined, undefined, windows.length]} ref={windowRef}>
          <planeGeometry />
          <meshBasicMaterial toneMapped={false} />
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
type IconGroup = { key: string; texture: THREE.Texture; ids: string[]; offset: number };

/**
 * The icons, rasterised once per name and colour and kept until the graph changes.
 * The map is empty until they have decoded, which is a frame or two after the city
 * paints, and a type whose icon the host did not hand over is simply not in it.
 */
function useIconGroups(
  icons: Record<string, string> | undefined,
  nodesById: Map<string, SchemaNode>,
  phosphor: string,
): IconGroup[] {
  const wanted = useMemo(() => {
    const byKey = new Map<string, { svg: string; colour: string; ids: string[] }>();
    // The palette arrives one render in, and rasterising against a colour that is
    // not the theme's yet would do every icon twice.
    if (!icons || !phosphor) return byKey;
    // Sorted, so the draw order of the icon meshes is the same city to city.
    for (const node of [...nodesById.values()].sort((a, b) => a.alias.localeCompare(b.alias))) {
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
      }),
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
 * label and the usage badge of the very building it names. One instanced mesh per
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
}: {
  groups: IconGroup[];
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  neighbours: Set<string> | null;
  selected: string | null;
  hovered: string | null;
  palette: Palette;
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
      group.ids.forEach((id, index) =>
        mesh.setColorAt(index, neighbours === null || neighbours.has(id) ? lit : faded),
      );
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [groups, neighbours, palette]);

  useFrame(() => {
    const plate = capRef.current;
    for (const group of groups) {
      const mesh = meshes.current.get(group.key);
      if (!mesh) continue;
      group.ids.forEach((id, index) => {
        const placement = placementsById.get(id);
        const side = (placement?.footprint ?? 0) * ICON_FOOTPRINT;
        const roof = placement
          ? (placement.y ?? 0) + (heights.get(id) ?? placement.height)
          : 0;
        if (placement) anchor.set(placement.position.x, roof, placement.position.z);
        const px = placement
          ? placement.footprint *
            pixelsPerUnit(
              camera as THREE.OrthographicCamera & { fov?: number },
              size.height,
              camera.position.distanceTo(anchor),
            )
          : 0;
        const shown = placement !== undefined && (px >= ICON_MIN_PX || id === selected || id === hovered);

        scratch.position.set(anchor.x, roof + 0.03, anchor.z);
        scratch.rotation.set(-Math.PI / 2, 0, 0);
        scratch.scale.setScalar(shown ? side : 0);
        scratch.updateMatrix();
        mesh.setMatrixAt(index, scratch.matrix);

        if (!plate) return;
        cap.position.set(placement?.position.x ?? 0, roof + 0.02, placement?.position.z ?? 0);
        cap.rotation.set(-Math.PI / 2, 0, 0);
        cap.scale.setScalar(shown ? (placement?.footprint ?? 0) * CAP_FOOTPRINT : 0);
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
        <instancedMesh args={[undefined, undefined, caps]} frustumCulled={false} ref={capRef}>
          <planeGeometry />
          <meshBasicMaterial
            color={palette.background}
            depthWrite={false}
            opacity={0.55}
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
            side={THREE.DoubleSide}
            transparent
          />
        </instancedMesh>
      ))}
    </>
  );
}

/**
 * One colour per vertex, so selecting a node fades every edge it does not touch
 * without the geometry being rebuilt. In focus mode nothing is faded, because
 * every edge drawn there already belongs to the focused node.
 */
function fadeColors(
  ranges: readonly { edges: SchemaEdge[]; start: number; count: number }[],
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
      range.edges.some((edge) => edge.from === selected || edge.to === selected);
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
  placementsById,
  colour,
  opacity,
  palette,
  selected,
  focus,
}: {
  layer: Exclude<Layer, "structure">;
  edges: SchemaEdge[];
  anchors: Map<string, Anchor>;
  placementsById: Map<string, Placement>;
  colour: string;
  opacity: number;
  palette: Palette;
  selected: string | null;
  focus: string | null;
}) {
  const { positions, ranges } = useMemo(
    () => buildLinkGeometry(layer, edges, anchors, placementsById),
    [layer, edges, anchors, placementsById],
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
/** A cut fan's count sorts last of all, so it only takes pixels nothing else wants. */
const FAN_MARKER_RANK = 4;

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
  neighbours,
  focusNeighbours,
  badge,
  fanMarkers,
}: {
  nodesById: Map<string, SchemaNode>;
  placementsById: Map<string, Placement>;
  heights: Map<string, number>;
  selected: string | null;
  hovered: string | null;
  neighbours: Set<string> | null;
  focusNeighbours: Set<string> | null;
  /** The selected building's usage line, drawn as a second label over its name. */
  badge: string | null;
  /** Buildings whose road fan is cut, and how many roads are not drawn. */
  fanMarkers: { id: string; hidden: number }[];
}) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera & {
    fov?: number;
  };
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
      /** Pixels to raise the box by after projection, so it clears the name below it. */
      lift: number;
    }[] = [];
    for (const id of ids) {
      const node = nodesById.get(id);
      const placement = placementsById.get(id);
      if (!node || !placement) continue;
      const anchorY = (placement.y ?? 0) + (heights.get(id) ?? placement.height) + LABEL_LIFT;
      built.push({
        id,
        text: node.name,
        rank: id === selected ? 0 : id === hovered ? 1 : 2,
        footprint: placement.footprint,
        x: placement.position.x,
        y: anchorY,
        z: placement.position.z,
        lift: 0,
      });
      // The usage badge is one more label on the same layer, sitting exactly one
      // box above the name. Lifting it in pixels rather than world units keeps the
      // two apart at any zoom, which a fixed height over the roof would not.
      if (id === selected && badge) {
        built.push({
          id: `${id}:usage`,
          text: badge,
          rank: 0,
          footprint: placement.footprint,
          x: placement.position.x,
          y: anchorY,
          z: placement.position.z,
          lift: LABEL_HEIGHT_PX + 4,
        });
      }
    }
    // The count of the roads a fan cut, over the roof they would land on. It is the
    // last thing that gets pixels, so a screen full of names never loses one to it.
    for (const marker of fanMarkers) {
      const placement = placementsById.get(marker.id);
      if (!placement || ids.has(marker.id)) continue;
      built.push({
        id: `${marker.id}:parents`,
        text: `+${marker.hidden} parents`,
        rank: FAN_MARKER_RANK,
        footprint: placement.footprint,
        x: placement.position.x,
        y: (placement.y ?? 0) + (heights.get(marker.id) ?? placement.height) + LABEL_LIFT,
        z: placement.position.z,
        lift: 0,
      });
    }
    return built;
  }, [
    fanMarkers,
    hovered,
    selected,
    neighbours,
    focusNeighbours,
    nodesById,
    placementsById,
    heights,
    badge,
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
        anchor.set(candidate.x, candidate.y, candidate.z);
        // How big the building is on screen, through whichever camera is on: the
        // orthographic zoom is its pixels per world unit, and the Explore camera's
        // answer depends on how far away this particular building is.
        const perUnit = pixelsPerUnit(camera, size.height, camera.position.distanceTo(anchor));
        anchor.project(camera);
        return {
          id: candidate.id,
          text: candidate.text,
          rank: candidate.rank,
          pinned: candidate.rank < 2,
          x: (anchor.x * 0.5 + 0.5) * size.width,
          y: (0.5 - anchor.y * 0.5) * size.height - candidate.lift,
          buildingPx: anchor.z > 1 ? 0 : candidate.footprint * perUnit,
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

/** Thickness of the slab of land an island is, whose top face is y = 0. */
const SLAB_HEIGHT = 0.4;
const RIM_HEIGHT = 0.18;
/** How far the rim stands out past the slab. */
const RIM_OVERHANG = 0.9;
/** Ground around a nested folder's members that its tint covers. */
const FOLDER_PAD = 1;
/** How far the tint under a nested folder stands proud of the island. */
const FOLDER_TINT_HEIGHT = 0.02;
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
 * and the stamp is at most 3 world units tall, so the print carries about 24 px of
 * texture per world unit. The ground needs 2 to stay crisp at the framing zoom, and
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
 * whole city framed shrinks a 100 px raster to a 17 px cap and the mipmap averages a
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
 */
function slabColour(kind: DistrictKind, palette: Palette): THREE.Color {
  if (kind === "structure") return new THREE.Color(palette.land);
  if (kind === "elements") return tint(palette.land, palette.amber, 0.09);
  return tint(palette.land, WHITE, 0.07);
}

/**
 * The world stage, borrowed from fsn: a void-coloured background and fog, one grid
 * plane that follows the camera so the ground never runs out, and an island of land
 * per district. `span` is the city's own, not the focus layout's, so entering focus
 * does not rescale the world, and the islands come from the city layout as well, so
 * the focused neighbourhood stands on whatever island it lands over.
 *
 * Three draw calls per district, the name printed on it included, plus one per nested
 * folder. Nothing here animates.
 */
function Stage({
  districts,
  folders,
  span,
  palette,
}: {
  districts: District[];
  /** The ground a nested folder's members cover, for the tint on the island. */
  folders: (CityBounds & { id: string })[];
  span: number;
  palette: Palette;
}) {
  const camera = useThree((state) => state.camera);
  const grid = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const screenCentre = useMemo(() => new THREE.Vector2(0, 0), []);
  const centre = useMemo(() => new THREE.Vector3(), []);
  const { fadeNear, fadeFar, plane } = stageMetrics(span);
  const fog = fogRange(span);
  const rimColour = useMemo(
    () => new THREE.Color(palette.land).lerp(new THREE.Color(palette.background), 0.6),
    [palette],
  );
  const folderColour = useMemo(() => tint(palette.land, WHITE, 0.15), [palette]);

  const uniforms = useMemo(
    () => ({
      uCentre: { value: new THREE.Vector2() },
      // The minor lines are the same phosphor-dim mixed back toward the void, so the
      // grid reads as one thing at two strengths rather than as two colours.
      uMinorColour: {
        value: new THREE.Color(palette.dim).lerp(new THREE.Color(palette.background), 0.5),
      },
      uMajorColour: { value: new THREE.Color(palette.dim) },
      uFadeNear: { value: fadeNear },
      uFadeFar: { value: fadeFar },
    }),
    [palette, fadeNear, fadeFar],
  );

  // One rasterised name per district, with the quad it prints on. The name is fixed
  // to its island, so this is worked out once rather than followed every frame.
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
          texture.image.width / texture.image.height,
        );
        return { id: district.id, texture, stamp };
      }),
    [districts, palette.mono],
  );

  useFrame(() => {
    // The ground point at the centre of the screen, from the camera's own centre
    // ray. The orbit target would do under the isometric camera, whose panning holds
    // it on y = 0, but the Explore camera can look anywhere.
    if (!grid.current) return;
    ray.setFromCamera(screenCentre, camera);
    if (!ray.ray.intersectPlane(ground, centre)) return;
    // Looking at the horizon puts that point most of a mile away, where re-centring
    // the plane on it would take the grid out from under the city. Past the fade it
    // makes no difference to what is drawn, so the grid stays where it was.
    if (Math.hypot(centre.x - camera.position.x, centre.z - camera.position.z) > fadeFar) return;
    grid.current.position.set(centre.x, GRID_Y, centre.z);
    uniforms.uCentre.value.set(centre.x, centre.z);
  });

  return (
    <>
      <color args={[palette.background]} attach="background" />
      {/* Fog and background have to be the exact same colour or the far ground ends
          in a horizon ring instead of dissolving. */}
      <fog args={[palette.background, fog.near, fog.far]} attach="fog" />
      <mesh frustumCulled={false} ref={grid} renderOrder={-1} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[plane, plane]} />
        <shaderMaterial
          depthWrite={false}
          fragmentShader={GRID_FRAGMENT_SHADER}
          glslVersion={THREE.GLSL3}
          transparent
          uniforms={uniforms}
          vertexShader={GRID_VERTEX_SHADER}
        />
      </mesh>
      {districts.map((district) => {
        const width = district.maxX - district.minX + ISLAND_PAD * 2;
        const depth = district.maxZ - district.minZ + ISLAND_PAD * 2;
        const rim = RIM_OVERHANG * 2;
        return (
          <group key={district.id} position={[district.centre.x, 0, district.centre.z]}>
            <mesh position={[0, -SLAB_HEIGHT / 2, 0]}>
              <boxGeometry args={[width, SLAB_HEIGHT, depth]} />
              <meshStandardMaterial
                color={slabColour(district.kind, palette)}
                metalness={0}
                roughness={1}
              />
            </mesh>
            <mesh position={[0, -SLAB_HEIGHT - RIM_HEIGHT / 2, 0]}>
              <boxGeometry args={[width + rim, RIM_HEIGHT, depth + rim]} />
              <meshStandardMaterial color={rimColour} metalness={0} roughness={1} />
            </mesh>
          </group>
        );
      })}
      {/* A nested folder is a lighter rectangle on the island its members stand on,
          which is what says where one block of a district ends and the next starts. */}
      {folders.map((folder) => (
        <mesh
          key={folder.id}
          position={[
            folder.centre.x,
            FOLDER_TINT_HEIGHT / 2 - SLAB_HEIGHT / 2,
            folder.centre.z,
          ]}
        >
          <boxGeometry args={[folder.width, SLAB_HEIGHT + FOLDER_TINT_HEIGHT, folder.depth]} />
          <meshStandardMaterial color={folderColour} metalness={0} roughness={1} />
        </mesh>
      ))}
      {/* The district's name printed flat on its island, in the margin along the north
          edge. It writes no depth, so the buildings, the roads and every link stand
          over it.

          ponytail: the print holds its strength through a selection and through focus
          mode, where the buildings around it fade. Fading it too means telling the
          stage which islands are lit, which is a prop and a set the stage has no other
          use for. ponytail: a nested folder's tint is opaque and stands a hundredth of
          a unit higher, so it would cover a name that reached under it. No folder in
          either fixture reaches into the margin the name is printed in. */}
      {stampsOf.map(({ id, stamp, texture }) => (
        <mesh
          key={id}
          position={[stamp.x, STAMP_Y, stamp.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[stamp.width, stamp.height]} />
          <meshBasicMaterial
            color={palette.dim}
            depthWrite={false}
            map={texture}
            opacity={STAMP_OPACITY}
            transparent
          />
        </mesh>
      ))}
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
/** Home is a shorter trip: the city is already on screen, only badly aimed. */
const REFRAME_MS = 400;

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
 * you. A resize is not a new framing, so the view it has is the view it keeps.
 */
function CameraRig({
  bounds,
  reframe,
  reducedMotion,
}: {
  bounds: CityBounds;
  /** Bumped by Home to ask for the same city to be framed again. */
  reframe: number;
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const controls = useThree((state) => state.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const flight = useRef<{
    from: View;
    to: View;
    started: number;
    ms: number;
    ease: (t: number) => number;
  } | null>(null);
  const framed = useRef<{
    bounds: CityBounds;
    controls: unknown;
    reframe: number;
  } | null>(null);

  const view = useMemo(() => viewOf(bounds, size), [bounds, size]);

  useEffect(() => {
    const cancel = () => {
      flight.current = null;
    };
    // A flight key is the reader taking the camera, exactly as a pointer down is.
    const cancelOnFlightKey = (event: KeyboardEvent) => {
      if (flownBy(event)) cancel();
    };
    gl.domElement.addEventListener("pointerdown", cancel);
    window.addEventListener("keydown", cancelOnFlightKey);
    return () => {
      gl.domElement.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancelOnFlightKey);
    };
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

    // This effect runs again every time the viewport is measured, which a resize
    // does a dozen times over, and hover, selection and lens changes all re-render
    // the scene around it. Framing again on any of those puts the camera back where
    // it started, so only a new set of bounds is allowed to move it.
    const asked = framed.current !== null && framed.current.reframe !== reframe;
    const action = framingAction(framed.current, { bounds, controls, reframe });
    framed.current = { bounds, controls, reframe };
    if (action === "none") return;
    if (action === "snap" || reducedMotion) {
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
      ms: asked ? REFRAME_MS : FLIGHT_MS,
      ease: asked ? smootherstep : easeInOutCubic,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bounds, controls, reframe, reducedMotion]);

  useFrame(() => {
    const moving = flight.current;
    if (!moving) return;
    const t = moving.ease(Math.min(1, (performance.now() - moving.started) / moving.ms));
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

/**
 * Orbit at the fixed isometric angle, inside the zoom range the stage can cover, or
 * free orbit in Explore. The pan is in the ground plane rather than in the screen
 * plane, which is what a city wants either way.
 *
 * Explore keeps one clamp, the ground: the elevation stops at the horizon rather
 * than carrying on under the slab, and the distance stops where the grid's fade
 * ends, which is the same edge the isometric zoom stops at.
 */
function Controls({ span, explore }: { span: number; explore: boolean }) {
  const size = useThree((state) => state.size);
  const { minZoom, maxZoom } = zoomRange(span, size);

  if (explore) {
    return (
      <OrbitControls
        makeDefault
        maxDistance={stageMetrics(span).fadeFar}
        maxPolarAngle={Math.PI / 2}
        minDistance={1}
        screenSpacePanning={false}
      />
    );
  }

  return (
    <OrbitControls
      makeDefault
      maxPolarAngle={ISO_POLAR_ANGLE}
      maxZoom={maxZoom}
      minPolarAngle={ISO_POLAR_ANGLE}
      minZoom={minZoom}
      screenSpacePanning={false}
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
function flownBy(event: KeyboardEvent): boolean {
  if (!FLIGHT_CODES.has(event.code)) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const from = event.composedPath()[0];
  return !(
    from instanceof HTMLElement &&
    (from.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName) ||
      from.closest('[role="dialog"]'))
  );
}

/** Scratch, so flying allocates nothing per frame. */
const FLIGHT_STEP = new THREE.Vector3();

/**
 * Keyboard flight, the rig that owns the keys. Held keys become a velocity that eases
 * in and out, which moves the camera and its orbit target together, so the controls
 * pick the pose back up unchanged the moment a hand goes back to the mouse.
 *
 * The isometric camera pans the ground along the screen, at a speed derived from its
 * zoom so a key covers the same screen distance however far in it is. Explore flies
 * along its heading, the arrows turn it and R and F change its height.
 */
function Flight({ explore }: { explore: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const size = useThree((state) => state.size);
  const held = useMemo(() => new Set<string>(), []);
  const boosting = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const turning = useRef(new THREE.Vector2());

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
    // A tab that was in the background hands back one enormous delta, which would
    // teleport the camera as far as the whole time it was away.
    const step = Math.min(delta, 0.05);
    const boost = boosting.current ? BOOST : 1;
    const distance = camera.position.distanceTo(controls.target);
    const speed = explore
      ? FLY_SPEED * boost
      : panSpeed(
          pixelsPerUnit(
            camera as THREE.OrthographicCamera & { fov?: number },
            size.height,
            distance,
          ),
        ) * boost;
    const wanted = desiredVelocity(
      held,
      groundAxes(camera.position, controls.target),
      speed,
      explore ? "fly" : "pan",
    );
    const moving = velocity.current.set(
      approach(velocity.current.x, wanted.x, step),
      approach(velocity.current.y, wanted.y, step),
      approach(velocity.current.z, wanted.z, step),
    );
    // A hundredth of a world unit a second is a stop, and rounding it to one keeps
    // the controls from being updated on every idle frame for ever.
    if (moving.lengthSq() < 1e-4) moving.set(0, 0, 0);

    const rates = explore ? turnRates(held) : { yaw: 0, pitch: 0 };
    const turn = turning.current.set(
      approach(turning.current.x, rates.yaw * TURN_SPEED * boost, step),
      approach(turning.current.y, rates.pitch * TURN_SPEED * boost, step),
    );
    if (turn.lengthSq() < 1e-6) turn.set(0, 0);
    if (moving.lengthSq() === 0 && turn.lengthSq() === 0) return;

    if (turn.lengthSq() > 0) {
      const offset = turnedOffset(
        FLIGHT_STEP.subVectors(camera.position, controls.target),
        turn.x * step,
        turn.y * step,
        // ponytail: the same clamp `Controls` gives Explore, written twice. Reading
        // it back off the live controls means typing them wider than the two fields
        // this rig uses them through.
        Math.PI / 2,
      );
      controls.target.set(
        camera.position.x - offset.x,
        camera.position.y - offset.y,
        camera.position.z - offset.z,
      );
    }
    if (moving.lengthSq() > 0) {
      FLIGHT_STEP.copy(moving).multiplyScalar(step);
      camera.position.add(FLIGHT_STEP);
      controls.target.add(FLIGHT_STEP);
    }
    controls.update();
  });

  return null;
}

/** Where the camera stands and what it is looking at, as of the last frame. */
type Pose = { position: THREE.Vector3; target: THREE.Vector3; worldHeight: number };

/**
 * Remembers the isometric camera's pose every frame, so the Explore camera can be
 * stood up exactly where it was looking from. `worldHeight` is how much world the
 * viewport covers at the target, which is what the two cameras have to agree on for
 * the switch not to jump. It runs only while the isometric camera is the one on, and
 * a session that opens straight into Explore leaves it null.
 */
function PoseTracker({ pose }: { pose: React.RefObject<Pose | null> }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3 } | null;
  const size = useThree((state) => state.size);

  useFrame(() => {
    const at = pose.current ?? {
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      worldHeight: 1,
    };
    at.position.copy(camera.position);
    if (controls) at.target.copy(controls.target);
    const perUnit = pixelsPerUnit(
      camera as THREE.OrthographicCamera & { fov?: number },
      size.height,
      camera.position.distanceTo(at.target),
    );
    at.worldHeight = size.height / perUnit;
    pose.current = at;
  });

  return null;
}

const EXPLORE_FOV = 45;

/**
 * The Explore camera. It starts at the isometric camera's own direction and target,
 * far enough back that the viewport covers the same world height, so turning Explore
 * on changes the projection and nothing else.
 */
function ExploreCamera({
  bounds,
  pose,
  span,
}: {
  bounds: CityBounds;
  pose: React.RefObject<Pose | null>;
  span: number;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const placed = useRef(false);

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    // drei swaps the default camera one render after this component mounts, so the
    // first run of this effect is still the orthographic one.
    if (!perspective.isPerspectiveCamera || !controls) return;
    // A link straight into Explore has no isometric camera to copy, so the framing
    // that one would have taken is worked out here instead.
    const framing = viewOf(bounds, size);
    const from = pose.current ?? {
      position: framing.position,
      target: framing.target,
      worldHeight: size.height / framing.zoom,
    };
    if (!placed.current) {
      const distance = from.worldHeight / (2 * Math.tan((EXPLORE_FOV * Math.PI) / 360));
      const direction = from.position.clone().sub(from.target).normalize();
      perspective.position.copy(from.target).addScaledVector(direction, distance);
      placed.current = true;
    }
    // New controls come with the target at the origin, so it is copied over every
    // time they are rebuilt, not only on the first one.
    controls.target.copy(from.target);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, pose]);

  return <PerspectiveCamera far={span * 40} fov={EXPLORE_FOV} makeDefault near={0.5} />;
}

/** Milliseconds a building takes to move between its city spot and its focus spot. */
const TWEEN_MS = 400;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export default function Scene({
  graph,
  usage,
  scale,
  selected,
  focus,
  layers,
  icons,
  explore,
  reframe = 0,
  onSelect,
  onFocus,
}: {
  graph: SchemaGraph;
  usage?: UsageReport;
  /** Umbraco icon name to SVG, for the roofs. The harness usually passes none. */
  icons?: Record<string, string>;
  /** The lens colouring App computed. Absent or null means no lens is on. */
  scale?: LensScale | null;
  selected: string | null;
  focus: string | null;
  layers: readonly Layer[];
  /** The Explore toggle: a free perspective camera instead of the isometric one. */
  explore?: boolean;
  /**
   * Bumped to frame the whole city again. It is a count rather than a flag because
   * the camera has to answer Home a second time from wherever the reader took it.
   */
  reframe?: number;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const pose = useRef<Pose | null>(null);
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const city = useMemo(() => cityDistricts(graph), [graph]);
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
    return [...members].map(([id, held]) => ({ id, ...cityBounds(held, FOLDER_PAD) }));
  }, [city]);
  const neighbourhoodById = useMemo(() => neighbourhoods(graph), [graph]);
  const focusNeighbours = useMemo(
    () => (focus ? neighboursOf(graph, focus) : null),
    [graph, focus],
  );
  const target = useMemo(() => {
    const neighbourhood = focus ? neighbourhoodById.get(focus) : undefined;
    if (!focus || !neighbourhood) return city.placements;
    const laid = layoutFocus(graph, neighbourhood, focus, city.placements);
    const inFocus = focusNeighbours ?? new Set<string>();
    // Everything the focused node has nothing to do with becomes ground: the
    // neighbourhood is laid out over the city it came from, and a city still standing
    // at full height under it reads as two layouts on top of each other.
    return laid.map((placement) =>
      inFocus.has(placement.id) ? placement : { ...placement, flatten: 1 },
    );
  }, [focus, focusNeighbours, graph, neighbourhoodById, city]);

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
              // Nothing to tween when the placement is the same object and neither
              // end is flattened, which is most of the city on the way in.
              if (!at || (at === to && (at.flatten ?? 0) === (to.flatten ?? 0))) return to;
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
  const ground = useMemo(() => cityBounds(city.placements, ISLAND_PAD), [city]);
  // The stage is scaled by the city's own span, whatever the focus layout does, so
  // entering focus never rescales the world around it.
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
  const { cellsByKind, windows, heights } = useMemo(() => {
    const built = buildFloorCells(nodesById, placements);
    return {
      cellsByKind: groupByKind(built.cells),
      windows: built.windows,
      heights: built.heights,
    };
  }, [nodesById, placements]);
  const plazas = useMemo(() => buildPlazaCells(nodesById, placements), [nodesById, placements]);
  const iconGroups = useIconGroups(icons, nodesById, palette?.phosphor ?? "");

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
  // Twenty roads landing on one roof is the wiring mess the overview is meant to
  // avoid, so a building with more allowed parents than the fan limit keeps the
  // nearest road and a count. Pointing at it or picking it draws the rest, and
  // focus mode is already about one node, so nothing is cut there.
  const fan = useMemo(
    () =>
      roadFan(
        placementsById,
        drawnEdges,
        focus ? null : new Set([hovered, selected].filter((id): id is string => id !== null)),
      ),
    [placementsById, drawnEdges, focus, hovered, selected],
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
          // A click on paving or on the void is a click on nothing, which is how the
          // city goes back the way it was without hunting for a close button.
          onPointerMissed={() => onSelect(null)}
          orthographic
        >
          <ambientLight intensity={1.2} />
          <directionalLight intensity={2.4} position={[8, 16, 6]} />
          <Stage
            districts={city.districts}
            folders={folderTints}
            palette={palette}
            span={span}
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
          {iconGroups.length > 0 ? (
            <RoofIcons
              groups={iconGroups}
              heights={heights}
              hovered={hovered}
              neighbours={neighbours}
              palette={palette}
              placementsById={placementsById}
              selected={selected}
            />
          ) : null}
          {active.has("structure") ? (
            <Roads
              edges={fan.edges}
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
                placementsById={placementsById}
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
            badge={selected ? usageBadge(usage, selected) : null}
            fanMarkers={fan.markers}
            focusNeighbours={focusNeighbours}
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            nodesById={nodesById}
            placementsById={placementsById}
            selected={selected}
          />
          {explore ? (
            <ExploreCamera bounds={bounds} pose={pose} span={span} />
          ) : (
            <>
              <CameraRig bounds={bounds} reducedMotion={reducedMotion} reframe={reframe} />
              <PoseTracker pose={pose} />
            </>
          )}
          <Controls explore={explore === true} span={span} />
          <Flight explore={explore === true} />
        </Canvas>
      ) : null}
    </div>
  );
}
