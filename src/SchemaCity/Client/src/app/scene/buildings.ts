// Turns placements and their nodes into the boxes each building is made of, for the
// instanced meshes. Pure: no three.js, no React, no DOM. BuildingMeshes.tsx owns the
// actual geometry and materials; this only decides where each box goes and what it is.
//
// A building is a component on the board: a plinth with pins, then one slab per
// property group with a dark gap between slabs, then a lid. Every part stands for
// something in the schema, so none of it is decoration.
import type { PropertyGroup, SchemaEdge, SchemaNode } from "../../model/types";
import type { Placement } from "../layout/city";

export type FloorCellKind =
  /** An own property group, solid. */
  | "own"
  /** A composed group, or any group of a composition: the translucent shell. */
  | "composed"
  /** The dark column a page's slabs stand around, seen in the gaps between them. */
  | "core"
  /** A thin board in the gap before a group that starts a new tab. */
  | "separator"
  | "element"
  | "plinth"
  | "pin"
  /** The roof lid of a page with a template. */
  | "litLid"
  /** The roof lid of a page with no template. */
  | "lid"
  /** A dot on the roof: varies by culture, or by segment. */
  | "marker";

export type FloorCell = {
  buildingId: string;
  kind: FloorCellKind;
  /** Ground-relative centre, in world units. */
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
};

/** One property, as a lit quad on the wall of the floor its group is. */
export type WindowCell = {
  buildingId: string;
  /** The floor's kind, so a window takes the colour of the floor it is cut into. */
  kind: "own" | "composed";
  mandatory: boolean;
  cx: number;
  cy: number;
  cz: number;
  /** Rotation about y, in radians: which of the four walls this window is on. */
  rotY: number;
};

export type PlazaCell = {
  buildingId: string;
  cx: number;
  /** The ground the building stands on, which the focus layout can raise. */
  cy: number;
  cz: number;
  radius: number;
};

/**
 * Direct relationships per side of the plinth. North and south are the allowed
 * parents and children, the directions the structure roads arrive from and leave in.
 * East counts the types this one points at through a composition, inheritance, block
 * or picker; west counts the types that point at it the same ways.
 */
export type Pins = { north: number; south: number; east: number; west: number };

export type Connections = {
  pins: Map<string, Pins>;
  /** Types some other type composes. */
  composed: Set<string>;
};

export type BuildingRole = "page" | "composition" | "element";

/** One group's share of the height: a slab and the gap under it. */
export const FLOOR_HEIGHT = 0.6;
const GAP = 0.1;
const SLAB_HEIGHT = FLOOR_HEIGHT - GAP;
const PLINTH_HEIGHT = 0.14;
const LID_HEIGHT = 0.06;
const ELEMENT_HEIGHT = 0.46;
const SEPARATOR_HEIGHT = 0.04;
// Widths, as fractions of the footprint. The footprint is the layout's and stays
// whole; the parts step in from it so the pins have somewhere to stand.
const PLINTH_SCALE = 0.9;
const SLAB_SCALE = 0.8;
const CORE_SCALE = 0.66;
const SEPARATOR_SCALE = 0.86;
/** The lid, a smaller chip on the top slab. */
const LID_SCALE = 0.5;
const PIN_WIDTH = 0.07;
const PIN_HEIGHT = 0.06;
const PIN_PITCH = 0.2;
/** Space kept clear at each end of a row of pins, as a chip leaves at its corners. */
const PIN_MARGIN = 0.22;
const MARKER_SIZE = 0.12;
export const WINDOW_WIDTH = 0.16;
export const WINDOW_HEIGHT = 0.24;
/** Smallest distance between two window centres. A longer row is cut off here. */
const WINDOW_PITCH = 0.28;
/** How far a window stands off the wall, so the two never z-fight. */
const WINDOW_STANDOFF = 0.012;
const PLAZA_MARGIN = 0.6;
/** What a building's whole mass comes to once focus mode has pressed it flat. */
const PLATE_HEIGHT = 0.1;
const NO_PINS: Pins = { north: 0, south: 0, east: 0, west: 0 };
const NO_CONNECTIONS: Connections = { pins: new Map(), composed: new Set() };

// A node with no groups still gets one floor, coloured as its own.
const UNGROUPED: PropertyGroup = {
  id: "",
  alias: "",
  name: "",
  type: "Group",
  parentAlias: null,
  fromCompositionId: null,
  properties: [],
};

/** `smootherstep`, borrowed from fsn for the intro rise. */
export function smootherstep(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Pins per side for every type, counted as distinct other types, so a block list
 * that names one element from three properties is still one pin. A self edge is left
 * out, because the ring beside the building already says it.
 */
export function connectionsOf(edges: readonly SchemaEdge[]): Connections {
  const sides = new Map<string, Record<keyof Pins, Set<string>>>();
  const sideOf = (id: string) => {
    let side = sides.get(id);
    if (!side) {
      side = {
        north: new Set(),
        south: new Set(),
        east: new Set(),
        west: new Set(),
      };
      sides.set(id, side);
    }
    return side;
  };
  const composed = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (edge.kind === "allowedChild") {
      sideOf(edge.from).south.add(edge.to);
      sideOf(edge.to).north.add(edge.from);
      continue;
    }
    if (edge.kind === "composition") composed.add(edge.to);
    sideOf(edge.from).east.add(edge.to);
    sideOf(edge.to).west.add(edge.from);
  }
  const pins = new Map<string, Pins>();
  for (const [id, side] of sides)
    pins.set(id, {
      north: side.north.size,
      south: side.south.size,
      east: side.east.size,
      west: side.west.size,
    });
  return { pins, composed };
}

/**
 * What a type is for, which decides its form. A composition is a type something
 * composes and that content can never be made from: no allowed parent and not
 * allowed at the root. A composed page that is also allowed somewhere stays a page.
 */
export function roleOf(
  node: SchemaNode,
  connections: Connections
): BuildingRole {
  if (node.isElement) return "element";
  const parents = connections.pins.get(node.id)?.north ?? 0;
  return connections.composed.has(node.id) &&
    parents === 0 &&
    !node.allowedAsRoot
    ? "composition"
    : "page";
}

/**
 * The windows on one floor: one per property in the group, walked around the four
 * walls from the middle of the front one. Two properties put one window on the front
 * wall and one on the back, which is what a row of them wrapping looks like.
 *
 * ponytail: past `width * 4 / WINDOW_PITCH` windows the row would draw on top of
 * itself, so it stops there. That is 27 properties in one group on the smallest
 * building, against 8 in the busiest group of the seeded schema. Two rows of windows
 * per floor is the fix if a schema ever passes it.
 */
function pushWindows(
  out: WindowCell[],
  group: PropertyGroup,
  kind: "own" | "composed",
  buildingId: string,
  width: number,
  y: number
) {
  const perimeter = width * 4;
  const count = Math.min(
    group.properties?.length ?? 0,
    Math.floor(perimeter / WINDOW_PITCH)
  );
  const half = width / 2 + WINDOW_STANDOFF;

  for (let i = 0; i < count; i++) {
    const at = ((i + 0.5) / count) * perimeter;
    const wall = Math.floor(at / width);
    const along = (at % width) - width / 2;
    // Anticlockwise from the front wall, which faces +z, the way a plane does.
    const [cx, cz, rotY] = (
      [
        [along, half, 0],
        [half, -along, Math.PI / 2],
        [-along, -half, Math.PI],
        [-half, along, -Math.PI / 2],
      ] as const
    )[wall] ?? [along, half, 0];

    out.push({
      buildingId,
      kind,
      mandatory: group.properties[i]?.mandatory ?? false,
      cx,
      cy: y,
      cz,
      rotY,
    });
  }
}

/**
 * A row of pins along each side of the plinth, centred like a chip's leads, from the
 * plinth's edge out to the footprint's.
 *
 * ponytail: a side holds `(plinth - 2 * PIN_MARGIN) / PIN_PITCH + 1` pins, 9 on the
 * smallest footprint, and a longer row is cut there. The inspector has the full count.
 */
function pushPins(
  out: FloorCell[],
  buildingId: string,
  footprint: number,
  pins: Pins
) {
  const plinth = footprint * PLINTH_SCALE;
  const reach = (footprint - plinth) / 2;
  const mid = plinth / 2 + reach / 2;
  const room = Math.floor((plinth - 2 * PIN_MARGIN) / PIN_PITCH) + 1;
  const sides: [number, number, number][] = [
    // [pins, x direction, z direction] of the side's outward normal.
    [pins.north, 0, -1],
    [pins.south, 0, 1],
    [pins.east, 1, 0],
    [pins.west, -1, 0],
  ];
  for (const [wanted, nx, nz] of sides) {
    const count = Math.min(wanted, room);
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * PIN_PITCH;
      out.push({
        buildingId,
        kind: "pin",
        cx: nx * mid + (nz === 0 ? 0 : along),
        cy: PIN_HEIGHT / 2,
        cz: nz * mid + (nx === 0 ? 0 : along),
        sx: nx === 0 ? PIN_WIDTH : reach,
        sy: PIN_HEIGHT,
        sz: nz === 0 ? PIN_WIDTH : reach,
      });
    }
  }
}

/** A box centred on the building's axis, from `bottom` up by `height`. */
const column = (
  buildingId: string,
  kind: FloorCellKind,
  width: number,
  bottom: number,
  height: number
): FloorCell => ({
  buildingId,
  kind,
  cx: 0,
  cy: bottom + height / 2,
  cz: 0,
  sx: width,
  sy: height,
  sz: width,
});

/** The parts of one building, relative to its own ground point, and its height. */
function buildingParts(
  node: SchemaNode,
  footprint: number,
  connections: Connections
): { cells: FloorCell[]; windows: WindowCell[]; height: number } {
  const { id } = node;
  const cells: FloorCell[] = [
    column(id, "plinth", footprint * PLINTH_SCALE, 0, PLINTH_HEIGHT),
  ];
  const windows: WindowCell[] = [];
  pushPins(cells, id, footprint, connections.pins.get(id) ?? NO_PINS);
  const role = roleOf(node, connections);
  const slab = footprint * SLAB_SCALE;

  // Element Types are one low block, never stacked into floors.
  if (role === "element") {
    cells.push(column(id, "element", slab, PLINTH_HEIGHT, ELEMENT_HEIGHT));
    const top = PLINTH_HEIGHT + ELEMENT_HEIGHT;
    pushMarkers(cells, node, slab, top);
    return { cells, windows, height: top };
  }

  // medium.json is exported before the backend fills in groups, same gap
  // city.ts already guards against for floor counts.
  const groups = node.groups?.length ? node.groups : [UNGROUPED];
  let y = PLINTH_HEIGHT;
  groups.forEach((group, i) => {
    // A new tab is a board in the gap, wider than the slabs, so a tab break shows
    // from any side. A group inside a tab only leaves the gap.
    if (i > 0 && group.type === "Tab")
      cells.push(
        column(
          id,
          "separator",
          footprint * SEPARATOR_SCALE,
          y + (GAP - SEPARATOR_HEIGHT) / 2,
          SEPARATOR_HEIGHT
        )
      );
    y += GAP;
    const kind =
      role === "composition" || group.fromCompositionId ? "composed" : "own";
    cells.push(column(id, kind, slab, y, SLAB_HEIGHT));
    pushWindows(windows, group, kind, id, slab, y + SLAB_HEIGHT / 2);
    y += SLAB_HEIGHT;
  });

  // A composition is a hollow shell: no core, and no lid, because nothing is ever
  // made from it that a template could render.
  if (role === "composition") {
    pushMarkers(cells, node, slab, y);
    return { cells, windows, height: y };
  }
  // The core stops inside the top slab: level with its roof, the two faces would
  // fight for the same pixels, and through a composed slab that shows as stripes.
  cells.push(
    column(
      id,
      "core",
      footprint * CORE_SCALE,
      PLINTH_HEIGHT,
      y - SLAB_HEIGHT / 2 - PLINTH_HEIGHT
    ),
    column(
      id,
      node.templates?.length ? "litLid" : "lid",
      footprint * LID_SCALE,
      y,
      LID_HEIGHT
    )
  );
  y += LID_HEIGHT;
  pushMarkers(cells, node, footprint * LID_SCALE, y);
  return { cells, windows, height: y };
}

/**
 * A dot on the north-west corner of the roof when the type varies by culture, and
 * one on the north-east corner when it varies by segment, where a chip marks pin 1.
 */
function pushMarkers(
  out: FloorCell[],
  node: SchemaNode,
  roof: number,
  top: number
) {
  const inset = roof / 2 - MARKER_SIZE;
  const at = (x: number) =>
    out.push({
      buildingId: node.id,
      kind: "marker",
      cx: x,
      cy: top + MARKER_SIZE / 4,
      cz: -inset,
      sx: MARKER_SIZE,
      sy: MARKER_SIZE / 2,
      sz: MARKER_SIZE,
    });
  if (node.variesByCulture) at(-inset);
  if (node.variesBySegment) at(inset);
}

/**
 * Every part of every building, one window per property on the wall of its group's
 * slab, plus the total height of each building for its hit box and label.
 */
export function buildFloorCells(
  nodesById: Map<string, SchemaNode>,
  placements: Placement[],
  connections: Connections = NO_CONNECTIONS
): { cells: FloorCell[]; windows: WindowCell[]; heights: Map<string, number> } {
  const cells: FloorCell[] = [];
  const windows: WindowCell[] = [];
  const heights = new Map<string, number>();

  for (const placement of placements) {
    const node = nodesById.get(placement.id);
    if (!node) continue;
    const { x, z } = placement.position;
    const parts = buildingParts(node, placement.footprint, connections);
    // Every part of a flattened building is squashed by the same factor, so the
    // stack keeps its proportions on the way down to a plate.
    const squash = squashOf(placement.flatten ?? 0, parts.height);
    // The focus layout stands compositions on a platform, so a building starts at
    // its own ground rather than at zero.
    const base = placement.y ?? 0;

    for (const cell of parts.cells)
      cells.push({
        ...cell,
        cx: x + cell.cx,
        cy: base + cell.cy * squash,
        cz: z + cell.cz,
        sy: cell.sy * squash,
      });
    // A plate has no walls worth lighting, so its windows go with its height.
    if (squash > 0.5)
      for (const window of parts.windows)
        windows.push({
          ...window,
          cx: x + window.cx,
          cy: base + window.cy * squash,
          cz: z + window.cz,
        });
    heights.set(placement.id, parts.height * squash);
  }

  return { cells, windows, heights };
}

/** How much of its height a building keeps: 1 at rest, `PLATE_HEIGHT` when flat. */
function squashOf(flatten: number, height: number): number {
  if (flatten <= 0 || height <= 0) return 1;
  return 1 + (PLATE_HEIGHT / height - 1) * Math.min(flatten, 1);
}

/** A flat plaza disc under every root building that is not an Element Type. */
export function buildPlazaCells(
  nodesById: Map<string, SchemaNode>,
  placements: Placement[]
): PlazaCell[] {
  const plazas: PlazaCell[] = [];
  for (const placement of placements) {
    const node = nodesById.get(placement.id);
    if (!node?.allowedAsRoot || node.isElement) continue;
    plazas.push({
      buildingId: placement.id,
      cx: placement.position.x,
      cy: placement.y ?? 0,
      cz: placement.position.z,
      radius: placement.footprint / 2 + PLAZA_MARGIN,
    });
  }
  return plazas;
}
