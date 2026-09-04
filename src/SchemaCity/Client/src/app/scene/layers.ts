// The relationship layers: which edge kind each one draws, and one merged line
// geometry per layer so the scene spends a single draw call on all of them.
// Pure: no three.js, no React, no DOM.
import type { EdgeKind, SchemaEdge } from "../../model/types";
import type { Placement } from "../layout/city";
import { type RoadGrid, roadGrid, routePoints } from "./roads";

export type Layer = "structure" | "compositions" | "blocks" | "references";

/** Toolbar order, and the order a layer list is written to the URL in. */
export const LAYERS: readonly Layer[] = [
  "structure",
  "compositions",
  "blocks",
  "references",
];

/** Structure alone. The other three are noise until you ask for them. */
export const DEFAULT_LAYERS: readonly Layer[] = ["structure"];

export const LAYER_OF: Record<EdgeKind, Layer> = {
  allowedChild: "structure",
  block: "blocks",
  composition: "compositions",
  inherits: "compositions",
  reference: "references",
};

/** Where a link attaches to a building: its roof, in world units. */
export type Anchor = { x: number; y: number; z: number };

export type LinkRange = { edges: SchemaEdge[]; start: number; count: number };

/** How high a composition arc rises over the taller of the two roofs it joins. */
const ARCH = 3;
/**
 * How close to the ground a block link and a reference come on their way across the
 * city. They run the streets there, so they sit just clear of the road ribbons at
 * 0.015 and of each other.
 */
const BLOCK_Y = 0.25;
const REFERENCE_Y = 0.4;
/** Samples along one curve. Ten reads as a curve and costs twenty vertices. */
const SEGMENTS = 10;
const DASH_ON = 0.55;
const DASH_OFF = 0.4;

/**
 * One flat xyz line-segment list for every edge in `layer`, plus the vertex range
 * each edge occupies so the scene can fade one edge without rebuilding anything.
 *
 * Compositions arch over the roofs. Blocks and references drop off their roof, cross
 * the city along the same streets the roads run, and rise to the other roof, so all
 * four layers agree about where the ground is walkable. References are dashed.
 */
export function buildLinkGeometry(
  layer: Exclude<Layer, "structure">,
  edges: SchemaEdge[],
  anchors: Map<string, Anchor>,
  placements: Map<string, Placement>
): { positions: Float32Array; ranges: LinkRange[] } {
  const positions: number[] = [];
  const ranges: LinkRange[] = [];
  const drawn = new Set<string>();
  const grid = layer === "compositions" ? null : roadGrid(placements.values());
  // An inherited parent arrives as both an inherits and a composition edge. The
  // inheritance is the stronger fact, and the scene draws it brighter, so the
  // composition twin is dropped whichever order the two came in.
  const inherited =
    layer === "compositions"
      ? new Set(
          edges
            .filter((edge) => edge.kind === "inherits")
            .map((edge) => `${edge.from}|${edge.to}`)
        )
      : null;

  for (const edge of edges) {
    if (LAYER_OF[edge.kind] !== layer) continue;
    if (
      edge.kind === "composition" &&
      inherited?.has(`${edge.from}|${edge.to}`)
    )
      continue;
    // Two block properties on one type pointing at the same Element Type are one
    // line, not two drawn on top of each other. That is 38 of the seeded schema's
    // 340 block edges, and the inspector is where the property aliases are read.
    const pair = `${edge.from}|${edge.to}`;
    if (drawn.has(pair) || edge.from === edge.to) continue;
    const from = anchors.get(edge.from);
    const to = anchors.get(edge.to);
    if (!from || !to) continue;
    drawn.add(pair);

    const start = positions.length / 3;
    if (grid) {
      const path = groundPath(
        grid,
        from,
        to,
        placements.get(edge.from),
        placements.get(edge.to),
        layer === "references" ? REFERENCE_Y : BLOCK_Y
      );
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1] as Anchor;
        const b = path[i] as Anchor;
        if (layer === "references") pushDashes(positions, a, b);
        else positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    } else {
      // A quadratic curve only travels half way to its control point, so the
      // control is put twice as far out as the height the curve should reach.
      const apex = (height: number) => 2 * height - (from.y + to.y) / 2;
      const control = {
        x: (from.x + to.x) / 2,
        y: apex(Math.max(from.y, to.y) + ARCH),
        z: (from.z + to.z) / 2,
      };
      pushCurve(positions, from, control, to);
    }
    ranges.push({ edges: [edge], start, count: positions.length / 3 - start });
  }

  return { positions: new Float32Array(positions), ranges };
}

/**
 * Roof, down to the street, along the streets to the other building's column, then
 * up to its roof. It is the road route with a height on it, so a block link and the
 * road under it turn the same corners instead of crossing at an angle.
 */
function groundPath(
  grid: RoadGrid,
  from: Anchor,
  to: Anchor,
  fromPlacement: Placement | undefined,
  toPlacement: Placement | undefined,
  y: number
): Anchor[] {
  if (!fromPlacement || !toPlacement) return [from, to];
  return [
    from,
    ...routePoints(grid, fromPlacement, toPlacement).map((point) => ({
      x: point.x,
      y,
      z: point.z,
    })),
    to,
  ];
}

/** A quadratic curve as `SEGMENTS` joined segments. */
function pushCurve(out: number[], from: Anchor, control: Anchor, to: Anchor) {
  let px = from.x;
  let py = from.y;
  let pz = from.z;
  for (let step = 1; step <= SEGMENTS; step++) {
    const t = step / SEGMENTS;
    const u = 1 - t;
    const qx = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
    const qy = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
    const qz = u * u * from.z + 2 * u * t * control.z + t * t * to.z;
    out.push(px, py, pz, qx, qy, qz);
    px = qx;
    py = qy;
    pz = qz;
  }
}

// ponytail: dashes are cut into the geometry rather than drawn with
// LineDashedMaterial, which would need computeLineDistances on a geometry React has
// not attached yet. The dash phase restarts at every corner of the route, so a corner
// always falls on a dash boundary rather than inside one. The seeded schema has 38
// reference links to cut.
function pushDashes(out: number[], from: Anchor, to: Anchor) {
  const span = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (span < 1e-6) return;
  for (let at = 0; at < span; at += DASH_ON + DASH_OFF) {
    const start = at / span;
    const end = Math.min(1, (at + DASH_ON) / span);
    out.push(
      from.x + (to.x - from.x) * start,
      from.y + (to.y - from.y) * start,
      from.z + (to.z - from.z) * start,
      from.x + (to.x - from.x) * end,
      from.y + (to.y - from.y) * end,
      from.z + (to.z - from.z) * end
    );
  }
}
