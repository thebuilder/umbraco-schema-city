// Turns placements and their nodes into floor boxes for the instanced meshes.
// Pure: no three.js, no React, no DOM. Scene.tsx owns the actual geometry and
// materials; this only decides where each box goes and what it is.
import type { PropertyGroup, SchemaNode } from "../../model/types";
import type { Placement } from "../layout/city";

export type FloorCellKind = "own" | "composed" | "separator" | "element";

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

export const FLOOR_HEIGHT = 0.6;
export const WINDOW_WIDTH = 0.16;
export const WINDOW_HEIGHT = 0.24;
/** Smallest distance between two window centres. A longer row is cut off here. */
const WINDOW_PITCH = 0.28;
/** How far a window stands off the wall, so the two never z-fight. */
const WINDOW_STANDOFF = 0.012;
const SEPARATOR_HEIGHT = 0.06;
const ELEMENT_HEIGHT = FLOOR_HEIGHT;
const PLAZA_MARGIN = 0.6;
/** What a building's whole mass comes to once focus mode has pressed it flat. */
export const PLATE_HEIGHT = 0.1;

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
 * The windows on one floor: one per property in the group, walked around the four
 * walls from the middle of the front one. Two properties put one window on the front
 * wall and one on the back, which is what a row of them wrapping looks like.
 *
 * ponytail: past `footprint * 4 / WINDOW_PITCH` windows the row would draw on top of
 * itself, so it stops there. That is 28 properties in one group on the smallest
 * building, against 8 in the busiest group of the seeded schema. Two rows of windows
 * per floor is the fix if a schema ever passes it.
 */
function pushWindows(
  out: WindowCell[],
  group: PropertyGroup,
  buildingId: string,
  footprint: number,
  x: number,
  y: number,
  z: number,
) {
  const perimeter = footprint * 4;
  const count = Math.min(group.properties?.length ?? 0, Math.floor(perimeter / WINDOW_PITCH));
  const half = footprint / 2 + WINDOW_STANDOFF;

  for (let i = 0; i < count; i++) {
    const at = ((i + 0.5) / count) * perimeter;
    const wall = Math.floor(at / footprint);
    const along = (at % footprint) - footprint / 2;
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
      kind: group.fromCompositionId ? "composed" : "own",
      mandatory: group.properties[i]?.mandatory ?? false,
      cx: x + cx,
      cy: y,
      cz: z + cz,
      rotY,
    });
  }
}

/**
 * One instance per floor, tab separator or element warehouse box, one per property
 * on the wall of its group's floor, plus the total mass height of each building for
 * its hit box and label height.
 */
export function buildFloorCells(
  nodesById: Map<string, SchemaNode>,
  placements: Placement[],
): { cells: FloorCell[]; windows: WindowCell[]; heights: Map<string, number> } {
  const cells: FloorCell[] = [];
  const windows: WindowCell[] = [];
  const heights = new Map<string, number>();

  for (const placement of placements) {
    const node = nodesById.get(placement.id);
    if (!node) continue;
    const { x, z } = placement.position;
    const footprint = placement.footprint;
    // Every floor of a flattened building is squashed by the same factor, so the
    // stack keeps its proportions on the way down to a plate.
    const flatten = placement.flatten ?? 0;
    // The focus layout stands compositions on a platform, so a building's floors
    // start at its own ground rather than at zero.
    const base = placement.y ?? 0;

    if (node.isElement) {
      // Element Types are the warehouse form: low, wide, amber, no roof cap,
      // never stacked into floors.
      const squash = squashOf(flatten, ELEMENT_HEIGHT);
      cells.push({
        buildingId: placement.id,
        kind: "element",
        cx: x,
        cy: base + (ELEMENT_HEIGHT / 2) * squash,
        cz: z,
        sx: footprint,
        sy: ELEMENT_HEIGHT * squash,
        sz: footprint,
      });
      heights.set(placement.id, ELEMENT_HEIGHT * squash);
      continue;
    }

    // medium.json is exported before the backend fills in groups, same gap
    // city.ts already guards against for floor counts.
    const groups = node.groups?.length ? node.groups : [UNGROUPED];
    const squash = squashOf(flatten, massOf(groups));
    let y = 0;
    groups.forEach((group, i) => {
      // A new tab is a physical break in the building, marked by a thin
      // darker slab. The first floor sits straight on the ground.
      if (i > 0 && group.type === "Tab") {
        cells.push({
          buildingId: placement.id,
          kind: "separator",
          cx: x,
          cy: base + (y + SEPARATOR_HEIGHT / 2) * squash,
          cz: z,
          sx: footprint,
          sy: SEPARATOR_HEIGHT * squash,
          sz: footprint,
        });
        y += SEPARATOR_HEIGHT;
      }
      cells.push({
        buildingId: placement.id,
        kind: group.fromCompositionId ? "composed" : "own",
        cx: x,
        cy: base + (y + FLOOR_HEIGHT / 2) * squash,
        cz: z,
        sx: footprint,
        sy: FLOOR_HEIGHT * squash,
        sz: footprint,
      });
      // A plate has no walls worth lighting, so its windows go with its height.
      if (squash > 0.5) {
        pushWindows(windows, group, placement.id, footprint, x, base + (y + FLOOR_HEIGHT / 2) * squash, z);
      }
      y += FLOOR_HEIGHT;
    });
    heights.set(placement.id, y * squash);
  }

  return { cells, windows, heights };
}

/** The mass a stack of groups comes to, separators included. */
function massOf(groups: PropertyGroup[]): number {
  const tabs = groups.filter((group, i) => i > 0 && group.type === "Tab").length;
  return groups.length * FLOOR_HEIGHT + tabs * SEPARATOR_HEIGHT;
}

/** How much of its height a building keeps: 1 at rest, `PLATE_HEIGHT` when flat. */
function squashOf(flatten: number, height: number): number {
  if (flatten <= 0 || height <= 0) return 1;
  return 1 + (PLATE_HEIGHT / height - 1) * Math.min(flatten, 1);
}

/** A flat plaza disc under every root building that is not an Element Type. */
export function buildPlazaCells(
  nodesById: Map<string, SchemaNode>,
  placements: Placement[],
): PlazaCell[] {
  const plazas: PlazaCell[] = [];
  for (const placement of placements) {
    const node = nodesById.get(placement.id);
    if (!node || !node.allowedAsRoot || node.isElement) continue;
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
