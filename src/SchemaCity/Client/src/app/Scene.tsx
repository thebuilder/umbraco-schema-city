import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { neighbourhoods } from "../model/neighbourhood";
import type { SchemaEdge, SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { cityBounds, layoutCity, type CityBounds, type Placement } from "./layout/city";
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
import { type Anchor, buildLinkGeometry, type Layer, type LinkRange } from "./scene/layers";
import { buildRoadGeometry } from "./scene/roads";
import {
  fogRange,
  framingAction,
  GRID_FRAGMENT_SHADER,
  GRID_VERTEX_SHADER,
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
};

/** Seconds a building takes to rise, once its own `introDelay` has passed. */
const INTRO_DURATION = 0.46;
const PLAZA_HEIGHT = 0.05;
const HOVER_BRIGHTEN = 1.4;
/** How far a faded building's colour moves toward the void, approximating 20% opacity. */
const FADE_MIX = 0.8;

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
    // A lens repaints the buildings it has a number for. The ones it says nothing
    // about are Element Types, which have no content of their own, and under a lens
    // they go phosphor-dim: amber is the zero end of the ramp, and an amber district
    // sitting next to it reads as the emptiest place in the city.
    const lensColour = (buildingId: string) => {
      const t = scale?.t.get(buildingId);
      return t === undefined || !scale ? null : rampColour(scale.ramp, t, colors);
    };
    const colourFor = (kind: FloorCellKind, buildingId: string) => {
      const unlit = scale && kind === "element" ? colors.dim : colors[kind];
      const base =
        buildingId === selected
          ? colors.signal
          : lensColour(buildingId) ?? unlit;
      const bright = buildingId === hovered ? base.clone().multiplyScalar(HOVER_BRIGHTEN) : base;
      return lit(buildingId) ? bright : bright.clone().lerp(colors.fade, FADE_MIX);
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
        plaza.setColorAt(i, lit(cell.buildingId) ? bright : bright.clone().lerp(colors.fade, FADE_MIX));
      });
      if (plaza.instanceColor) plaza.instanceColor.needsUpdate = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellsByKind, windows, plazas, selected, hovered, neighbours, colors, scale]);

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
 * or three icons, so a city of 12 px smudges reads as noise rather than as identity;
 * at 40 px an icon is legible and only a handful of buildings are that big at once.
 * The inspector header carries the same icon at any zoom.
 */
const ICON_MIN_PX = 40;

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
  badge,
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
    return built;
  }, [hovered, selected, neighbours, focusNeighbours, nodesById, placementsById, heights, badge]);

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

/** Thickness of the slab of land the city stands on, whose top face is y = 0. */
const SLAB_HEIGHT = 0.4;
const RIM_HEIGHT = 0.18;
/** How far the rim stands out past the slab, and the slab past the city. */
const RIM_OVERHANG = 0.9;
const SLAB_MARGIN = 2.5;
/** The grid sits under the rim, so the two can never z-fight. */
const GRID_Y = -(SLAB_HEIGHT + RIM_HEIGHT + 0.05);

/**
 * The world stage, borrowed from fsn: a void-coloured background and fog, one grid
 * plane that follows the camera so the ground never runs out, and the slab of land the
 * city stands on. `span` is the city's own, not the focus layout's, so entering focus
 * does not rescale the world; `bounds` is whatever layout is on screen, so the slab
 * moves with it.
 *
 * Three draw calls, and nothing here animates.
 */
function Stage({ bounds, span, palette }: { bounds: CityBounds; span: number; palette: Palette }) {
  const camera = useThree((state) => state.camera);
  const grid = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const screenCentre = useMemo(() => new THREE.Vector2(0, 0), []);
  const centre = useMemo(() => new THREE.Vector3(), []);
  const { fadeNear, fadeFar, plane } = stageMetrics(span);
  const fog = fogRange(span);

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

  const rim = SLAB_MARGIN + RIM_OVERHANG;
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
      {/* ponytail: one rectangle around everything placed. In focus mode that is the
          city and the focus layout at once, so the land reads as a larger rectangle
          rather than as ground that follows the layout. Two slabs, or a slab per
          district, would fix it; the grid under it is the same either way. */}
      <mesh position={[bounds.centre.x, -SLAB_HEIGHT / 2, bounds.centre.z]}>
        <boxGeometry
          args={[bounds.width + SLAB_MARGIN * 2, SLAB_HEIGHT, bounds.depth + SLAB_MARGIN * 2]}
        />
        <meshStandardMaterial color={palette.land} metalness={0} roughness={1} />
      </mesh>
      <mesh position={[bounds.centre.x, -SLAB_HEIGHT - RIM_HEIGHT / 2, bounds.centre.z]}>
        <boxGeometry args={[bounds.width + rim * 2, RIM_HEIGHT, bounds.depth + rim * 2]} />
        <meshStandardMaterial
          color={new THREE.Color(palette.land).lerp(new THREE.Color(palette.background), 0.6)}
          metalness={0}
          roughness={1}
        />
      </mesh>
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
 * you. A resize is not a new framing, so the view it has is the view it keeps.
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
  const framed = useRef<{ bounds: CityBounds; controls: unknown } | null>(null);

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

    // This effect runs again every time the viewport is measured, which a resize
    // does a dozen times over, and hover, selection and lens changes all re-render
    // the scene around it. Framing again on any of those puts the camera back where
    // it started, so only a new set of bounds is allowed to move it.
    const action = framingAction(framed.current, { bounds, controls });
    framed.current = { bounds, controls };
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

/** Where the camera stands and what it is looking at, as of the last frame. */
type Pose = { position: THREE.Vector3; target: THREE.Vector3; worldHeight: number };

/**
 * Remembers the camera pose every frame, so the Explore camera can be stood up
 * exactly where the isometric one was looking from. `worldHeight` is how much world
 * the viewport covers at the target, which is what the two cameras have to agree on
 * for the switch not to jump.
 */
function PoseTracker({ pose }: { pose: React.RefObject<Pose> }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3 } | null;
  const size = useThree((state) => state.size);

  useFrame(() => {
    pose.current.position.copy(camera.position);
    if (controls) pose.current.target.copy(controls.target);
    const perUnit = pixelsPerUnit(
      camera as THREE.OrthographicCamera & { fov?: number },
      size.height,
      camera.position.distanceTo(pose.current.target),
    );
    pose.current.worldHeight = size.height / perUnit;
  });

  return null;
}

const EXPLORE_FOV = 45;

/**
 * The Explore camera. It starts at the isometric camera's own direction and target,
 * far enough back that the viewport covers the same world height, so turning Explore
 * on changes the projection and nothing else.
 */
function ExploreCamera({ pose, span }: { pose: React.RefObject<Pose>; span: number }) {
  const camera = useThree((state) => state.camera);
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
    if (!placed.current) {
      const distance = pose.current.worldHeight / (2 * Math.tan((EXPLORE_FOV * Math.PI) / 360));
      const direction = pose.current.position.clone().sub(pose.current.target).normalize();
      perspective.position.copy(pose.current.target).addScaledVector(direction, distance);
      placed.current = true;
    }
    // New controls come with the target at the origin, so it is copied over every
    // time they are rebuilt, not only on the first one.
    controls.target.copy(pose.current.target);
    controls.update();
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
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const pose = useRef<Pose>({
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    worldHeight: 1,
  });
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

  const ground = useMemo(() => cityBounds(city), [city]);
  // The stage is scaled by the city's own span, whatever the focus layout does, so
  // entering focus never rescales the world around it.
  const span = citySpan(ground);
  // The slab of land follows what is on screen instead, which during a focus tween is
  // the buildings mid-flight, so it is never out from under them.
  const land = useMemo(() => cityBounds(placements), [placements]);
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
          <Stage bounds={land} palette={palette} span={span} />
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
            badge={selected ? usageBadge(usage, selected) : null}
            focusNeighbours={focusNeighbours}
            heights={heights}
            hovered={hovered}
            neighbours={neighbours}
            nodesById={nodesById}
            placementsById={placementsById}
            selected={selected}
          />
          {explore ? (
            <ExploreCamera pose={pose} span={span} />
          ) : (
            <CameraRig bounds={bounds} reducedMotion={reducedMotion} />
          )}
          <Controls explore={explore === true} span={span} />
          <PoseTracker pose={pose} />
        </Canvas>
      ) : null}
    </div>
  );
}
