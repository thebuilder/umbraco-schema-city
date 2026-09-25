// The buildings on screen: the instanced parts `buildings.ts` lays out, their glowing
// edges, the selection and hover outlines, and the roof icons. Kept out of Scene.tsx
// so the buildings and the boards and traces can change without touching each other.
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { SchemaNode } from "../../model/types";
import type { DistrictKind, Placement } from "../layout/city";
import {
  type FloorCell,
  type FloorCellKind,
  type PlazaCell,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  type WindowCell,
} from "./buildings";
import { iconColour, rasteriseIcon } from "./icons";
import type { LensScale, Ramp } from "./lens";
import { buildingRiseAt, revealAt } from "./reveal";
import { pixelsPerUnit } from "./stage";

/** The theme colours the buildings read. Scene's palette has these and more. */
export type BuildingPalette = {
  phosphor: string;
  dim: string;
  signal: string;
  amber: string;
  azure: string;
  background: string;
  separator: string;
};

const PLAZA_HEIGHT = 0.05;
const HOVER_BRIGHTEN = 1.4;
/** How far a faded building's colour moves toward the void, approximating 20% opacity. */
const FADE_MIX = 0.8;
/** The same, for a building focus mode has pressed flat: about 12% opacity. */
const PLATE_MIX = 0.88;

/**
 * How each part is lit. `edge` is the glow along the box's edges and `body` the glow
 * over its faces, both in its own colour, so hover, selection, the lens and the fade
 * carry into the glow without rules of their own. `opacity` is the part's opacity
 * once the intro is over; only the composed shell stays see-through.
 */
type Look = {
  edge: number;
  body: number;
  opacity: number;
  roughness: number;
  metalness: number;
  castShadow: boolean;
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
function glowing(material: THREE.MeshStandardMaterial, look: Look) {
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

const BOX = new THREE.BoxGeometry();

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
    const grouped = new Map<FloorCellKind, FloorCell[]>(
      KINDS.map((kind) => [kind, []])
    );
    for (const cell of cells) grouped.get(cell.kind)?.push(cell);
    return grouped;
  }, [cells]);

  // One material per part, made here rather than in JSX so the intro can fade each
  // to its own resting opacity. The windows and plazas are plain and take theirs.
  const materials = useMemo(() => {
    const made = new Map<FloorCellKind, THREE.MeshStandardMaterial>();
    for (const kind of KINDS) {
      const look = LOOKS[kind];
      made.set(
        kind,
        glowing(
          new THREE.MeshStandardMaterial({
            roughness: look.roughness,
            metalness: look.metalness,
            transparent: true,
            opacity: reducedMotion ? look.opacity : 0,
            // The shell is drawn after the solids and does not hide what is inside
            // it, which is what lets a composed floor read as glass.
            depthWrite: kind !== "composed",
          }),
          look
        )
      );
    }
    return made;
  }, [reducedMotion]);
  const plain = useMemo(
    () => ({
      window: new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        opacity: reducedMotion ? 1 : 0,
      }),
      plaza: new THREE.MeshStandardMaterial({
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: reducedMotion ? 1 : 0,
      }),
    }),
    [reducedMotion]
  );
  useEffect(
    () => () => {
      for (const material of materials.values()) material.dispose();
      plain.window.dispose();
      plain.plaza.dispose();
    },
    [materials, plain]
  );

  const bases = useMemo(
    () =>
      new Map(placements.map((placement) => [placement.id, placement.y ?? 0])),
    [placements]
  );
  const scratch = useMemo(() => new THREE.Object3D(), []);
  // Windows are the only thing here that is turned, and a shared scratch object
  // would leave that rotation on the next box written through it.
  const turned = useMemo(() => new THREE.Object3D(), []);
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
    const background = new THREE.Color(palette.background);
    const separator = new THREE.Color(palette.separator);
    const marker = phosphor.clone().lerp(new THREE.Color("#ffffff"), 0.6);
    return {
      phosphor,
      dim,
      background,
      marker,
      signal: new THREE.Color(palette.signal),
      amber: new THREE.Color(palette.amber),
      azure: new THREE.Color(palette.azure),
      // The parts with a colour of their own: the board a component sits on, the
      // dark inside that shows between slabs, the unlit lid, the pins and the dots.
      parts: {
        plinth: separator.clone().lerp(dim, 0.3),
        core: separator.clone().lerp(background, 0.5),
        lid: separator.clone().lerp(dim, 0.35),
        pin: dim,
        separator: dim,
        marker,
      } as Partial<Record<FloorCellKind, THREE.Color>>,
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

  // Every part, the windows and the hit target rise about the same base.
  // Keep depth writes and render queues fixed so the fade cannot pop at its end.
  function updateBuildingGeometry(rise: number) {
    for (const [kind, mesh] of meshes.current) {
      (byKind.get(kind) ?? []).forEach((cell, i) => {
        applyCell(mesh, i, cell, rise);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }

    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) => {
        const base = bases.get(cell.buildingId) ?? 0;
        turned.position.set(cell.cx, base + (cell.cy - base) * rise, cell.cz);
        turned.rotation.set(0, cell.rotY, 0);
        turned.scale.set(WINDOW_WIDTH, WINDOW_HEIGHT * rise, 1);
        turned.updateMatrix();
        window.setMatrixAt(i, turned.matrix);
      });
      window.instanceMatrix.needsUpdate = true;
      window.computeBoundingSphere();
    }

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
  }, [byKind, windows, plazas, placements, heights, reducedMotion]);

  useFrame((state) => {
    const rise = buildingRiseAt(state.clock.elapsedTime, reducedMotion);
    if (rise !== lastRise.current) {
      lastRise.current = rise;
      updateBuildingGeometry(rise);
    }
    const opacity = revealAt(state.clock.elapsedTime, reducedMotion).districts;
    for (const [kind, material] of materials)
      material.opacity = opacity * LOOKS[kind].opacity;
    plain.window.opacity = opacity;
    plain.plaza.opacity = opacity;
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
    const lensById = new Map<string, THREE.Color>();
    if (scale)
      for (const [id, t] of scale.t)
        lensById.set(id, rampColour(scale.ramp, t, colors));
    // A page takes its colour from the district it stands in: phosphor in a
    // structure district, phosphor-dim in a composition or mixed one. Element Types
    // are amber and the composed shell azure, the colour of the composition traces,
    // wherever they stand.
    const districtColour = (district: DistrictKind | undefined) =>
      district === "elements"
        ? colors.amber
        : district === "structure"
          ? colors.phosphor
          : colors.dim;
    // The slabs, the element block and the lit lid say what the type is, so they
    // take the selection and the lens. The rest of the component keeps its colour.
    const bodyColour = (kind: FloorCellKind, id: string) => {
      if (id === selected) return colors.signal;
      const lens = lensById.get(id);
      if (lens) return lens;
      if (kind === "composed") return colors.azure;
      if (kind === "element") return scale ? colors.dim : colors.amber;
      return districtColour(districtById.get(id));
    };
    const paint = (kind: FloorCellKind, id: string, out: THREE.Color) => {
      out.copy(colors.parts[kind] ?? bodyColour(kind, id));
      // A lit lid is the page's own colour turned toward white: it renders.
      if (kind === "litLid") out.lerp(colors.marker, 0.1);
      if (id === hovered) out.multiplyScalar(HOVER_BRIGHTEN);
      if (!lit(id)) out.lerp(colors.background, fadeOf(id));
      return out;
    };

    const colour = new THREE.Color();
    for (const [kind, mesh] of meshes.current) {
      (byKind.get(kind) ?? []).forEach((cell, i) => {
        mesh.setColorAt(i, paint(kind, cell.buildingId, colour));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // A window is the slab's own colour turned up, so it carries the lens, the
    // selection and the fade without a second set of rules. Mandatory properties
    // are turned up further, which is the one thing the wall does not already say.
    const window = windowRef.current;
    if (window) {
      windows.forEach((cell, i) => {
        window.setColorAt(
          i,
          paint(cell.kind, cell.buildingId, colour).multiplyScalar(
            cell.mandatory ? 1.9 : 1.45
          )
        );
      });
      if (window.instanceColor) window.instanceColor.needsUpdate = true;
    }

    const plaza = plazaRef.current;
    if (plaza) {
      plazas.forEach((cell, i) => {
        colour.copy(cell.buildingId === selected ? colors.signal : colors.dim);
        if (cell.buildingId === hovered) colour.multiplyScalar(HOVER_BRIGHTEN);
        if (!lit(cell.buildingId))
          colour.lerp(colors.background, fadeOf(cell.buildingId));
        plaza.setColorAt(i, colour);
      });
      if (plaza.instanceColor) plaza.instanceColor.needsUpdate = true;
    }
  }, [
    byKind,
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
      {KINDS.map((kind) => {
        const count = byKind.get(kind)?.length ?? 0;
        if (count === 0) return null;
        return (
          <instancedMesh
            args={[BOX, materials.get(kind), count]}
            castShadow={LOOKS[kind].castShadow}
            key={`${kind}|${count}`}
            receiveShadow
            ref={(mesh) => {
              if (mesh) meshes.current.set(kind, mesh);
              else meshes.current.delete(kind);
            }}
            // The shell draws after every solid part, so the core shows through it.
            renderOrder={kind === "composed" ? 1 : 0}
          />
        );
      })}
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
    const placement = id ? placementsById.get(id) : undefined;
    lines.visible = placement !== undefined && (placement.flatten ?? 0) < 0.5;
    if (!(placement && lines.visible)) return;
    const rise = buildingRiseAt(state.clock.elapsedTime, reducedMotion);
    const height = (heights.get(placement.id) ?? placement.height) * rise;
    const side = placement.footprint * grow;
    const tall = height + (grow - 1) * placement.footprint;
    lines.position.set(
      placement.position.x,
      (placement.y ?? 0) + tall / 2,
      placement.position.z
    );
    lines.scale.set(side, tall, side);
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
        grow={1.08}
        id={selected}
        opacity={0.95}
        width={2}
        {...shared}
      />
      <BuildingFrame
        colour={palette.phosphor}
        grow={1.16}
        id={hovered === selected ? null : hovered}
        opacity={0.55}
        width={1.4}
        {...shared}
      />
    </>
  );
}

/** Fraction of the footprint one roof icon covers, and the darker plate under it. */
const ICON_FOOTPRINT = 0.6;
const PLATE_FOOTPRINT = 0.72;
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
export function useIconGroups(
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
 * The Umbraco icon of each type, painted flat on its roof over a darker plate.
 * Flat rather than billboarded, because a sprite standing over the
 * roof lands behind the label of the very building it names. One instanced mesh per
 * icon and colour, which the seeded schema makes 15 of, and the whole set is
 * rewritten every frame, which is 78 matrices: nothing next to the buildings.
 *
 * An icon whose building is under `ICON_MIN_PX` across is scaled away rather than
 * drawn, the same projected measure the label layer culls names by, except for the
 * selected and the hovered building, which keep theirs at any zoom. The plate is
 * see-through, so a lit lid still shows under it.
 */
export function RoofIcons({
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
  palette: BuildingPalette;
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
          shown ? (placement?.footprint ?? 0) * PLATE_FOOTPRINT : 0
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
