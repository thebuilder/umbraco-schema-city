// Where the neighbourhood of one node goes while that node is focused. Pure: no
// three.js, no React, no DOM. The scene tweens each building from its city
// placement to the one this returns, and back.
import type { Neighbourhood, PropertyTargets } from "../../model/neighbourhood";
import type { SchemaGraph } from "../../model/types";
import { cityBounds, ISLAND_PAD, ROW_LIMIT, STREET, type Placement } from "./city";

/** Ground between two buildings in a row, and between two rows, as the city uses. */
const GAP = 3;
/** How high the composition platform sits above the ground. */
const PLATFORM = 3;
/** Half the angle a ring of parents spans, so an arc covers 120 degrees. */
const ARC_HALF = Math.PI / 3;
/** Footprint of an id the city never placed, which only a stale edge can be. */
const FOOTPRINT = 2;

/** The ground a focused neighbourhood covers, for the island under it and the camera. */
export type FocusBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centre: { x: number; z: number };
};

type Spot = { x: number; z: number; y: number };
type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
/** A group packed into rows, in its own coordinates: centred on x, growing in z. */
type Block = { ids: string[]; spots: Map<string, { x: number; z: number }>; width: number; depth: number };

/**
 * Places the focused node at the origin and its neighbourhood around it by relation,
 * so the inspector's lists have somewhere to point. Every other node keeps the
 * placement the city gave it, as the same object, so the scene can tell what moved.
 *
 * Compass: parents to the north and children to the south, both one street off the
 * focused node's own footprint; compositions north-west on a platform and the types
 * composing this one north-east; block targets south-west and block hosts south-east;
 * references on the two flanks, out to the east and in from the west.
 *
 * Groups stack outward in bands. A corner group stands beside the parents or the
 * children when that costs at most a street of extra width, and takes the next band
 * out otherwise, on its own side of the centre line. Every distance comes from what
 * the groups hold rather than from a fixed radius, which is what spread the seeded
 * Home and its forty-two neighbours over 101 by 100 units of ground. The same
 * neighbourhood is now 50 by 59, and its groups read as one place rather than as
 * eight piles at arm's length.
 *
 * A node that fills two roles is placed once, in the first of those in that order.
 */
export function layoutFocus(
  graph: SchemaGraph,
  neighbourhood: Neighbourhood,
  focusId: string,
  cityPlacements: Placement[],
): Placement[] {
  const inCity = new Map(cityPlacements.map((placement) => [placement.id, placement]));
  const aliasOf = new Map(graph.nodes.map((node) => [node.id, node.alias]));
  // A block editor can still name an element type that was deleted, so an id with no
  // alias sorts last rather than crashing the comparison.
  const key = (id: string) => aliasOf.get(id) ?? `\uffff${id}`;
  const byAlias = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const sizeOf = (id: string) => inCity.get(id)?.footprint ?? FOOTPRINT;

  const taken = new Set<string>([focusId]);
  const claim = (ids: string[]) => {
    const fresh = [...new Set(ids)]
      .filter((id) => inCity.has(id) && !taken.has(id))
      .sort(byAlias);
    for (const id of fresh) taken.add(id);
    return fresh;
  };
  const targetsOf = (groups: PropertyTargets[]) => groups.flatMap((group) => group.ids);
  const composedBy = (graph.edges ?? [])
    .filter((edge) => edge.kind === "composition" && edge.to === focusId)
    .map((edge) => edge.from);

  // Claimed in this order, so a node in two groups lands in the first of them.
  const parents = claim(neighbourhood.allowedParents);
  const children = claim(neighbourhood.allowedChildren);
  const compositions = claim([...neighbourhood.inherits, ...neighbourhood.compositions]);
  const composers = claim(composedBy);
  const blockTargets = claim(targetsOf(neighbourhood.blockTargets));
  const blockHosts = claim(neighbourhood.blockHosts);
  const referencesOut = claim(targetsOf(neighbourhood.referencesOut));
  const referencesIn = claim(neighbourhood.referencesIn);

  const spots = new Map<string, Spot>([[focusId, { x: 0, z: 0, y: 0 }]]);
  const half = sizeOf(focusId) / 2;
  /** Near edge of the first band in any direction: one street off the focused node. */
  const near = half + STREET;
  /** Ground the neighbourhood covers so far, and every band in it. */
  const box: Box = { minX: -half, maxX: half, minZ: -half, maxZ: half };
  const bands: Box[] = [];
  /** Near edge of the next band, north (-1) and south (1). */
  const stack = { "-1": near, "1": near };

  const boxOf = (ids: string[]): Box => ({
    minX: Math.min(...ids.map((id) => (spots.get(id) as Spot).x - sizeOf(id) / 2)),
    maxX: Math.max(...ids.map((id) => (spots.get(id) as Spot).x + sizeOf(id) / 2)),
    minZ: Math.min(...ids.map((id) => (spots.get(id) as Spot).z - sizeOf(id) / 2)),
    maxZ: Math.max(...ids.map((id) => (spots.get(id) as Spot).z + sizeOf(id) / 2)),
  });
  const grow = (covered: Box) => {
    box.minX = Math.min(box.minX, covered.minX);
    box.maxX = Math.max(box.maxX, covered.maxX);
    box.minZ = Math.min(box.minZ, covered.minZ);
    box.maxZ = Math.max(box.maxZ, covered.maxZ);
    bands.push(covered);
    return covered;
  };

  /** Rows of at most `limit`, each centred on x, the first row's near edge at z 0. */
  const pack = (ids: string[], limit = ROW_LIMIT): Block => {
    const spread = new Map<string, { x: number; z: number }>();
    let z = 0;
    let width = 0;
    for (let i = 0; i < ids.length; i += limit) {
      const row = ids.slice(i, i + limit);
      // One depth for the whole row, so a narrow building cannot slide under the
      // row behind it.
      const depth = Math.max(...row.map(sizeOf));
      const rowWidth = row.reduce((sum, id) => sum + sizeOf(id), 0) + GAP * (row.length - 1);
      let x = -rowWidth / 2;
      for (const id of row) {
        spread.set(id, { x: x + sizeOf(id) / 2, z: z + depth / 2 });
        x += sizeOf(id) + GAP;
      }
      width = Math.max(width, rowWidth);
      z += depth + GAP;
    }
    return { ids, spots: spread, width, depth: z - GAP };
  };

  /** Puts a block down at `nearZ` on the given side and reserves the ground it takes. */
  const band = (block: Block, sign: number, centreX: number, y: number, nearZ?: number) => {
    const at = Math.max(near, nearZ ?? stack[sign < 0 ? "-1" : "1"]);
    for (const [id, spot] of block.spots) {
      spots.set(id, { x: centreX + spot.x, z: sign * (at + spot.z), y });
    }
    const side = sign < 0 ? "-1" : "1";
    stack[side] = Math.max(stack[side], at + block.depth + GAP);
    return grow(boxOf(block.ids));
  };

  /** Rings of at most eight over 120 degrees, for more parents than a row holds. */
  const arc = (ids: string[]) => {
    const pitch = Math.max(...ids.map(sizeOf)) + GAP;
    // A full ring spreads eight buildings over the same 120 degrees, so the radius
    // has to hold seven pitches of arc before they touch.
    const first = Math.max(near + pitch / 2, ((ROW_LIMIT - 1) * pitch) / (2 * ARC_HALF));
    let far = first;
    ids.forEach((id, index) => {
      const ring = Math.floor(index / ROW_LIMIT);
      const along = index % ROW_LIMIT;
      const width = Math.min(ROW_LIMIT, ids.length - ring * ROW_LIMIT);
      const radius = first + ring * pitch;
      const angle = width === 1 ? 0 : -ARC_HALF + (along / (width - 1)) * ARC_HALF * 2;
      spots.set(id, { x: radius * Math.sin(angle), z: -radius * Math.cos(angle), y: 0 });
      far = Math.max(far, radius + sizeOf(id) / 2);
    });
    stack["-1"] = Math.max(stack["-1"], far + GAP);
    return grow(boxOf(ids));
  };

  // ponytail: one street is the whole packing rule. A group is placed where it reads
  // on the compass while that widens the neighbourhood by at most a street, and lines
  // up with the ground already covered when it does not. Groups are placed in one pass
  // in a fixed order, so the answer depends on that order rather than on which
  // arrangement is squarest; a packer that measured every group first and searched is
  // the upgrade, and nothing in the seeded schema pays for it.
  /** True while an edge reaches at most a street past the ground already covered. */
  const affordable = (edge: number, sideX: number) =>
    Math.abs(edge) <= (sideX < 0 ? -box.minX : box.maxX) + STREET;

  /**
   * One corner group. It stands beside the group it shares a side with while that
   * costs at most a street of extra width, and takes the next band out otherwise,
   * where it sits on its own side of the centre line for the same price. A group too
   * wide for either lines up with the side it belongs to instead, because widening
   * the neighbourhood to keep a whole row of buildings off the centre line costs more
   * ground than the compass reading is worth.
   */
  const corner = (ids: string[], sideX: number, sign: number, y: number, beside: Box | null) => {
    if (ids.length === 0) return;
    const block = pack(ids);
    if (beside) {
      const inner = sideX < 0 ? beside.minX - GAP : beside.maxX + GAP;
      const outer = inner + sideX * block.width;
      if (affordable(outer, sideX)) {
        band(block, sign, (inner + outer) / 2, y, sign < 0 ? -beside.maxZ : beside.minZ);
        return;
      }
    }
    const aside = sideX * (GAP / 2 + block.width);
    const edge = affordable(aside, sideX) ? aside : sideX < 0 ? box.minX : box.maxX;
    band(block, sign, edge - (sideX * block.width) / 2, y);
  };

  /**
   * A flank is columns of at most eight, centred on the focused node. It sits one
   * street out, and steps past any band it runs alongside. Stepping out costs less
   * than another band would, because a flank tall enough to reach a band is standing
   * beside rows that already claimed that ground.
   */
  const flank = (ids: string[], sideX: number) => {
    let edge = near;
    for (let i = 0; i < ids.length; i += ROW_LIMIT) {
      const column = pack(ids.slice(i, i + ROW_LIMIT), 1);
      const top = -column.depth / 2;
      const clear = bands
        .filter((covered) => covered.maxZ > top && covered.minZ < -top)
        .map((covered) => (sideX < 0 ? -covered.minX : covered.maxX) + GAP);
      const at = Math.max(edge, ...clear);
      for (const [id, spot] of column.spots) {
        spots.set(id, { x: sideX * (at + column.width / 2), z: top + spot.z, y: 0 });
      }
      grow(boxOf(column.ids));
      edge = at + column.width + GAP;
    }
  };

  const northBand =
    parents.length === 0
      ? null
      : parents.length > ROW_LIMIT
        ? arc(parents)
        : band(pack(parents), -1, 0, 0);
  const southBand = children.length === 0 ? null : band(pack(children), 1, 0, 0);
  corner(compositions, -1, -1, PLATFORM, northBand);
  corner(composers, 1, -1, 0, northBand);
  corner(blockTargets, -1, 1, 0, southBand);
  corner(blockHosts, 1, 1, 0, southBand);
  // Last, so a flank steps past every band it runs alongside rather than only the
  // ones that happened to be placed before it.
  flank(referencesOut, 1);
  flank(referencesIn, -1);

  return cityPlacements.map((placement) => {
    const spot = spots.get(placement.id);
    return spot ? { ...placement, position: { x: spot.x, z: spot.z }, y: spot.y } : placement;
  });
}

/**
 * The ground the neighbourhood covers, with an island's padding around it, so the
 * scene can draw a slab under it and frame the camera on the same box. Pass the
 * placements the focus layout moved: the focused node and its neighbours.
 */
export function focusBounds(placements: Placement[]): FocusBounds {
  const { width, depth, centre } = cityBounds(placements, ISLAND_PAD);
  return {
    minX: centre.x - width / 2,
    maxX: centre.x + width / 2,
    minZ: centre.z - depth / 2,
    maxZ: centre.z + depth / 2,
    centre,
  };
}

/**
 * The focused node's city position. The layout puts that node at the origin and
 * measures the neighbourhood from there, so the scene adds this to stand the focus
 * island where the node was, over the city it came from.
 */
export function focusAnchor(cityPlacements: Placement[], focusId: string): { x: number; z: number } {
  return cityPlacements.find((placement) => placement.id === focusId)?.position ?? { x: 0, z: 0 };
}
