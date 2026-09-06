// Roads follow the streets. A road leaves its parent's face, drops to the street
// between the two rows, runs along that street to the child's column and enters the
// child's face, so every run is either north-south or east-west. Roads from one
// parent share the street run, which is what collapses a hub's fan into one trunk
// that forks at each child's column. Pure: no three.js, no React.
import type { SchemaEdge } from "../../model/types";
import { cityBounds, type Placement, STREET } from "../layout/city";
import { FOLDER_TINT_HEIGHT } from "./stage";

export type RoadRange = { edges: SchemaEdge[]; start: number; count: number };

/** One axis-aligned run of road on the ground, after overlapping runs are merged. */
export type RoadSegment = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Every edge that routes over this run. A merged trunk carries several. */
  edges: SchemaEdge[];
  /** The building this run ends at, when it is the last run before a child. */
  into: { x: number; z: number } | null;
  width?: number;
};

/**
 * The rows of buildings and the streets between them, read off the placements.
 *
 * A row is a band of z that buildings occupy, so anything between two bands is
 * ground no building stands on. Structure routes use each district's own grid;
 * combining unrelated islands can erase valid local streets when their rows overlap.
 * Cross-island connectors join those local grids through the space between boards.
 */
export type RoadGrid = {
  /** Street mid-lines, north to south. Street `i` runs above row `i`. */
  streets: number[];
  /** How far a lane may sit off street `i` before it touches the row beside it. */
  halves: number[];
  /** The row a z sits in, or the nearest one when it sits in a street. */
  rowAt: (z: number) => number;
  placements: Placement[];
};

// Wide enough to survive overview rasterization; busy streets still cap each
// ribbon below its lane spacing so widening does not join unrelated traces.
const ROAD_WIDTH = 0.3;
const ROAD_Y = FOLDER_TINT_HEIGHT + 0.03;
const CHEVRON_Y = ROAD_Y + 0.01;
const CHEVRON_SPACING = 1.4;
/**
 * How much of the run before a child carries chevrons. A rank-skipping road descends
 * the whole district in one run, and chevroning all of it reads as a dashed line
 * rather than as an arrow into the building at the end.
 */
const CHEVRON_RUN = 4.2;
const CHEVRON_LENGTH = 0.4;
const CHEVRON_HALF_WIDTH = 0.16;
const LOOP_GAP = 0.5;
const LOOP_RADIUS = 0.35;
const LOOP_THICKNESS = 0.12;
const LOOP_SEGMENTS = 14;
const EPS = 1e-6;
/** More allowed parents than this and the overview draws one road and a count. */
const FAN_LIMIT = 3;

/**
 * `positions` is a flat xyz triangle list. `ranges` marks which vertices came from
 * which edges, in the same units, so the scene can recolour one edge's road on
 * selection without rebuilding the geometry. A merged trunk lists every edge that
 * runs over it and lights when any of them is selected.
 */
export function buildRoadGeometry(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): { positions: Float32Array; ranges: RoadRange[] } {
  const positions: number[] = [];
  const ranges: RoadRange[] = [];

  for (const segment of planRoads(placementsById, edges)) {
    const start = positions.length / 3;
    pushSegment(positions, segment);
    ranges.push({
      edges: segment.edges,
      start,
      count: positions.length / 3 - start,
    });
  }

  for (const edge of edges) {
    // M2 draws the other edge kinds as bridges and dashed lines.
    if (edge.kind !== "allowedChild" || edge.from !== edge.to) continue;
    const at = placementsById.get(edge.from);
    if (!at) continue;
    const start = positions.length / 3;
    pushLoop(positions, at);
    ranges.push({ edges: [edge], start, count: positions.length / 3 - start });
  }

  return { positions: new Float32Array(positions), ranges };
}

/** Every road as axis-aligned runs, with runs that lie on top of each other merged. */
export function planRoads(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): RoadSegment[] {
  const runs: RoadSegment[] = [];
  const laneOf = new Map<string, number>();
  const channels = new Map<string, { low: number; high: number }[][]>();
  const candidates = roadCandidates(placementsById, edges);
  const parentSpans = new Map<
    string,
    {
      trunk: number;
      parent: string;
      gridKey: string;
      low: number;
      high: number;
    }
  >();
  for (const { edge, from, to, trunk, gridKey } of candidates) {
    const key = `${gridKey}|${trunk}|${edge.from}`;
    const span = parentSpans.get(key);
    const low = Math.min(from.position.x, to.position.x);
    const high = Math.max(from.position.x, to.position.x);
    if (span) {
      span.low = Math.min(span.low, low);
      span.high = Math.max(span.high, high);
    } else {
      parentSpans.set(key, { trunk, parent: edge.from, gridKey, low, high });
    }
  }
  for (const { trunk, parent, gridKey, low, high } of [
    ...parentSpans.values(),
  ].sort(
    (a, b) =>
      a.gridKey.localeCompare(b.gridKey) ||
      a.trunk - b.trunk ||
      a.low - b.low ||
      a.high - b.high ||
      a.parent.localeCompare(b.parent)
  )) {
    const key = `${gridKey}|${trunk}|${parent}`;
    const channelKey = `${gridKey}|${trunk}`;
    const used = channels.get(channelKey) ?? [];
    let lane = 0;
    while (
      used[lane]?.some((span) => span.low < high - EPS && span.high > low + EPS)
    )
      lane++;
    used[lane] ??= [];
    used[lane].push({ low, high });
    channels.set(channelKey, used);
    laneOf.set(key, lane);
  }
  for (const {
    edge,
    from,
    to,
    grid: selectedGrid,
    gridKey,
    trunk,
    bridge,
    targetGrid,
  } of candidates) {
    const key = `${gridKey}|${trunk}|${edge.from}`;
    const lane = laneOf.get(key) ?? 0;
    const count = channels.get(`${gridKey}|${trunk}`)?.length ?? 1;
    const half = selectedGrid.halves[trunk] ?? 0;
    const targetHalf = bridge
      ? (targetGrid.halves[portStreet(targetGrid, to, from)] ?? half)
      : half;
    const spacing = (Math.min(half, targetHalf) * 2) / (count + 1);
    const normalizedLane = -1 + (2 * (lane + 1)) / (count + 1);
    const offset = half * normalizedLane;

    const points = bridge
      ? bridgePoints(selectedGrid, targetGrid, from, to, bridge, normalizedLane)
      : routePoints(selectedGrid, from, to, offset);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; z: number };
      const b = points[i] as { x: number; z: number };
      if (Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS) continue;
      runs.push({
        x0: a.x,
        z0: a.z,
        x1: b.x,
        z1: b.z,
        edges: [edge],
        width: Math.min(ROAD_WIDTH, spacing * 0.8),
        into:
          i === points.length - 1
            ? { x: to.position.x, z: to.position.z }
            : null,
      });
    }
  }

  return mergeRuns(runs);
}

/** Choose real streets before allocating channels; unrelated islands cannot alter them. */
function roadCandidates(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
) {
  const grids = new Map<string, RoadGrid>();
  for (const placement of placementsById.values()) {
    if (!grids.has(placement.district)) {
      grids.set(
        placement.district,
        roadGrid(
          [...placementsById.values()].filter(
            (candidate) => candidate.district === placement.district
          )
        )
      );
    }
  }
  return edges
    .filter((edge) => edge.kind === "allowedChild" && edge.from !== edge.to)
    .map((edge) => {
      const from = placementsById.get(edge.from);
      const to = placementsById.get(edge.to);
      if (!(from && to)) return null;
      const sourceGrid = grids.get(from.district) as RoadGrid;
      const targetGrid = grids.get(to.district) as RoadGrid;
      const bridge = bridgeGap(sourceGrid, targetGrid);
      const selectedGrid =
        sourceGrid === targetGrid || bridge
          ? sourceGrid
          : roadGrid([...sourceGrid.placements, ...targetGrid.placements]);
      const trunk = bridge
        ? portStreet(sourceGrid, from, to)
        : (streetsBetween(selectedGrid, from, to)[0] as number);
      return {
        edge,
        from,
        to,
        grid: selectedGrid,
        gridKey:
          selectedGrid === sourceGrid
            ? from.district
            : [from.district, to.district].sort().join("/"),
        targetGrid,
        bridge,
        trunk,
      };
    })
    .filter(
      (candidate): candidate is NonNullable<typeof candidate> =>
        candidate !== null
    )
    .sort(
      (a, b) =>
        a.gridKey.localeCompare(b.gridKey) ||
        a.trunk - b.trunk ||
        a.from.position.x - b.from.position.x ||
        a.to.position.x - b.to.position.x ||
        a.edge.from.localeCompare(b.edge.from) ||
        a.edge.to.localeCompare(b.edge.to)
    );
}

/** Side-by-side islands connect through the gap, using each island's own streets. */
function bridgeGap(
  from: RoadGrid,
  to: RoadGrid
): { low: number; high: number } | null {
  if (from === to) return null;
  const a = cityBounds(from.placements);
  const b = cityBounds(to.placements);
  if (a.centre.x + a.width / 2 + 1 < b.centre.x - b.width / 2)
    return { low: a.centre.x + a.width / 2, high: b.centre.x - b.width / 2 };
  if (b.centre.x + b.width / 2 + 1 < a.centre.x - a.width / 2)
    return { low: b.centre.x + b.width / 2, high: a.centre.x - a.width / 2 };
  return null;
}

function portStreet(grid: RoadGrid, at: Placement, toward: Placement): number {
  return grid.rowAt(at.position.z) + Number(toward.position.z >= at.position.z);
}

function bridgePoints(
  source: RoadGrid,
  target: RoadGrid,
  from: Placement,
  to: Placement,
  gap: { low: number; high: number },
  lane: number
): { x: number; z: number }[] {
  const start = portStreet(source, from, to);
  const end = portStreet(target, to, from);
  const startZ = source.streets[start] + lane * source.halves[start];
  const endZ = target.streets[end] + lane * target.halves[end];
  const corridor =
    (gap.low + gap.high) / 2 +
    lane * Math.min(2, (gap.high - gap.low) / 2 - ROAD_WIDTH);
  return [
    {
      x: from.position.x,
      z:
        from.position.z +
        (Math.sign(startZ - from.position.z) * from.footprint) / 2,
    },
    { x: from.position.x, z: startZ },
    { x: corridor, z: startZ },
    { x: corridor, z: endZ },
    { x: to.position.x, z: endZ },
    {
      x: to.position.x,
      z: to.position.z + (Math.sign(endZ - to.position.z) * to.footprint) / 2,
    },
  ];
}

export function roadGrid(placements: Iterable<Placement>): RoadGrid {
  const allPlacements = [...placements];
  const bands: [number, number][] = [];
  for (const placement of allPlacements) {
    bands.push([
      placement.position.z - placement.footprint / 2,
      placement.position.z + placement.footprint / 2,
    ]);
  }
  bands.sort((a, b) => a[0] - b[0]);

  const rows: [number, number][] = [];
  for (const band of bands) {
    const last = rows[rows.length - 1];
    // A gap too narrow for a trace is part of the row, never a zero-width street.
    if (last && band[0] <= last[1] + ROAD_WIDTH * 2)
      last[1] = Math.max(last[1], band[1]);
    else rows.push([band[0], band[1]]);
  }
  if (rows.length === 0)
    return { streets: [], halves: [], rowAt: () => 0, placements: [] };

  const streets: number[] = [];
  const halves: number[] = [];
  for (let i = 0; i <= rows.length; i++) {
    const above = rows[i - 1];
    const below = rows[i];
    // The outermost two streets have open ground on one side, so they are half a
    // street out from the city rather than half way to a row that is not there.
    const gap = above && below ? below[0] - above[1] : STREET;
    streets.push(
      above && below
        ? (above[1] + below[0]) / 2
        : below
          ? below[0] - STREET / 2
          : (above as [number, number])[1] + STREET / 2
    );
    halves.push(Math.max(0, gap / 2 - ROAD_WIDTH));
  }

  // ponytail: a linear scan per lookup, called twice per edge over about thirty
  // rows. A binary search is the upgrade if a schema ever ranks into hundreds.
  const rowAt = (z: number) => {
    let row = 0;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] as [number, number])[0] <= z + EPS) row = i;
    }
    return row;
  };
  return { streets, halves, rowAt, placements: allPlacements };
}

/** Normalized side channels, shared by rendering and label occupancy. */
export function linkLanes(edges: SchemaEdge[]): Map<string, number> {
  const lanes = new Map<string, number>();
  for (const kind of ["block", "reference"] as const) {
    // Properties targeting the same pair draw one link, irrespective of API order.
    const keys = [
      ...new Set(
        edges
          .filter((item) => item.kind === kind && item.from !== item.to)
          .map(linkLaneKey)
      ),
    ].sort();
    const side = kind === "block" ? -1 : 1;
    keys.forEach((key, index) => {
      lanes.set(key, (side * (index + 1)) / (keys.length + 1));
    });
  }
  return lanes;
}

export const linkLaneKey = (edge: SchemaEdge) =>
  `${edge.kind}|${edge.from}|${edge.to}`;

/** Scale the normalized channel to the available street width. */
export function routeLaneOffset(
  grid: RoadGrid,
  from: Placement,
  to: Placement,
  lane: number
): number {
  const street = streetsBetween(grid, from, to)[0] as number;
  return lane * (grid.halves[street] ?? 0);
}

/**
 * The corners a road turns, from the parent's face to the child's. `lane` shifts the
 * run along the first street sideways, so two parents on one street do not overlap.
 */
export function routePoints(
  grid: RoadGrid,
  from: Placement,
  to: Placement,
  lane = 0
): { x: number; z: number }[] {
  const streets = streetsBetween(grid, from, to);
  const down = grid.rowAt(to.position.z) > grid.rowAt(from.position.z);
  const sameRow = grid.rowAt(to.position.z) === grid.rowAt(from.position.z);
  // A road leaves the face that points at the street it drops to, and enters the
  // face the street arrives at. Folding a rank onto rows puts some children north
  // of their parent, so both directions happen inside one district.
  const exitZ =
    from.position.z + (down || sameRow ? 1 : -1) * (from.footprint / 2);
  const enterZ = to.position.z + (down ? -1 : 1) * (to.footprint / 2);

  const points = [{ x: from.position.x, z: exitZ }];
  let corridor = to.position.x;
  streets.forEach((street, i) => {
    const z = (grid.streets[street] as number) + (i === 0 ? lane : 0);
    if (i === 0) {
      points.push({ x: from.position.x, z });
      if (streets.length > 1) {
        corridor = clearColumn(
          grid,
          to.position.x,
          z,
          grid.streets[streets[streets.length - 1]] as number,
          to.id
        );
        points.push({ x: corridor, z });
      } else points.push({ x: to.position.x, z });
    } else {
      points.push({ x: corridor, z });
      if (i === streets.length - 1 && corridor !== to.position.x)
        points.push({ x: to.position.x, z });
    }
  });
  points.push({ x: to.position.x, z: enterZ });
  return points;
}

function clearColumn(
  grid: RoadGrid,
  targetX: number,
  z0: number,
  z1: number,
  targetId: string
): number {
  const blockers = grid.placements.filter((placement) => {
    const low = Math.min(z0, z1);
    const high = Math.max(z0, z1);
    return (
      placement.id !== targetId &&
      placement.position.z - placement.footprint / 2 < high &&
      placement.position.z + placement.footprint / 2 > low
    );
  });
  const candidates = [
    targetX,
    ...blockers.flatMap((placement) => [
      placement.position.x - placement.footprint / 2 - 0.25,
      placement.position.x + placement.footprint / 2 + 0.25,
    ]),
  ].sort((a, b) => Math.abs(a - targetX) - Math.abs(b - targetX) || a - b);
  const clear = candidates.find((x) =>
    grid.placements.every((placement) => {
      if (placement.id === targetId) return true;
      const inZ =
        Math.max(
          Math.min(z0, z1),
          placement.position.z - placement.footprint / 2
        ) <
        Math.min(
          Math.max(z0, z1),
          placement.position.z + placement.footprint / 2
        );
      return (
        !inZ ||
        Math.abs(x - placement.position.x) >= placement.footprint / 2 + 0.2
      );
    })
  );
  if (clear !== undefined) return clear;
  return blockers.reduce(
    (edge, placement) =>
      Math.max(edge, placement.position.x + placement.footprint / 2 + 0.25),
    targetX
  );
}

export type RoadFan = {
  edges: SchemaEdge[];
  /** Buildings whose fan was cut, and how many roads the overview is not drawing. */
  markers: { id: string; hidden: number }[];
};

/**
 * Which roads the overview draws. A child with more than `FAN_LIMIT` allowed parents
 * keeps only its nearest one, because twenty ribbons converging on one roof say
 * nothing that "+19 parents" does not. `expanded` is the hovered and selected
 * buildings, whose full fan draws; `null` draws every road, which is focus mode.
 */
export function roadFan(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[],
  expanded: ReadonlySet<string> | null
): RoadFan {
  if (expanded === null) return { edges, markers: [] };

  const grid = roadGrid(placementsById.values());
  const fans = new Map<string, SchemaEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== "allowedChild" || edge.from === edge.to) continue;
    if (!(placementsById.has(edge.from) && placementsById.has(edge.to)))
      continue;
    const fan = fans.get(edge.to);
    if (fan) fan.push(edge);
    else fans.set(edge.to, [edge]);
  }

  const dropped = new Set<SchemaEdge>();
  const markers: { id: string; hidden: number }[] = [];
  for (const [child, fan] of fans) {
    if (fan.length <= FAN_LIMIT || expanded.has(child)) continue;
    const childRow = grid.rowAt(
      (placementsById.get(child) as Placement).position.z
    );
    const parent = (id: string) => placementsById.get(id) as Placement;
    // The nearest parent is the one whose road crosses fewest streets, and the
    // leftmost of those, so the road that stays is the shortest and the answer does
    // not move when an unrelated type is added.
    const nearest = [...fan].sort(
      (a, b) =>
        Math.abs(grid.rowAt(parent(a.from).position.z) - childRow) -
          Math.abs(grid.rowAt(parent(b.from).position.z) - childRow) ||
        parent(a.from).position.x - parent(b.from).position.x
    )[0] as SchemaEdge;
    for (const edge of fan) if (edge !== nearest) dropped.add(edge);
    markers.push({ id: child, hidden: fan.length - 1 });
  }

  return { edges: edges.filter((edge) => !dropped.has(edge)), markers };
}

/** The streets a road crosses, in travel order. Never empty. */
function streetsBetween(
  grid: RoadGrid,
  from: Placement,
  to: Placement
): number[] {
  const rowFrom = grid.rowAt(from.position.z);
  const rowTo = grid.rowAt(to.position.z);
  // Two buildings in one row still meet in the street below it, which draws as a
  // road out of one south face and back into the other.
  if (rowTo === rowFrom) return [rowFrom + 1];
  return rowTo > rowFrom
    ? Array.from({ length: rowTo - rowFrom }, (_, i) => rowFrom + 1 + i)
    : Array.from({ length: rowFrom - rowTo }, (_, i) => rowFrom - i);
}

/**
 * Runs that lie on top of each other become one. Two children of one parent leave it
 * by the same drop and share the street until they fork, and two parents of one child
 * share the run into it, so without this the trunk is drawn once per road and the
 * overlap z-fights.
 */
function mergeRuns(runs: RoadSegment[]): RoadSegment[] {
  const key = (run: RoadSegment) =>
    Math.abs(run.x1 - run.x0) < EPS ? `v${run.x0}` : `h${run.z0}`;
  const buckets = new Map<string, RoadSegment[]>();
  for (const run of runs) {
    const bucket = buckets.get(key(run));
    if (bucket) bucket.push(run);
    else buckets.set(key(run), [run]);
  }

  const merged: RoadSegment[] = [];
  for (const bucket of buckets.values()) {
    const vertical =
      Math.abs((bucket[0] as RoadSegment).x1 - (bucket[0] as RoadSegment).x0) <
      EPS;
    const low = (run: RoadSegment) =>
      vertical ? Math.min(run.z0, run.z1) : Math.min(run.x0, run.x1);
    const high = (run: RoadSegment) =>
      vertical ? Math.max(run.z0, run.z1) : Math.max(run.x0, run.x1);
    let open: RoadSegment | null = null;
    let end = 0;
    for (const run of [...bucket].sort((a, b) => low(a) - low(b))) {
      // Touching counts as overlapping. Two children of one parent leave it by the
      // same drop and fork at their own columns, so their two street runs meet at
      // the parent's column and are one run of road.
      if (open && low(run) <= end + EPS) {
        end = Math.max(end, high(run));
        open.edges.push(...run.edges);
        open.width = Math.min(
          open.width ?? ROAD_WIDTH,
          run.width ?? ROAD_WIDTH
        );
        open.into = open.into ?? run.into;
      } else {
        if (open) {
          closeRun(open, end, vertical);
          merged.push(open);
        }
        open = { ...run, edges: [...run.edges] };
        if (vertical) open.z0 = low(run);
        else open.x0 = low(run);
        end = high(run);
      }
    }
    if (open) {
      closeRun(open, end, vertical);
      merged.push(open);
    }
  }
  return merged;
}

function closeRun(run: RoadSegment, end: number, vertical: boolean) {
  if (vertical) run.z1 = end;
  else run.x1 = end;
}

/** One run as a ribbon, squared off at both ends so its corners have no notch. */
function pushSegment(positions: number[], segment: RoadSegment) {
  const dx = segment.x1 - segment.x0;
  const dz = segment.z1 - segment.z0;
  const length = Math.hypot(dx, dz);
  if (length < EPS) return;
  const dirX = dx / length;
  const dirZ = dz / length;
  const perpX = -dirZ;
  const perpZ = dirX;
  const half = (segment.width ?? ROAD_WIDTH) / 2;
  const startX = segment.x0 - dirX * half;
  const startZ = segment.z0 - dirZ * half;
  const endX = segment.x1 + dirX * half;
  const endZ = segment.z1 + dirZ * half;

  pushQuad(
    positions,
    startX + perpX * half,
    ROAD_Y,
    startZ + perpZ * half,
    startX - perpX * half,
    ROAD_Y,
    startZ - perpZ * half,
    endX - perpX * half,
    ROAD_Y,
    endZ - perpZ * half,
    endX + perpX * half,
    ROAD_Y,
    endZ + perpZ * half
  );

  if (!segment.into) return;
  // Chevrons ride the last run before the child, pointing the way the edge goes.
  const toEnd = Math.hypot(
    segment.into.x - segment.x1,
    segment.into.z - segment.z1
  );
  const toStart = Math.hypot(
    segment.into.x - segment.x0,
    segment.into.z - segment.z0
  );
  const flip = toStart < toEnd ? -1 : 1;
  const run = Math.min(length, CHEVRON_RUN);
  const steps = Math.max(1, Math.floor(run / CHEVRON_SPACING));
  for (let i = 1; i <= steps; i++) {
    // Measured back from the end the child is at, so the arrows always sit against
    // the building however long the rest of the run is.
    const back = (i / (steps + 1)) * run;
    const t = flip > 0 ? (length - back) / length : back / length;
    pushChevron(
      positions,
      segment.x0 + dx * t,
      segment.z0 + dz * t,
      dirX * flip,
      dirZ * flip,
      perpX * flip,
      perpZ * flip
    );
  }
}

function pushChevron(
  positions: number[],
  px: number,
  pz: number,
  dirX: number,
  dirZ: number,
  perpX: number,
  perpZ: number
) {
  const tipX = px + dirX * (CHEVRON_LENGTH / 2);
  const tipZ = pz + dirZ * (CHEVRON_LENGTH / 2);
  const backX = px - dirX * (CHEVRON_LENGTH / 2);
  const backZ = pz - dirZ * (CHEVRON_LENGTH / 2);
  pushTriangle(
    positions,
    tipX,
    CHEVRON_Y,
    tipZ,
    backX + perpX * CHEVRON_HALF_WIDTH,
    CHEVRON_Y,
    backZ + perpZ * CHEVRON_HALF_WIDTH,
    backX - perpX * CHEVRON_HALF_WIDTH,
    CHEVRON_Y,
    backZ - perpZ * CHEVRON_HALF_WIDTH
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
      cx + Math.cos(a0) * outer,
      ROAD_Y,
      cz + Math.sin(a0) * outer,
      cx + Math.cos(a0) * inner,
      ROAD_Y,
      cz + Math.sin(a0) * inner,
      cx + Math.cos(a1) * inner,
      ROAD_Y,
      cz + Math.sin(a1) * inner,
      cx + Math.cos(a1) * outer,
      ROAD_Y,
      cz + Math.sin(a1) * outer
    );
  }
}

function pushTriangle(
  positions: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
) {
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

// ponytail: winding order is not worth tracking here. Scene.tsx renders the
// road material double-sided instead, which costs nothing on this little geometry.
function pushQuad(
  positions: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number
) {
  pushTriangle(positions, ax, ay, az, bx, by, bz, cx, cy, cz);
  pushTriangle(positions, ax, ay, az, cx, cy, cz, dx, dy, dz);
}
