// Builds one merged, non-indexed triangle list for every allowedChild edge, so
// the scene draws every road in a single mesh. Pure: no three.js, no React.
import type { SchemaEdge } from "../../model/types";
import type { Placement } from "../layout/city";

export type RoadRange = { edge: SchemaEdge; start: number; count: number };

const ROAD_WIDTH = 0.3;
const ROAD_Y = 0.015;
const CHEVRON_Y = 0.02;
const CHEVRON_SPACING = 1.4;
const CHEVRON_LENGTH = 0.4;
const CHEVRON_HALF_WIDTH = 0.16;
const LOOP_GAP = 0.5;
const LOOP_RADIUS = 0.35;
const LOOP_THICKNESS = 0.12;
const LOOP_SEGMENTS = 14;

/**
 * `positions` is a flat xyz triangle list. `ranges` marks which vertices came
 * from which edge, in the same units, so the scene can recolour one edge's
 * road on selection without rebuilding the geometry.
 */
export function buildRoadGeometry(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[],
): { positions: Float32Array; ranges: RoadRange[] } {
  const positions: number[] = [];
  const ranges: RoadRange[] = [];

  for (const edge of edges) {
    // M2 draws the other edge kinds as bridges and dashed lines.
    if (edge.kind !== "allowedChild") continue;
    const from = placementsById.get(edge.from);
    const to = placementsById.get(edge.to);
    if (!from || !to) continue;

    const start = positions.length / 3;
    if (edge.from === edge.to) pushLoop(positions, from);
    else pushRoad(positions, from, to);
    ranges.push({ edge, start, count: positions.length / 3 - start });
  }

  return { positions: new Float32Array(positions), ranges };
}

function pushRoad(positions: number[], from: Placement, to: Placement) {
  const dx = to.position.x - from.position.x;
  const dz = to.position.z - from.position.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return;
  const dirX = dx / length;
  const dirZ = dz / length;
  const perpX = -dirZ;
  const perpZ = dirX;

  // The ribbon runs from one building's footprint edge to the other's, not
  // centre to centre, so it never runs under either building.
  const startX = from.position.x + dirX * (from.footprint / 2);
  const startZ = from.position.z + dirZ * (from.footprint / 2);
  const endX = to.position.x - dirX * (to.footprint / 2);
  const endZ = to.position.z - dirZ * (to.footprint / 2);
  const spanX = endX - startX;
  const spanZ = endZ - startZ;
  const span = Math.hypot(spanX, spanZ);
  if (span < 1e-6) return;

  const halfWidth = ROAD_WIDTH / 2;
  pushQuad(
    positions,
    startX + perpX * halfWidth, ROAD_Y, startZ + perpZ * halfWidth,
    startX - perpX * halfWidth, ROAD_Y, startZ - perpZ * halfWidth,
    endX - perpX * halfWidth, ROAD_Y, endZ - perpZ * halfWidth,
    endX + perpX * halfWidth, ROAD_Y, endZ + perpZ * halfWidth,
  );

  const steps = Math.max(1, Math.floor(span / CHEVRON_SPACING));
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    pushChevron(positions, startX + spanX * t, startZ + spanZ * t, dirX, dirZ, perpX, perpZ);
  }
}

function pushChevron(
  positions: number[],
  px: number,
  pz: number,
  dirX: number,
  dirZ: number,
  perpX: number,
  perpZ: number,
) {
  const tipX = px + dirX * (CHEVRON_LENGTH / 2);
  const tipZ = pz + dirZ * (CHEVRON_LENGTH / 2);
  const backX = px - dirX * (CHEVRON_LENGTH / 2);
  const backZ = pz - dirZ * (CHEVRON_LENGTH / 2);
  pushTriangle(
    positions,
    tipX, CHEVRON_Y, tipZ,
    backX + perpX * CHEVRON_HALF_WIDTH, CHEVRON_Y, backZ + perpZ * CHEVRON_HALF_WIDTH,
    backX - perpX * CHEVRON_HALF_WIDTH, CHEVRON_Y, backZ - perpZ * CHEVRON_HALF_WIDTH,
  );
}

/** A type that allows itself as a child draws as a small ring beside the building. */
function pushLoop(positions: number[], at: Placement) {
  const cx = at.position.x + at.footprint / 2 + LOOP_GAP;
  const cz = at.position.z;
  const inner = LOOP_RADIUS - LOOP_THICKNESS / 2;
  const outer = LOOP_RADIUS + LOOP_THICKNESS / 2;
  for (let i = 0; i < LOOP_SEGMENTS; i++) {
    const a0 = (i / LOOP_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / LOOP_SEGMENTS) * Math.PI * 2;
    pushQuad(
      positions,
      cx + Math.cos(a0) * outer, ROAD_Y, cz + Math.sin(a0) * outer,
      cx + Math.cos(a0) * inner, ROAD_Y, cz + Math.sin(a0) * inner,
      cx + Math.cos(a1) * inner, ROAD_Y, cz + Math.sin(a1) * inner,
      cx + Math.cos(a1) * outer, ROAD_Y, cz + Math.sin(a1) * outer,
    );
  }
}

function pushTriangle(
  positions: number[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
) {
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

// ponytail: winding order is not worth tracking here. Scene.tsx renders the
// road material double-sided instead, which costs nothing on this little geometry.
function pushQuad(
  positions: number[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
) {
  pushTriangle(positions, ax, ay, az, bx, by, bz, cx, cy, cz);
  pushTriangle(positions, ax, ay, az, cx, cy, cz, dx, dy, dz);
}
