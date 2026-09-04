// Where a district's name goes on its island. Pure: no three.js, no React, no DOM.
//
// The name is printed on the ground and writes no depth, so anything standing on the
// island draws over it. Reserving a band along one edge and hoping is what put names
// under buildings and under road runs while the same island had empty ground to
// spare, so the spot is searched for instead: the island is rasterised into a grid of
// what is taken, and the name goes in the largest clear rectangle that holds it.
import type { SchemaEdge } from "../../model/types";
import type { Placement } from "../layout/city";
import { planRoads, roadGrid, routePoints } from "./roads";

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
/** A straight run of a road or a ground link, in world units. */
export type Run = { x0: number; z0: number; x1: number; z1: number };
/**
 * Where the name lies, in world units. `rotation` is turned about the ground normal:
 * 0 reads east, a quarter turn reads north. Those are the only two of the four
 * quarter turns that are the right way up under the default camera.
 */
export type Nameplate = {
  x: number;
  z: number;
  width: number;
  height: number;
  rotation: number;
};

/** Cap heights the search tries, largest first. */
const CAPS = [4, 3.5, 3, 2.5];
/** Cap height a name is printed at when the island has room for it. */
export const NAMEPLATE_CAP = CAPS[0] as number;
/** Clear ground kept around the letters on every side. */
const MARGIN = 0.5;
/**
 * One world unit per cell. A building is two units square and a street is nine, so a
 * unit is fine enough to find the gaps and coarse enough that the whole scan is a
 * few thousand cells per island.
 */
const CELL = 1;
/**
 * How much ground a building of height 1 hides behind itself. At the isometric angle
 * the point (0, 1, 0) draws where the ground point (-1, 0, -1) does, so a roof
 * throws its face that far north of its own footprint.
 */
const LEAN = Math.SQRT2;
/** North, west, south, east, then the middle: the order a tie is settled in. */
const EDGE_RANK = 4;

/**
 * Every straight ground run in the city: the roads, and the street stretches of the
 * block and reference links, which follow the same routes. Composition arcs are over
 * the roofs and cross no ground a name could stand on.
 */
export function groundRuns(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): Run[] {
  const runs: Run[] = planRoads(placementsById, edges).map((segment) => ({
    x0: segment.x0,
    z0: segment.z0,
    x1: segment.x1,
    z1: segment.z1,
  }));
  const grid = roadGrid(placementsById.values());
  const drawn = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "block" && edge.kind !== "reference") continue;
    const pair = `${edge.from}|${edge.to}`;
    if (edge.from === edge.to || drawn.has(pair)) continue;
    const from = placementsById.get(edge.from);
    const to = placementsById.get(edge.to);
    if (!(from && to)) continue;
    drawn.add(pair);
    const points = routePoints(grid, from, to);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; z: number };
      const b = points[i] as { x: number; z: number };
      runs.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z });
    }
  }
  return runs;
}

/** What the island holds, one cell at a time, with a summed-area table over it. */
function occupancy(island: Rect, buildings: Placement[], runs: Run[]) {
  const cols = Math.max(1, Math.ceil((island.maxX - island.minX) / CELL));
  const rows = Math.max(1, Math.ceil((island.maxZ - island.minZ) / CELL));
  const busy = new Uint8Array(cols * rows);
  const cell = (value: number, origin: number) =>
    Math.floor((value - origin) / CELL);
  const mark = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    const i0 = Math.max(0, cell(minX, island.minX));
    const i1 = Math.min(cols - 1, cell(maxX, island.minX));
    const j0 = Math.max(0, cell(minZ, island.minZ));
    const j1 = Math.min(rows - 1, cell(maxZ, island.minZ));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) busy[j * cols + i] = 1;
  };

  for (const placement of buildings) {
    const half = placement.footprint / 2;
    const lean = LEAN * placement.height;
    // The footprint, plus the ground its face hides north of it.
    mark(
      placement.position.x - half,
      placement.position.x + half,
      placement.position.z - half - lean,
      placement.position.z + half
    );
  }
  for (const run of runs) {
    // A ribbon and its chevrons are about a unit across, which is one cell, so the
    // centre line walked in half cells covers the ground the run reads on.
    const steps = Math.ceil(
      Math.hypot(run.x1 - run.x0, run.z1 - run.z0) / (CELL / 2)
    );
    for (let step = 0; step <= steps; step++) {
      const t = steps === 0 ? 0 : step / steps;
      const x = run.x0 + (run.x1 - run.x0) * t;
      const z = run.z0 + (run.z1 - run.z0) * t;
      mark(x, x, z, z);
    }
  }

  // Summed-area table, so any rectangle is four lookups however big it is.
  const stride = cols + 1;
  const sums = new Int32Array(stride * (rows + 1));
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      sums[(j + 1) * stride + i + 1] =
        (busy[j * cols + i] as number) +
        (sums[j * stride + i + 1] as number) +
        (sums[(j + 1) * stride + i] as number) -
        (sums[j * stride + i] as number);
    }
  }
  const clear = (i: number, j: number, w: number, h: number) =>
    (sums[(j + h) * stride + i + w] as number) -
      (sums[j * stride + i + w] as number) -
      (sums[(j + h) * stride + i] as number) +
      (sums[j * stride + i] as number) ===
    0;
  return { cols, rows, clear };
}

/** The name against the island's north edge, shrunk to fit, when nothing else fits. */
function northBand(island: Rect, aspect: number): Nameplate {
  let height = NAMEPLATE_CAP;
  let width = height * aspect;
  const fit = Math.min(1, (island.maxX - island.minX - MARGIN * 2) / width);
  width *= fit;
  height *= fit;
  return {
    x: island.minX + MARGIN + width / 2,
    z: island.minZ + MARGIN + height / 2,
    width,
    height,
    rotation: 0,
  };
}

/**
 * Where a district's name fits on its island: the clear rectangle that holds it at
 * the biggest cap height it can, tried against the four edges first and the middle of
 * the island after. `island` is the district's box with its padding, `buildings` and
 * `runs` are everything standing on the city (whatever falls outside the island is
 * clipped by the scan), and `aspect` is the rasterised name's width over its cap.
 *
 * A strip along an edge is where a name reads as the island's title, so an edge spot
 * wins over one in the middle at the same size, north first and then west, south and
 * east; a tie inside one of those goes to the spot nearest the north-west corner. A
 * name only reads along an edge it is parallel to, so the two flanks are searched
 * with the name turned a quarter turn, which is the one turn that is not upside down.
 *
 * ponytail: a one-unit grid and a scan of every position on it, rather than a
 * rectangle packer. The summed-area table makes each position four lookups, so the
 * biggest island in either fixture is a few thousand of them per cap height, and the
 * whole city is searched once per layout. Falls back to the north band, which is what
 * every island used to get whether or not it was clear.
 */
export function findNameplate(
  island: Rect,
  buildings: Placement[],
  runs: Run[],
  aspect: number
): Nameplate {
  const { cols, rows, clear } = occupancy(island, buildings, runs);

  for (const cap of CAPS) {
    const long = cap * aspect + MARGIN * 2;
    const short = cap + MARGIN * 2;
    let best: { rank: number; reach: number; spot: Nameplate } | null = null;

    for (const rotation of [0, Math.PI / 2]) {
      const alongX = rotation === 0;
      const w = Math.ceil((alongX ? long : short) / CELL);
      const h = Math.ceil((alongX ? short : long) / CELL);
      if (w > cols || h > rows) continue;
      for (let j = 0; j + h <= rows; j++) {
        for (let i = 0; i + w <= cols; i++) {
          if (!clear(i, j, w, h)) continue;
          const rank =
            alongX && j === 0
              ? 0
              : !alongX && i === 0
                ? 1
                : alongX && j + h === rows
                  ? 2
                  : !alongX && i + w === cols
                    ? 3
                    : EDGE_RANK;
          const reach = i * i + j * j;
          if (
            best &&
            (best.rank < rank || (best.rank === rank && best.reach <= reach))
          )
            continue;
          best = {
            rank,
            reach,
            spot: {
              x: island.minX + (i + w / 2) * CELL,
              z: island.minZ + (j + h / 2) * CELL,
              width: cap * aspect,
              height: cap,
              rotation,
            },
          };
        }
      }
    }
    if (best) return best.spot;
  }

  return northBand(island, aspect);
}
