// The parts of a circuit board that say something about the schema: a gold finger
// wherever a trace leaves its board for another, a via wherever a trace turns, and
// the mounting holes in each corner. Pure: no three.js, no React, no DOM.
// scene/Boards.tsx draws them.

/** A board's ground, padding included, in world units. */
export type Island = { minX: number; maxX: number; minZ: number; maxZ: number };

/** One connection's corners on the ground, from its source's face to its target's. */
export type Traced = {
  from: string;
  to: string;
  points: readonly { x: number; z: number }[];
};

export type Side = "north" | "south" | "east" | "west";

/** A gold finger on a board's edge: where a lane leaves it, and which edge. */
export type Finger = { district: string; side: Side; x: number; z: number };

/** Distance from a board corner to the centre of its mounting hole. */
export const HOLE_INSET = 1;

/** Positions closer than this are one finger or one via. */
const SAME = 0.05;
const key = (value: number) => Math.round(value / SAME);

const inside = (island: Island, x: number, z: number) =>
  x > island.minX && x < island.maxX && z > island.minZ && z < island.maxZ;

/**
 * One finger for every lane that leaves a board for another, on the edge it leaves
 * by, where it crosses it. Every connection one type makes on one layer shares a
 * lane, so they cross the edge at one point and make one finger, and the fingers
 * count lanes rather than edges.
 *
 * `districtOf` names the board a type stands on, and `islands` gives each board's
 * ground. A route that never crosses its source board's edge, which only a stale
 * placement could give, makes no finger.
 */
export function edgeFingers(
  routes: readonly Traced[],
  districtOf: (id: string) => string | undefined,
  islands: ReadonlyMap<string, Island>
): Finger[] {
  const fingers = new Map<string, Finger>();
  for (const route of routes) {
    const district = districtOf(route.from);
    if (district === undefined || district === districtOf(route.to)) continue;
    const island = islands.get(district);
    if (!island) continue;
    const exit = exitOf(route.points, island);
    if (!exit) continue;
    const along =
      exit.side === "north" || exit.side === "south" ? exit.x : exit.z;
    fingers.set(`${district}|${exit.side}|${key(along)}`, {
      district,
      ...exit,
    });
  }
  return [...fingers.values()];
}

/** Where a run of axis-aligned corners first leaves `island`, and by which edge. */
function exitOf(
  points: readonly { x: number; z: number }[],
  island: Island
): { side: Side; x: number; z: number } | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; z: number };
    const b = points[i] as { x: number; z: number };
    if (!inside(island, a.x, a.z) || inside(island, b.x, b.z)) continue;
    if (b.z <= island.minZ) return { side: "north", x: a.x, z: island.minZ };
    if (b.z >= island.maxZ) return { side: "south", x: a.x, z: island.maxZ };
    if (b.x <= island.minX) return { side: "west", x: island.minX, z: a.z };
    return { side: "east", x: island.maxX, z: a.z };
  }
  return null;
}

/**
 * Every point where a trace turns, once, however many traces turn there. The first
 * and last corners are the faces of the two buildings, which are where a trace
 * meets its component rather than where it turns.
 */
export function traceVias(
  routes: readonly Traced[]
): { x: number; z: number }[] {
  const vias = new Map<string, { x: number; z: number }>();
  for (const { points } of routes) {
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1] as { x: number; z: number };
      const b = points[i] as { x: number; z: number };
      const c = points[i + 1] as { x: number; z: number };
      const turn = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      if (Math.abs(turn) < 1e-9) continue;
      vias.set(`${key(b.x)}|${key(b.z)}`, { x: b.x, z: b.z });
    }
  }
  return [...vias.values()];
}

/** The centres of a board's four mounting holes, inset from its corners. */
export function holeSpots(island: Island): { x: number; z: number }[] {
  return [
    { x: island.minX + HOLE_INSET, z: island.minZ + HOLE_INSET },
    { x: island.maxX - HOLE_INSET, z: island.minZ + HOLE_INSET },
    { x: island.minX + HOLE_INSET, z: island.maxZ - HOLE_INSET },
    { x: island.maxX - HOLE_INSET, z: island.maxZ - HOLE_INSET },
  ];
}
