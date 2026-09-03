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

export type PlazaCell = {
  buildingId: string;
  cx: number;
  /** The ground the building stands on, which the focus layout can raise. */
  cy: number;
  cz: number;
  radius: number;
};

export const FLOOR_HEIGHT = 0.6;
const SEPARATOR_HEIGHT = 0.06;
const ELEMENT_HEIGHT = FLOOR_HEIGHT;
const PLAZA_MARGIN = 0.6;

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
 * One instance per floor, tab separator or element warehouse box, plus the
 * total mass height of each building for its hit box and label height.
 */
export function buildFloorCells(
  nodesById: Map<string, SchemaNode>,
  placements: Placement[],
): { cells: FloorCell[]; heights: Map<string, number> } {
  const cells: FloorCell[] = [];
  const heights = new Map<string, number>();

  for (const placement of placements) {
    const node = nodesById.get(placement.id);
    if (!node) continue;
    const { x, z } = placement.position;
    const footprint = placement.footprint;
    // The focus layout stands compositions on a platform, so a building's floors
    // start at its own ground rather than at zero.
    const base = placement.y ?? 0;

    if (node.isElement) {
      // Element Types are the warehouse form: low, wide, amber, no roof cap,
      // never stacked into floors.
      cells.push({
        buildingId: placement.id,
        kind: "element",
        cx: x,
        cy: base + ELEMENT_HEIGHT / 2,
        cz: z,
        sx: footprint,
        sy: ELEMENT_HEIGHT,
        sz: footprint,
      });
      heights.set(placement.id, ELEMENT_HEIGHT);
      continue;
    }

    // medium.json is exported before the backend fills in groups, same gap
    // city.ts already guards against for floor counts.
    const groups = node.groups?.length ? node.groups : [UNGROUPED];
    let y = 0;
    groups.forEach((group, i) => {
      // A new tab is a physical break in the building, marked by a thin
      // darker slab. The first floor sits straight on the ground.
      if (i > 0 && group.type === "Tab") {
        cells.push({
          buildingId: placement.id,
          kind: "separator",
          cx: x,
          cy: base + y + SEPARATOR_HEIGHT / 2,
          cz: z,
          sx: footprint,
          sy: SEPARATOR_HEIGHT,
          sz: footprint,
        });
        y += SEPARATOR_HEIGHT;
      }
      cells.push({
        buildingId: placement.id,
        kind: group.fromCompositionId ? "composed" : "own",
        cx: x,
        cy: base + y + FLOOR_HEIGHT / 2,
        cz: z,
        sx: footprint,
        sy: FLOOR_HEIGHT,
        sz: footprint,
      });
      y += FLOOR_HEIGHT;
    });
    heights.set(placement.id, y);
  }

  return { cells, heights };
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
