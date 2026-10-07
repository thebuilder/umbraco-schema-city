// Roads follow the streets. A road leaves its parent's face, drops to the street
// between the two rows, runs along that street to the child's column and enters the
// child's face, so every run is either north-south or east-west. Block links and
// references take the same routes, planned together with the roads so each source
// and kind has its own lane in a street. Everything one type connects to on one
// layer shares its lane, which is what collapses a hub's fan into one trunk that
// forks at each target's column. Pure: no three.js, no React.
import type { EdgeKind, SchemaEdge } from "../../model/types";
import { cityBounds, ISLAND_PAD, type Placement, STREET } from "../layout/city";
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
type RoadGrid = {
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
const ROAD_TRACE_Y = ROAD_Y + 0.015;
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
 * selection without rebuilding the geometry. A trunk is cut wherever the roads on it
 * change, so each piece lists only the edges that pass over it and a selection
 * lights exactly its own path.
 */
export function buildRoadGeometry(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): { positions: Float32Array; ranges: RoadRange[] } {
  const positions: number[] = [];
  const ranges: RoadRange[] = [];

  for (const segment of separateCrossings(planRoads(placementsById, edges))) {
    const start = positions.length / 3;
    pushSegment(positions, segment);
    ranges.push({
      edges: segment.edges,
      start,
      count: positions.length / 3 - start,
    });
  }

  for (const { edge, at } of selfLoops(placementsById, edges)) {
    const start = positions.length / 3;
    pushLoop(positions, at);
    ranges.push({ edges: [edge], start, count: positions.length / 3 - start });
  }

  return { positions: new Float32Array(positions), ranges };
}

function selfLoops(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
) {
  return edges.flatMap((edge) => {
    if (edge.kind !== "allowedChild" || edge.from !== edge.to) return [];
    const at = placementsById.get(edge.from);
    return at ? [{ edge, at }] : [];
  });
}

/**
 * Centerlines for the intro trace. Ribbons remain the authoritative hit geometry;
 * these endpoints are deliberately a little higher so the trace is not hidden by
 * the ribbon while it is being drawn.
 */
export function roadTracePositions(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): Float32Array {
  const positions: number[] = [];
  for (const segment of separateCrossings(planRoads(placementsById, edges))) {
    positions.push(
      segment.x0,
      ROAD_TRACE_Y,
      segment.z0,
      segment.x1,
      ROAD_TRACE_Y,
      segment.z1
    );
  }

  for (const { at } of selfLoops(placementsById, edges)) {
    const cx = at.position.x + at.footprint / 2 + LOOP_GAP;
    const cz = at.position.z;
    for (let i = 0; i < LOOP_SEGMENTS; i++) {
      const a0 = (i / LOOP_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / LOOP_SEGMENTS) * Math.PI * 2;
      positions.push(
        cx + Math.cos(a0) * LOOP_RADIUS,
        ROAD_TRACE_Y,
        cz + Math.sin(a0) * LOOP_RADIUS,
        cx + Math.cos(a1) * LOOP_RADIUS,
        ROAD_TRACE_Y,
        cz + Math.sin(a1) * LOOP_RADIUS
      );
    }
  }

  return new Float32Array(positions);
}

/**
 * Adds a small visual break to a horizontal ribbon when it crosses an unrelated
 * vertical ribbon. This is deliberately render-only: planRoads keeps continuous
 * provenance for hit testing and route validation, while the scene can still
 * fade ranges independently after this geometry is built.
 *
 * The vertical runs are sorted by x once, so each horizontal run reads only the
 * verticals inside its own span, and each run's sources and targets are collected
 * once rather than per pair. Comparing every pair, with a set built per pair, took
 * about 150 ms on the pathological fixture.
 */
export function separateCrossings(segments: RoadSegment[]): RoadSegment[] {
  const vertical = segments
    .filter((segment) => Math.abs(segment.x1 - segment.x0) < EPS)
    .map((segment) => ({
      segment,
      x: segment.x0,
      low: Math.min(segment.z0, segment.z1),
      high: Math.max(segment.z0, segment.z1),
    }))
    .sort((a, b) => a.x - b.x);
  const xs = vertical.map((run) => run.x);
  const result: RoadSegment[] = [];
  for (const segment of segments) {
    if (Math.abs(segment.z1 - segment.z0) >= EPS) {
      result.push(segment);
      continue;
    }
    result.push(...splitAtCuts(segment, crossingCuts(segment, vertical, xs)));
  }
  return result;
}

type Vertical = { segment: RoadSegment; x: number; low: number; high: number };

/** The first index in sorted `xs` whose value is above `x`. */
function firstAbove(xs: readonly number[], x: number): number {
  let low = 0;
  let high = xs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((xs[mid] as number) <= x) low = mid + 1;
    else high = mid;
  }
  return low;
}

function crossingCuts(
  segment: RoadSegment,
  vertical: readonly Vertical[],
  xs: readonly number[]
): [number, number][] {
  const low = Math.min(segment.x0, segment.x1);
  const high = Math.max(segment.x0, segment.x1);
  const halfGap = Math.max((segment.width ?? ROAD_WIDTH) * 0.75, 0.12);
  // Two runs that share a source or a target are one connection's trunk and its
  // fork, which meet rather than cross. A shared edge shares both, so this covers it.
  const sources = new Set(segment.edges.map((edge) => edge.from));
  const targets = new Set(segment.edges.map((edge) => edge.to));
  const cuts: [number, number][] = [];
  for (let i = firstAbove(xs, low + halfGap); i < vertical.length; i++) {
    const crossing = vertical[i] as Vertical;
    if (crossing.x >= high - halfGap) break;
    if (segment.z0 <= crossing.low || segment.z0 >= crossing.high) continue;
    if (
      crossing.segment.edges.some(
        (edge) => sources.has(edge.from) || targets.has(edge.to)
      )
    )
      continue;
    cuts.push([crossing.x - halfGap, crossing.x + halfGap]);
  }
  // Already in x order, so overlapping cuts merge in one pass.
  return cuts.reduce<[number, number][]>((merged, cut) => {
    const previous = merged[merged.length - 1];
    if (previous && cut[0] <= previous[1] + EPS)
      previous[1] = Math.max(previous[1], cut[1]);
    else merged.push([...cut]);
    return merged;
  }, []);
}

function splitAtCuts(segment: RoadSegment, cuts: [number, number][]) {
  if (cuts.length === 0) return [segment];
  const low = Math.min(segment.x0, segment.x1);
  const high = Math.max(segment.x0, segment.x1);
  const ends = [low, ...cuts.flat(), high];
  const forward = segment.x1 >= segment.x0;
  const pieces: RoadSegment[] = [];
  for (let i = 0; i < ends.length - 1; i += 2) {
    const a = ends[i] as number;
    const b = ends[i + 1] as number;
    if (b - a < EPS) continue;
    const x0 = forward ? a : b;
    const x1 = forward ? b : a;
    pieces.push({
      ...segment,
      x0,
      x1,
      into:
        segment.into && Math.abs(x1 - segment.x1) < EPS ? segment.into : null,
    });
  }
  return pieces;
}

/** The corners one connection turns, from its source's face to its target's. */
export type Route = { edge: SchemaEdge; points: Point[] };

type Point = { x: number; z: number };

/** The kinds that run on the ground, in the order they take lanes in a street. */
const GROUND: readonly EdgeKind[] = ["allowedChild", "block", "reference"];

/**
 * Every structure road as axis-aligned runs, with runs that lie on top of each other
 * merged. Block and reference edges in `edges` still take their lanes, so the roads
 * sit where they do when those layers are drawn beside them.
 */
export function planRoads(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): RoadSegment[] {
  return planRoutes(placementsById, edges).segments.filter(
    (segment) => segment.edges[0]?.kind === "allowedChild"
  );
}

const planned = new WeakMap<
  Map<string, Placement>,
  WeakMap<SchemaEdge[], ReturnType<typeof routeAll>>
>();

/**
 * Every ground connection routed through the streets: structure roads, block links
 * and references, planned together so no two of them share a lane. Each kind's runs
 * are merged among themselves only, so a road and a block link can run beside each
 * other but never become one trunk. `routes` keeps each edge's own corners, for the
 * link layers' drops off the roofs.
 *
 * The roads, the block layer and the reference layer all ask for the same plan of
 * the same edges, so it is kept per placement map and edge list.
 */
export function planRoutes(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): { routes: Route[]; segments: RoadSegment[] } {
  let byEdges = planned.get(placementsById);
  if (!byEdges) {
    byEdges = new WeakMap();
    planned.set(placementsById, byEdges);
  }
  let plan = byEdges.get(edges);
  if (!plan) {
    plan = routeAll(placementsById, edges);
    byEdges.set(edges, plan);
  }
  return plan;
}

/**
 * One connection before lanes: the street it leaves along, the column or corridor it
 * crosses on, and the street it arrives along. `arrive` is null when the route never
 * turns along a second street, which is a route between neighbouring rows or one that
 * descends its target's own column.
 */
type Leg = {
  edge: SchemaEdge;
  from: Placement;
  to: Placement;
  leave: Street;
  arrive: Street | null;
  /** The column the route crosses the rows on, when it crosses any. */
  column: number | null;
  /** The void between two side-by-side islands the route crosses, when it does. */
  corridor: { low: number; high: number } | null;
};

type Street = { z: number; half: number };

/** A run of one owner along one channel, before it has a lane. */
type Claim = { channel: string; owner: string; low: number; high: number };

function routeAll(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): { routes: Route[]; segments: RoadSegment[] } {
  const legs = planLegs(placementsById, edges).map((leg) => ({
    leg,
    // Every street and corridor takes one lane per source and kind, so everything
    // a type connects to on one layer leaves it as one trunk and forks at each
    // target's column. Owning the arrival runs by target instead laid a hub's fan
    // into another island as one parallel lane per child, 22 of them for Home on
    // the seeded schema.
    owner: `${leg.edge.kind}|${leg.edge.from}`,
    channels: channelsOf(leg),
  }));
  const lanes = allocateLanes(
    legs.flatMap(({ owner, channels }) =>
      channels.flatMap((channel) => (channel ? [{ ...channel, owner }] : []))
    )
  );

  const routes: Route[] = [];
  const runs = new Map<EdgeKind, RoadSegment[]>();
  for (const { leg, owner, channels } of legs) {
    const found = channels.map((channel) =>
      channel ? (lanes.get(`${channel.channel}|${owner}`) as Lane) : null
    );
    const [leave, arrive, corridor] = found;
    const points = legPoints(
      leg,
      leave as Lane,
      arrive ?? null,
      corridor ?? null
    );
    routes.push({ edge: leg.edge, points });
    // A ribbon stays narrower than the gap between two lanes, so a busy street
    // still reads as separate traces.
    const width = Math.min(
      ROAD_WIDTH,
      ...channels.flatMap((channel, i) =>
        channel ? [(found[i] as Lane).spacing * channel.half * 0.8] : []
      )
    );
    const list = runs.get(leg.edge.kind) ?? [];
    runs.set(leg.edge.kind, list);
    list.push(...runsOf(leg, points, width));
  }
  return {
    routes,
    segments: GROUND.flatMap((kind) => mergeRuns(runs.get(kind) ?? [])),
  };
}

/** A lane-free stretch of one leg: the channel it runs in and the span it covers. */
type Channel = { channel: string; low: number; high: number; half: number };

/**
 * The street a leg leaves along, the street it arrives along and the corridor it
 * crosses, in that order, null where it has none, each with the span it covers.
 */
function channelsOf(leg: Leg): (Channel | null)[] {
  const turn = leg.corridor
    ? [leg.corridor.low, leg.corridor.high]
    : [leg.column ?? leg.to.position.x];
  const along = (street: Street, x: number): Channel => ({
    channel: streetKey(street),
    half: street.half,
    low: Math.min(x, ...turn),
    high: Math.max(x, ...turn),
  });
  const ends = [leg.leave.z, leg.arrive?.z ?? leg.leave.z];
  return [
    along(leg.leave, leg.from.position.x),
    leg.arrive ? along(leg.arrive, leg.to.position.x) : null,
    leg.corridor
      ? {
          channel: `corridor|${leg.corridor.low.toFixed(3)}`,
          half: bridgeHalf(leg.corridor),
          low: Math.min(...ends) - leg.leave.half,
          high: Math.max(...ends) + leg.leave.half,
        }
      : null,
  ];
}

/** The runs between a route's corners, the last one pointing its chevrons at the target. */
function runsOf(leg: Leg, points: Point[], width: number): RoadSegment[] {
  const runs: RoadSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    if (Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS) continue;
    runs.push({
      x0: a.x,
      z0: a.z,
      x1: b.x,
      z1: b.z,
      edges: [leg.edge],
      width,
      into:
        i === points.length - 1
          ? { x: leg.to.position.x, z: leg.to.position.z }
          : null,
    });
  }
  return runs;
}

const streetKey = (street: Street) => `street|${street.z.toFixed(3)}`;

type Lane = { offset: number; spacing: number };

/**
 * Interval colouring per channel: each owner's span takes the first lane no earlier
 * span in the channel overlaps. Lanes are spread evenly over the channel's half
 * width, counted per cluster of spans that chain into each other, so a crowded
 * street on a distant island at the same z never squeezes this one.
 */
function allocateLanes(claims: Claim[]): Map<string, Lane> {
  // One span per owner and channel, covering every run it makes there.
  const spans = new Map<string, Claim>();
  for (const claim of claims) {
    const key = `${claim.channel}|${claim.owner}`;
    const span = spans.get(key);
    if (span) {
      span.low = Math.min(span.low, claim.low);
      span.high = Math.max(span.high, claim.high);
    } else spans.set(key, { ...claim });
  }
  const byChannel = new Map<string, Claim[]>();
  for (const span of spans.values()) {
    const list = byChannel.get(span.channel) ?? [];
    list.push(span);
    byChannel.set(span.channel, list);
  }

  const lanes = new Map<string, Lane>();
  for (const [channel, list] of byChannel) {
    // Structure first, then blocks, then references, so each kind keeps to its own
    // side of a street; then west to east, then by owner for a stable answer.
    list.sort(
      (a, b) =>
        kindRank(a.owner) - kindRank(b.owner) ||
        a.low - b.low ||
        a.high - b.high ||
        compare(a.owner, b.owner)
    );
    for (const cluster of clusters(list)) {
      const used: { low: number; high: number }[][] = [];
      const laneOf = cluster.map((span) => {
        let lane = 0;
        while (
          used[lane]?.some(
            (other) =>
              other.low < span.high - EPS && other.high > span.low + EPS
          )
        )
          lane++;
        used[lane] ??= [];
        (used[lane] as { low: number; high: number }[]).push(span);
        return lane;
      });
      cluster.forEach((span, i) => {
        lanes.set(`${channel}|${span.owner}`, {
          // A fraction of the half width, which the caller scales.
          offset: -1 + (2 * ((laneOf[i] as number) + 1)) / (used.length + 1),
          spacing: 2 / (used.length + 1),
        });
      });
    }
  }
  return lanes;
}

const kindRank = (owner: string) =>
  GROUND.indexOf(owner.slice(0, owner.indexOf("|")) as EdgeKind);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Spans that overlap, directly or through a chain of others, in sorted groups. */
function clusters(spans: Claim[]): Claim[][] {
  const sorted = [...spans].sort((a, b) => a.low - b.low);
  const groups: Claim[][] = [];
  let reach = Number.NEGATIVE_INFINITY;
  for (const span of sorted) {
    if (span.low >= reach - EPS) groups.push([]);
    (groups[groups.length - 1] as Claim[]).push(span);
    reach = Math.max(reach, span.high);
  }
  // Back in allocation order inside each group.
  return groups.map((group) => spans.filter((span) => group.includes(span)));
}

/** The streets and the column or corridor of every ground edge, before lanes. */
function planLegs(
  placementsById: Map<string, Placement>,
  edges: SchemaEdge[]
): Leg[] {
  const all = [...placementsById.values()];
  const grids = new Map<string, RoadGrid>();
  const districtGrid = (district: string) => {
    let grid = grids.get(district);
    if (!grid) {
      grid = roadGrid(all.filter((at) => at.district === district));
      grids.set(district, grid);
    }
    return grid;
  };

  // Two properties on one type pointing at the same type are one connection on the
  // ground; the inspector is where the property aliases are read.
  const seen = new Set<string>();
  const legs: Leg[] = [];
  for (const edge of [...edges].sort(
    (a, b) =>
      GROUND.indexOf(a.kind) - GROUND.indexOf(b.kind) ||
      compare(a.from, b.from) ||
      compare(a.to, b.to) ||
      compare(a.propertyAlias ?? "", b.propertyAlias ?? "")
  )) {
    const key = `${edge.kind}|${edge.from}|${edge.to}`;
    if (!GROUND.includes(edge.kind) || edge.from === edge.to || seen.has(key))
      continue;
    const from = placementsById.get(edge.from);
    const to = placementsById.get(edge.to);
    if (!(from && to)) continue;
    seen.add(key);
    legs.push(
      legOf(
        edge,
        from,
        to,
        districtGrid(from.district),
        districtGrid(to.district),
        all
      )
    );
  }
  return legs;
}

/**
 * One edge's streets and its column or corridor. Side-by-side islands meet through
 * the void between them. Inside one island the streets are its own. Between two
 * islands stacked north and south, each end uses the street of its own island that
 * faces the other, and the column between them clears every building on the way,
 * whichever island it stands on.
 */
function legOf(
  edge: SchemaEdge,
  from: Placement,
  to: Placement,
  source: RoadGrid,
  target: RoadGrid,
  all: Placement[]
): Leg {
  const gap = bridgeGap(source, target);
  if (gap)
    return {
      edge,
      from,
      to,
      leave: streetOf(source, portStreet(source, from, to)),
      arrive: streetOf(target, portStreet(target, to, from)),
      column: null,
      corridor: gap,
    };
  const streets =
    source === target
      ? streetsBetween(source, from, to)
      : [portStreet(source, from, to), portStreet(target, to, from)];
  const leave = streetOf(source, streets[0] as number);
  if (streets.length === 1)
    return {
      edge,
      from,
      to,
      leave,
      arrive: null,
      column: null,
      corridor: null,
    };
  const last = streetOf(target, streets[streets.length - 1] as number);
  const column = clearColumn(all, to.position.x, leave.z, last.z, to.id);
  return {
    edge,
    from,
    to,
    leave,
    // A column that lands on the target's own x runs straight into its face.
    arrive: Math.abs(column - to.position.x) < EPS ? null : last,
    column,
    corridor: null,
  };
}

const streetOf = (grid: RoadGrid, index: number): Street => ({
  z: grid.streets[index] as number,
  half: grid.halves[index] ?? 0,
});

/**
 * The corners of one leg with its lanes applied. A route leaves the source's face
 * that points at its first street, runs along that street in its lane, crosses the
 * rows on its column or the void on its corridor lane, runs along the arrival street
 * in its lane, and enters the target's face that points back at that street.
 */
function legPoints(
  leg: Leg,
  leave: Lane,
  arrive: Lane | null,
  corridor: Lane | null
): Point[] {
  const { from, to } = leg;
  const leaveZ = leg.leave.z + leave.offset * leg.leave.half;
  const arriveZ = leg.arrive
    ? leg.arrive.z + (arrive as Lane).offset * leg.arrive.half
    : null;
  const face = (at: Placement, towardZ: number) =>
    at.position.z +
    (Math.sign(towardZ - at.position.z) || 1) * (at.footprint / 2);
  const points: Point[] = [
    { x: from.position.x, z: face(from, leaveZ) },
    { x: from.position.x, z: leaveZ },
  ];
  const turnX = leg.corridor
    ? (leg.corridor.low + leg.corridor.high) / 2 +
      (corridor as Lane).offset * bridgeHalf(leg.corridor)
    : (leg.column ?? to.position.x);
  points.push({ x: turnX, z: leaveZ });
  if (arriveZ === null) {
    points.push({ x: to.position.x, z: face(to, leaveZ) });
  } else {
    points.push({ x: turnX, z: arriveZ }, { x: to.position.x, z: arriveZ });
    points.push({ x: to.position.x, z: face(to, arriveZ) });
  }
  return points;
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

/** Keep the corridor outside padded boards, with room for each ribbon edge. */
function bridgeHalf(gap: { low: number; high: number }): number {
  const half = (gap.high - gap.low) / 2;
  return Math.max(
    ROAD_WIDTH / 2,
    half - Math.min(ISLAND_PAD + ROAD_WIDTH, half / 2)
  );
}

/** The bands of z that buildings occupy, north to south, touching bands joined. */
function rowsOf(placements: Placement[]): [number, number][] {
  const bands = placements
    .map(
      (placement) =>
        [
          placement.position.z - placement.footprint / 2,
          placement.position.z + placement.footprint / 2,
        ] as [number, number]
    )
    .sort((a, b) => a[0] - b[0]);
  const rows: [number, number][] = [];
  for (const band of bands) {
    const last = rows[rows.length - 1];
    // A gap too narrow for a trace is part of the row, never a zero-width street.
    if (last && band[0] <= last[1] + ROAD_WIDTH * 2)
      last[1] = Math.max(last[1], band[1]);
    else rows.push([band[0], band[1]]);
  }
  return rows;
}

function roadGrid(placements: Iterable<Placement>): RoadGrid {
  const allPlacements = [...placements];
  const rows = rowsOf(allPlacements);
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

/**
 * The x nearest `targetX` where a north-south run from `z0` to `z1` touches no
 * building but the target. Every placement counts, whichever island it stands on,
 * because a run between two islands can cross a third.
 */
function clearColumn(
  placements: Placement[],
  targetX: number,
  z0: number,
  z1: number,
  targetId: string
): number {
  const low = Math.min(z0, z1);
  const high = Math.max(z0, z1);
  const blockers = placements.filter(
    (placement) =>
      placement.id !== targetId &&
      placement.position.z - placement.footprint / 2 < high &&
      placement.position.z + placement.footprint / 2 > low
  );
  const candidates = [
    targetX,
    ...blockers.flatMap((placement) => [
      placement.position.x - placement.footprint / 2 - 0.25,
      placement.position.x + placement.footprint / 2 + 0.25,
    ]),
  ].sort((a, b) => Math.abs(a - targetX) - Math.abs(b - targetX) || a - b);
  const clear = candidates.find((x) =>
    blockers.every(
      (placement) =>
        Math.abs(x - placement.position.x) >= placement.footprint / 2 + 0.2
    )
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
 * Runs that lie on top of each other become one, cut wherever the set of edges on it
 * changes. Two children of one parent leave it by the same drop and share the street
 * until they fork, and two parents of one child share the run into it, so without
 * this the trunk is drawn once per road and the overlap z-fights. The cuts are what
 * keep a highlight honest: a run lists only the edges that really pass over it, so
 * hovering one type lights its own path and not the whole trunk it joins.
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
    const first = bucket[0] as RoadSegment;
    const vertical = Math.abs(first.x1 - first.x0) < EPS;
    const low = (run: RoadSegment) =>
      vertical ? Math.min(run.z0, run.z1) : Math.min(run.x0, run.x1);
    const high = (run: RoadSegment) =>
      vertical ? Math.max(run.z0, run.z1) : Math.max(run.x0, run.x1);
    const cuts = [
      ...new Set(bucket.flatMap((run) => [low(run), high(run)])),
    ].sort((a, b) => a - b);
    let open: RoadSegment | null = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i] as number;
      const b = cuts[i + 1] as number;
      const over = bucket.filter(
        (run) => low(run) <= a + EPS && high(run) >= b - EPS
      );
      const edges = [...new Set(over.flatMap((run) => run.edges))];
      if (
        open &&
        edges.length === open.edges.length &&
        edges.every((edge) => open?.edges.includes(edge))
      ) {
        setEnd(open, b, vertical);
      } else {
        if (open) merged.push(open);
        open =
          edges.length === 0
            ? null
            : {
                ...first,
                ...(vertical ? { z0: a, z1: b } : { x0: a, x1: b }),
                edges,
                width: Math.min(...over.map((run) => run.width ?? ROAD_WIDTH)),
                into: null,
              };
      }
      // A chevron belongs to the piece that ends where a run meets its child.
      const into = over.find(
        (run) => run.into && Math.abs(endOf(run, vertical) - b) < EPS
      )?.into;
      if (open && into) open.into = into;
      if (open && open.into === null) {
        const start = over.find(
          (run) => run.into && Math.abs(endOf(run, vertical) - a) < EPS
        )?.into;
        if (start) open.into = start;
      }
    }
    if (open) merged.push(open);
  }
  return merged;
}

/** Where a run ends along its own axis, which is the end its child is at. */
const endOf = (run: RoadSegment, vertical: boolean) =>
  vertical ? run.z1 : run.x1;

function setEnd(run: RoadSegment, end: number, vertical: boolean) {
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
