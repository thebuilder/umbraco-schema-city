// Where the neighbourhood of one node goes while that node is focused. Pure: no
// three.js, no React, no DOM. The scene tweens each building from its city
// placement to the one this returns, and back.
import type { Neighbourhood, PropertyTargets } from "../../model/neighbourhood";
import type { SchemaGraph } from "../../model/types";
import { ROW_LIMIT, type Placement } from "./city";

/** Centre to centre spacing, wide enough for the widest building and a street. */
const PITCH = 7;
/** Distance from the focused building to the first row of children. */
const NEAR = 10;
/** Radius of the innermost arc of parents. */
const ARC = 26;
/** Half the angle the parents span, so the arc covers 120 degrees. */
const ARC_HALF = Math.PI / 3;
// ponytail: a corner group starts 38 units out on both axes, which clears the rows,
// the flanks and an arc of up to about 30 parents. A node with more parents than that
// and compositions as well can have its outermost arc graze the north-west grid. A
// radial packer that measured each group would fix it; nothing in the seeded schema
// comes close.
const CORNER = 38;
/** Buildings across one corner grid. Narrower than a row, to keep it in its corner. */
const CORNER_WIDTH = 4;
/** How high the composition platform sits above the ground. */
const PLATFORM = 3;

type Spot = { x: number; z: number; y: number };

/**
 * Places the focused node at the origin and its neighbourhood around it by relation,
 * so the inspector's lists have somewhere to point. Every other node keeps the
 * placement the city gave it, as the same object, so the scene can tell what moved.
 *
 * Compass: parents arc to the north and children fold into rows to the south,
 * compositions sit north-west on a platform and the types composing this one
 * north-east, block targets south-west and block hosts south-east, and references
 * take the two flanks, out to the east and in from the west.
 *
 * A node that fills two roles is placed once, in the first of those in that order.
 */
export function layoutFocus(
  graph: SchemaGraph,
  neighbourhood: Neighbourhood,
  focusId: string,
  cityPlacements: Placement[],
): Placement[] {
  const inCity = new Set(cityPlacements.map((placement) => placement.id));
  const aliasOf = new Map(graph.nodes.map((node) => [node.id, node.alias]));
  // A block editor can still name an element type that was deleted, so an id with no
  // alias sorts last rather than crashing the comparison.
  const key = (id: string) => aliasOf.get(id) ?? `\uffff${id}`;
  const byAlias = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

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

  const spots = new Map<string, Spot>([[focusId, { x: 0, z: 0, y: 0 }]]);
  const put = (ids: string[], at: (index: number, ids: string[]) => Spot) => {
    ids.forEach((id, index) => spots.set(id, at(index, ids)));
  };

  put(claim(neighbourhood.allowedParents), arc);
  put(claim(neighbourhood.allowedChildren), rows);
  put(claim([...neighbourhood.inherits, ...neighbourhood.compositions]), corner(-1, -1, PLATFORM));
  put(claim(composedBy), corner(1, -1, 0));
  put(claim(targetsOf(neighbourhood.blockTargets)), corner(-1, 1, 0));
  put(claim(neighbourhood.blockHosts), corner(1, 1, 0));
  put(claim(targetsOf(neighbourhood.referencesOut)), flank(1));
  put(claim(neighbourhood.referencesIn), flank(-1));

  return cityPlacements.map((placement) => {
    const spot = spots.get(placement.id);
    return spot
      ? { ...placement, position: { x: spot.x, z: spot.z }, y: spot.y }
      : placement;
  });
}

/** Rows of at most eight to the south, each row centred on the focused building. */
function rows(index: number, ids: string[]): Spot {
  const row = Math.floor(index / ROW_LIMIT);
  const column = index % ROW_LIMIT;
  const width = Math.min(ROW_LIMIT, ids.length - row * ROW_LIMIT);
  return { x: (column - (width - 1) / 2) * PITCH, z: NEAR + row * PITCH, y: 0 };
}

/** Arcs of at most eight to the north, each ring one pitch further out. */
function arc(index: number, ids: string[]): Spot {
  const ring = Math.floor(index / ROW_LIMIT);
  const along = index % ROW_LIMIT;
  const width = Math.min(ROW_LIMIT, ids.length - ring * ROW_LIMIT);
  const radius = ARC + ring * PITCH;
  const angle = width === 1 ? 0 : -ARC_HALF + (along / (width - 1)) * ARC_HALF * 2;
  return { x: radius * Math.sin(angle), z: -radius * Math.cos(angle), y: 0 };
}

/**
 * A grid in one corner, growing away from the focused building on both axes, so
 * every member of the group stays in that quadrant however many there are.
 */
function corner(signX: number, signZ: number, y: number) {
  return (index: number): Spot => ({
    x: signX * (CORNER + (index % CORNER_WIDTH) * PITCH),
    z: signZ * (CORNER + Math.floor(index / CORNER_WIDTH) * PITCH),
    y,
  });
}

/** A column of at most eight on one flank, centred on the focused building. */
function flank(signX: number) {
  return (index: number, ids: string[]): Spot => ({
    x: signX * (CORNER + Math.floor(index / ROW_LIMIT) * PITCH),
    z: ((index % ROW_LIMIT) - (Math.min(ROW_LIMIT, ids.length) - 1) / 2) * PITCH,
    y: 0,
  });
}
