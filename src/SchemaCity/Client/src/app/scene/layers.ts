// The relationship layers: which edge kind each one draws, and one merged line
// geometry per layer so the scene spends a single draw call on all of them.
// Pure: no three.js, no React, no DOM.
import type { EdgeKind, SchemaEdge } from "../../model/types";
import type { Placement } from "../layout/city";
import { planRoutes } from "./roads";

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
 * 0.05 and of each other.
 */
const BLOCK_Y = 0.25;
const REFERENCE_Y = 0.4;
/** Samples along one curve. Ten reads as a curve and costs twenty vertices. */
const SEGMENTS = 10;
const DASH_ON = 0.55;
const DASH_OFF = 0.4;

/**
 * One flat xyz line-segment list for every edge in `layer`, plus the vertex range
 * each run occupies so the scene can fade one edge without rebuilding anything.
 *
 * Compositions arch over the roofs. Blocks and references drop off their roof and
 * run the streets in lanes planned together with the roads, so no two ground layers
 * ever share a lane, and rise to the other roof. A block run leaving one host is one
 * trace however many Element Types it forks to, and the run arriving at one Element
 * Type is one trace however many hosts feed it; each lists every edge it carries.
 * References are dashed.
 */
export function buildLinkGeometry(
  layer: Exclude<Layer, "structure">,
  edges: SchemaEdge[],
  anchors: Map<string, Anchor>,
  placements: Map<string, Placement>
): { positions: Float32Array; ranges: LinkRange[] } {
  if (layer === "compositions") return buildArcs(edges, anchors);

  const positions: number[] = [];
  const ranges: LinkRange[] = [];
  const kind = layer === "blocks" ? "block" : "reference";
  const y = layer === "references" ? REFERENCE_Y : BLOCK_Y;
  const line = (a: Anchor, b: Anchor) => {
    if (layer === "references") pushDashes(positions, a, b);
    else positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const { routes, segments } = planRoutes(placements, edges);

  for (const segment of segments) {
    if (segment.edges[0]?.kind !== kind) continue;
    const start = positions.length / 3;
    line(
      { x: segment.x0, y, z: segment.z0 },
      { x: segment.x1, y, z: segment.z1 }
    );
    ranges.push({
      edges: segment.edges,
      start,
      count: positions.length / 3 - start,
    });
  }

  // The drop off a roof to the street and the rise to the other roof. Every link
  // leaving one face of a host drops from the same roof to the same point, so the
  // drop is drawn once and carries each of them, and the same goes for a rise.
  const ends = new Map<string, { a: Anchor; b: Anchor; edges: SchemaEdge[] }>();
  const end = (key: string, a: Anchor, b: Anchor, edge: SchemaEdge) => {
    const found = ends.get(key);
    if (found) found.edges.push(edge);
    else ends.set(key, { a, b, edges: [edge] });
  };
  for (const { edge, points } of routes) {
    if (edge.kind !== kind) continue;
    const from = anchors.get(edge.from);
    const to = anchors.get(edge.to);
    const [first] = points;
    const last = points[points.length - 1];
    if (!(from && to && first && last)) continue;
    end(`${edge.from}|${first.x}|${first.z}`, from, { ...first, y }, edge);
    end(`${edge.to}|${last.x}|${last.z}`, { ...last, y }, to, edge);
  }
  for (const { a, b, edges: carried } of ends.values()) {
    const start = positions.length / 3;
    line(a, b);
    ranges.push({ edges: carried, start, count: positions.length / 3 - start });
  }

  return { positions: new Float32Array(positions), ranges };
}

/**
 * Every composition and inheritance as an arc over the roofs. An inherited parent
 * arrives as both an inherits and a composition edge. The inheritance is the
 * stronger fact, and the scene draws it brighter, so the composition twin is dropped
 * whichever order the two came in.
 */
function buildArcs(
  edges: SchemaEdge[],
  anchors: Map<string, Anchor>
): { positions: Float32Array; ranges: LinkRange[] } {
  const positions: number[] = [];
  const ranges: LinkRange[] = [];
  const drawn = new Set<string>();
  const inherited = new Set(
    edges
      .filter((edge) => edge.kind === "inherits")
      .map((edge) => `${edge.from}|${edge.to}`)
  );
  const key = (edge: SchemaEdge) => `${edge.kind}|${edge.from}|${edge.to}`;

  for (const edge of [...edges].sort(
    (a, b) =>
      key(a).localeCompare(key(b)) ||
      (a.propertyAlias ?? "").localeCompare(b.propertyAlias ?? "")
  )) {
    if (LAYER_OF[edge.kind] !== "compositions") continue;
    if (edge.kind === "composition" && inherited.has(`${edge.from}|${edge.to}`))
      continue;
    const pair = `${edge.from}|${edge.to}`;
    if (drawn.has(pair) || edge.from === edge.to) continue;
    const from = anchors.get(edge.from);
    const to = anchors.get(edge.to);
    if (!(from && to)) continue;
    drawn.add(pair);

    const start = positions.length / 3;
    // A quadratic curve only travels half way to its control point, so the
    // control is put twice as far out as the height the curve should reach.
    const apex = (height: number) => 2 * height - (from.y + to.y) / 2;
    const length = Math.max(1, Math.hypot(to.x - from.x, to.z - from.z));
    const control = {
      x: (from.x + to.x) / 2 + ((to.z - from.z) / length) * 1.1,
      y: apex(Math.max(from.y, to.y) + ARCH),
      z: (from.z + to.z) / 2 + ((from.x - to.x) / length) * 1.1,
    };
    pushCurve(positions, from, control, to);
    ranges.push({ edges: [edge], start, count: positions.length / 3 - start });
  }

  return { positions: new Float32Array(positions), ranges };
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
