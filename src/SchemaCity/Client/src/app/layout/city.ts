// Turns a SchemaGraph into ground positions. Pure: no three.js, no React, no DOM.
// The scene reads the output and owns everything visual.
import {
  type EdgeLabel,
  Graph,
  type GraphLabel,
  layout,
  type NodeLabel,
} from "@dagrejs/dagre";
import type {
  SchemaEdge,
  SchemaFolder,
  SchemaGraph,
  SchemaNode,
} from "../../model/types";
import { STAMP_BAND } from "../scene/stage";

/** What a district mostly holds. The scene colours and labels from this. */
export type DistrictKind = "structure" | "compositions" | "elements" | "mixed";

export type Placement = {
  id: string;
  position: { x: number; z: number };
  /** Height above the ground. Only the focus layout raises anything off it. */
  y?: number;
  /**
   * 0 is a building at its own height, 1 a flat plate. Focus mode presses everything
   * outside the neighbourhood down to a plate so its layout has a map to stand on,
   * and the scene tweens the value in between.
   */
  flatten?: number;
  footprint: number;
  height: number;
  floors: number;
  /** Id of the district this building stands in. */
  district: string;
  /** What the district mostly holds. The scene takes each building's colour from it. */
  districtKind: DistrictKind;
  // ponytail: a nested folder is recorded and nothing else. Buildings stay in their
  // top-level district and the scene tints them by this id. Sub-districts, with their
  // own slab and street, are the upgrade if a real schema nests two levels deep.
  /** Id of the nested folder this type sits in, when it sits in one. */
  folder?: string;
  /** Seconds to wait before this building rises, so the city builds outward. */
  introDelay: number;
};

/** The ground a district covers, for its slab and its label. */
export type District = {
  id: string;
  name: string;
  kind: DistrictKind;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centre: { x: number; z: number };
};

export type CityBounds = {
  width: number;
  depth: number;
  centre: { x: number; z: number };
};

/** Base size before own properties and the overview readability multiplier. */
const FOOTPRINT = 2;
/**
 * Ground between two buildings in the same row or grid. Three quarters of a
 * footprint: wide enough for a road to thread a column between two neighbours, and
 * narrow enough that a block reads as a block. At one and a half footprints, with a
 * nine-unit street, the seeded city covered its plates about 8 percent.
 */
const GAP = FOOTPRINT * 0.75;
/**
 * The street between two dagre ranks and between a district's ranked block and its
 * packed grid. Six units carries a dozen lanes at the spacing the roads keep, and
 * matches the ground's grid square.
 */
export const STREET = 6;
/**
 * The void between two islands, which is twice a street. At one street the islands
 * read as one plate with seams in it. The roads between districts route over it.
 */
export const DISTRICT_GAP = STREET * 2;
/**
 * Ground between a district's outermost building and the edge of its island. The
 * scene draws the slab from it, and the layout needs it here to know how much of the
 * name's band the padding already covers.
 */
export const ISLAND_PAD = 2;
/**
 * Ground a district holds empty south of its last row, on top of the island's own
 * padding, so its name has somewhere to stand. The name is printed on the ground and
 * writes no depth, so a row standing on it would eat the letters.
 */
const STAMP_MARGIN = Math.max(0, STAMP_BAND - ISLAND_PAD);
const FLOOR_HEIGHT = 0.6;
/** Buildings in one row, everywhere. A wider rank folds onto more rows. */
export const ROW_LIMIT = 8;
/**
 * The most buildings a rank can hold and still share its band with the rank below.
 * Two is where a rank stops paying for the street under it: a fuller rank reads as a
 * generation of its own, and merging those would widen districts that fold fine.
 *
 * ponytail: a fixed threshold and a greedy left-to-right pass, so a run of ranks
 * sized 1, 1, 3, 1 merges the first two and starts again at the fourth rather than
 * asking which grouping leaves the district squarest. Raising it to four takes the
 * pathological fixture's Editorial folder from 2.12 to about 1.8 and costs the
 * medium fixture's Pages a wider band and more road crossings, so it stays at two
 * until a real schema asks otherwise; packing bands by district aspect is the
 * upgrade, and it is a search rather than a scan.
 */
export const SPARSE_RANK = 2;
const INTRO_STAGGER = 0.06;
const EMPTY_BOX = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
/** Types the schema files nowhere, and types nothing places when there are no folders. */
const UNFILED = "unfiled";
const UNPLACED = "unplaced";

/** What a single type is, before districts are drawn around groups of them. */
type Role = "structure" | "compositions" | "elements" | "unplaced";

type Group = { id: string; name: string; members: SchemaNode[] };
const rankCache = new WeakMap<Group, Placement[]>();
type Laid = Group & {
  kind: DistrictKind;
  hasStructure: boolean;
  placements: Placement[];
  /** The packed grid's members, which the layout reorders once the city is placed. */
  loose: Placement[];
};

/**
 * Places every node exactly once, in a district per top-level folder.
 *
 * The schema's own folders are the grouping an editor already knows, so they drive the
 * city. A schema with no folders falls back to four districts named by role, which is
 * the same partition the city used before folders were read. Inside a district the
 * allowed-child edges among its own members rank top to bottom, and everything with no
 * such edge packs into a grid below the ranked block.
 */
export function cityDistricts(graph: SchemaGraph): {
  placements: Placement[];
  districts: District[];
} {
  const nodes = [...graph.nodes].sort(compareByAlias);
  if (nodes.length === 0) return { placements: [], districts: [] };

  const known = new Map(nodes.map((node) => [node.id, node]));
  const alias = (id: string) => known.get(id)?.alias ?? "";
  // A block editor can name an Element Type that was deleted, and medium.json is
  // exported before the backend fills in edges, so both cases are dropped here rather
  // than crashing dagre with a node it was never given.
  const edges = graph.edges
    ? graph.edges
        .filter((edge) => known.has(edge.from) && known.has(edge.to))
        .sort(
          (a, b) =>
            compare(alias(a.from), alias(b.from)) ||
            compare(alias(a.to), alias(b.to)) ||
            compare(a.kind, b.kind) ||
            compare(a.propertyAlias ?? "", b.propertyAlias ?? "")
        )
    : [];

  const roads = edges.filter((edge) => edge.kind === "allowedChild");
  const structure = reachableFromRoots(nodes, roads, known);
  const composed = new Set(
    edges.filter((edge) => edge.kind === "composition").map((edge) => edge.to)
  );
  const roleOf = (node: SchemaNode): Role =>
    node.isElement
      ? "elements"
      : structure.has(node.id)
        ? "structure"
        : composed.has(node.id)
          ? "compositions"
          : "unplaced";

  const filed = byFolder(nodes, graph.folders ?? []);
  // A schema with no folders, or with none that hold a type, gets districts by role.
  const groups = filed.some((group) => group.id !== UNFILED)
    ? filed
    : byRole(nodes, roleOf);
  // Laid out and arranged twice: the first city says where each loose type's
  // connections stand, and the second packs every grid in that order.
  const layAll = (order?: Map<string, number>) =>
    groups.map((group) => layoutDistrict(group, roads, roleOf, order));
  const first = layAll();
  arrange(first, edges);
  const laid = layAll(looseOrder(first, edges));
  arrange(laid, edges);
  return {
    placements: laid.flatMap((district) => district.placements),
    districts: laid.map(districtOf),
  };
}

/** The placements alone, for a caller with no use for the district boxes. */
export function layoutCity(graph: SchemaGraph): Placement[] {
  return cityDistricts(graph).placements;
}

/**
 * The box the camera has to frame, including each building's own footprint and `pad`
 * units of ground around the lot. The islands are the districts padded by the same
 * number, and the outermost district touches the outermost building, so padding the
 * whole box is the same box as the union of the padded islands.
 */
export function cityBounds(placements: Placement[], pad = 0): CityBounds {
  const box = boxOf(placements);
  return {
    width: box.maxX - box.minX + pad * 2,
    depth: box.maxZ - box.minZ + pad * 2,
    centre: { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 },
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Not localeCompare, because its order depends on the machine's locale and the city
// has to be the same everywhere.
const compareByAlias = (a: SchemaNode, b: SchemaNode) =>
  compare(a.alias, b.alias);

const footprintOf = (node: SchemaNode) =>
  1.2 * (FOOTPRINT + 0.25 * Math.min(Math.max(node.ownPropertyCount, 0), 12));

// ponytail: one floor per group, and a type with no groups still gets a ground floor.
// M1's building work splits a Tab from a Group; today they are the same slab.
const floorsOf = (node: SchemaNode) => Math.max(1, node.groups?.length ?? 0);

/** One district per top-level folder, plus Unfiled for the types no folder holds. */
function byFolder(nodes: SchemaNode[], folders: SchemaFolder[]): Group[] {
  const parentOf = new Map(
    folders.map((folder) => [folder.id, folder.parentId])
  );
  const nameOf = new Map(folders.map((folder) => [folder.id, folder.name]));
  const topOf = (id: string) => {
    let at = id;
    // Bounded by the folder count, so a parent cycle cannot spin here.
    for (let hops = folders.length; hops > 0; hops--) {
      const parent = parentOf.get(at);
      // biome-ignore lint/suspicious/noEqualsToNull: parentOf holds null for a top-level folder, so this has to catch null and undefined alike.
      if (parent == null) break;
      at = parent;
    }
    return at;
  };

  const groups = new Map<string, Group>();
  for (const node of nodes) {
    // A folderId the folder list does not contain is a deleted container, so the type
    // reads as unfiled rather than inventing a nameless district for it.
    const top =
      node.folderId !== null && nameOf.has(node.folderId)
        ? topOf(node.folderId)
        : UNFILED;
    const group = groups.get(top);
    if (group) group.members.push(node);
    else
      groups.set(top, {
        id: top,
        name: nameOf.get(top) ?? "Unfiled",
        members: [node],
      });
  }
  return [...groups.values()].sort((a, b) => compare(a.name, b.name));
}

/** The fallback for a schema with no folders: four districts named by what they hold. */
function byRole(
  nodes: SchemaNode[],
  roleOf: (node: SchemaNode) => Role
): Group[] {
  const named: { id: string; name: string; role: Role }[] = [
    { id: "pages", name: "Pages", role: "structure" },
    { id: "compositions", name: "Compositions", role: "compositions" },
    { id: "elements", name: "Elements", role: "elements" },
    { id: UNPLACED, name: "Unplaced", role: "unplaced" },
  ];
  return named
    .map(({ id, name, role }) => ({
      id,
      name,
      members: nodes.filter((node) => roleOf(node) === role),
    }))
    .filter((group) => group.members.length > 0);
}

/** The role more than half the members share, or `mixed` when none does. */
function kindOf(
  members: SchemaNode[],
  roleOf: (node: SchemaNode) => Role
): DistrictKind {
  const counts = new Map<Role, number>();
  for (const member of members) {
    const role = roleOf(member);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  for (const [role, count] of counts) {
    if (role !== "unplaced" && count * 2 > members.length) return role;
  }
  return "mixed";
}

/**
 * Lays one district out around its own origin. Its allowed-child edges rank the members
 * they touch; everything else packs into a grid one street below that block.
 */
function layoutDistrict(
  group: Group,
  roads: SchemaEdge[],
  roleOf: (node: SchemaNode) => Role,
  order?: Map<string, number>
): Laid {
  const mine = new Set(group.members.map((node) => node.id));
  const inside = roads.filter(
    (road) => road.from !== road.to && mine.has(road.from) && mine.has(road.to)
  );
  const linked = new Set(inside.flatMap((road) => [road.from, road.to]));
  const kind = kindOf(group.members, roleOf);

  // The second pass only reorders the grid, so dagre runs once per group. The copy
  // is because arranging the city moves placements in place.
  const once =
    rankCache.get(group) ??
    layoutRanks(
      group.members.filter((node) => linked.has(node.id)),
      inside,
      group.id,
      kind
    );
  rankCache.set(group, once);
  const ranked = once.map((placement) => ({
    ...placement,
    position: { ...placement.position },
  }));
  const box = boxOf(ranked);
  const rank = (node: SchemaNode) => order?.get(node.id) ?? 0;
  // A stable sort, so without an order the members keep their alias order.
  const loose = group.members
    .filter((node) => !linked.has(node.id))
    .sort((a, b) => rank(a) - rank(b));
  const packed = layoutGrid(
    loose,
    group.id,
    kind,
    ranked.length > 0 ? box.maxZ + STREET : 0,
    // The grid keeps rippling where the ranks stopped, so a district lights up once.
    new Set(ranked.map((placement) => placement.introDelay)).size
  );

  return {
    ...group,
    kind,
    hasStructure: group.members.some((node) => roleOf(node) === "structure"),
    placements: [...ranked, ...packed],
    loose: packed,
  };
}

/**
 * Puts the districts on the map, in bands by kind.
 *
 * The structure districts, and any district holding structure, Unfiled included,
 * form the middle row. The largest goes first, then each next one is the district
 * with the most connections into the row so far, placed at whichever end of the row
 * it shares more of them with. Compositions go north with their bottom edges on one
 * line and elements south with their top edges on one line, each centred over the
 * types it connects to as far as its neighbour in the row allows, so a composition
 * district sits above the pages using it and an element district below the pages
 * whose block editors hold it. A mixed district with no structure stacks east of
 * everything. A void of two streets separates any two islands, and the city's
 * north-west corner is the origin.
 */
function arrange(laid: Laid[], edges: SchemaEdge[]) {
  const home = new Map<string, Laid>();
  const at = new Map<string, Placement>();
  for (const district of laid) {
    for (const placement of district.placements) {
      home.set(placement.id, district);
      at.set(placement.id, placement);
    }
  }
  // Edges between two different districts, each end resolved to its district once.
  const crossing = edges.flatMap((edge) => {
    const from = home.get(edge.from) as Laid;
    const to = home.get(edge.to) as Laid;
    return from === to ? [] : [{ edge, from, to }];
  });
  const bandOf = (district: Laid) =>
    district.kind === "compositions"
      ? "north"
      : district.kind === "elements"
        ? "south"
        : district.kind === "structure" || district.hasStructure
          ? "middle"
          : "east";
  const bySize = (a: Laid, b: Laid) =>
    b.members.length - a.members.length || compare(a.name, b.name);
  const linksBetween = (a: Laid, others: readonly Laid[]) =>
    crossing.filter(
      ({ from, to }) =>
        (from === a && others.includes(to)) ||
        (to === a && others.includes(from))
    ).length;

  const row: Laid[] = [];
  const middle = laid.filter((d) => bandOf(d) === "middle").sort(bySize);
  while (middle.length > 0) {
    middle.sort(
      (a, b) => linksBetween(b, row) - linksBetween(a, row) || bySize(a, b)
    );
    const next = middle.shift() as Laid;
    const [first] = row;
    const last = row[row.length - 1];
    if (
      first &&
      last &&
      linksBetween(next, [first]) > linksBetween(next, [last])
    )
      row.unshift(next);
    else row.push(next);
  }
  const placed = new Set<Laid>();
  let x = 0;
  let middleDepth = 0;
  for (const district of row) {
    const size = moveTo(district, x, 0);
    x += size.width + DISTRICT_GAP;
    middleDepth = Math.max(middleDepth, size.depth);
    placed.add(district);
  }

  // The mean x of every placed type a district connects to, or null for none.
  const wantedCentre = (district: Laid) => {
    const xs = crossing.flatMap(({ edge, from, to }) => {
      if (from === district && placed.has(to))
        return [(at.get(edge.to) as Placement).position.x];
      if (to === district && placed.has(from))
        return [(at.get(edge.from) as Placement).position.x];
      return [];
    });
    return xs.length > 0
      ? xs.reduce((sum, value) => sum + value, 0) / xs.length
      : null;
  };
  // A row sweeps west to east in the order of the centres its districts want, and
  // each one stands as close to its own as the one before it allows.
  const sweep = (band: "north" | "south") => {
    const wanted = laid
      .filter((d) => bandOf(d) === band)
      .map((district) => ({ district, centre: wantedCentre(district) }))
      .sort(
        (a, b) =>
          (a.centre ?? Number.POSITIVE_INFINITY) -
            (b.centre ?? Number.POSITIVE_INFINITY) ||
          bySize(a.district, b.district)
      );
    let cursor = Number.NEGATIVE_INFINITY;
    for (const { district, centre } of wanted) {
      const box = boxOf(district.placements);
      const width = box.maxX - box.minX;
      const depth = box.maxZ - box.minZ + STAMP_MARGIN;
      const own = centre === null ? 0 : centre - width / 2;
      const left = Math.max(cursor, own);
      moveTo(
        district,
        left,
        band === "north" ? -DISTRICT_GAP - depth : middleDepth + DISTRICT_GAP
      );
      cursor = left + width + DISTRICT_GAP;
    }
    for (const { district } of wanted) placed.add(district);
  };
  sweep("north");
  sweep("south");

  // East of every row, so a wide row can never grow into this column.
  let eastX = 0;
  for (const district of placed)
    eastX = Math.max(eastX, boxOf(district.placements).maxX + DISTRICT_GAP);
  let eastZ = 0;
  for (const district of laid.filter((d) => bandOf(d) === "east").sort(bySize))
    eastZ += moveTo(district, eastX, eastZ).depth + DISTRICT_GAP;

  const box = boxOf([...at.values()]);
  for (const placement of at.values()) {
    placement.position.x -= box.minX;
    placement.position.z -= box.minZ;
  }
}

/**
 * Moves a district so its buildings' box starts at (toX, toZ), and returns the ground
 * it covers, which includes the name's band south of its last row.
 */
function moveTo(island: Laid, toX: number, toZ: number) {
  const box = boxOf(island.placements);
  for (const placement of island.placements) {
    placement.position.x += toX - box.minX;
    placement.position.z += toZ - box.minZ;
  }
  return {
    width: box.maxX - box.minX,
    depth: box.maxZ - box.minZ + STAMP_MARGIN,
  };
}

function districtOf(island: Laid): District {
  const box = boxOf(island.placements);
  const maxZ = box.maxZ + STAMP_MARGIN;
  return {
    id: island.id,
    name: island.name,
    kind: island.kind,
    minX: box.minX,
    maxX: box.maxX,
    minZ: box.minZ,
    maxZ,
    centre: { x: (box.minX + box.maxX) / 2, z: (box.minZ + maxZ) / 2 },
  };
}

/**
 * The order each district's packed grid should take, read off a first arrangement of
 * the city: members by the mean x of every type they connect to, so an Element Type
 * lands under the pages that hold it, a composition over the pages that use it, and
 * two types sharing compositions end up side by side. The grid fills column by
 * column, west to east, so that order is the order along x.
 *
 * Two passes, where each swaps the members over the first arrangement's slots,
 * because one grid's order moves the types the next grid reads. Members with no
 * connection keep their alias order after the rest.
 *
 * ponytail: a barycentre on x alone. The grids are at most eight wide and the
 * districts already sit by kind, so x is the axis most links run along. Placing by
 * assignment in both axes is the upgrade if one grid ever holds hundreds.
 */
function looseOrder(laid: Laid[], edges: SchemaEdge[]): Map<string, number> {
  const at = new Map<string, Placement>();
  for (const district of laid)
    for (const placement of district.placements)
      at.set(placement.id, placement);
  const neighbours = new Map<string, Placement[]>();
  const link = (a: string, b: string) => {
    const other = at.get(b) as Placement;
    const list = neighbours.get(a);
    if (list) list.push(other);
    else neighbours.set(a, [other]);
  };
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }
  const centreOf = (id: string) => {
    const list = neighbours.get(id) ?? [];
    return list.length > 0
      ? list.reduce((sum, other) => sum + other.position.x, 0) / list.length
      : Number.POSITIVE_INFINITY;
  };

  const order = new Map<string, number>();
  for (let pass = 0; pass < 2; pass++) {
    for (const district of laid) {
      const slots = district.loose
        .map(({ position }) => position)
        .sort((a, b) => a.x - b.x || a.z - b.z);
      // The loose list is in alias order and the sort is stable, so ties keep it.
      const keyed = district.loose
        .map((placement) => ({ placement, centre: centreOf(placement.id) }))
        .sort((a, b) =>
          a.centre === b.centre ? 0 : a.centre < b.centre ? -1 : 1
        );
      keyed.forEach(({ placement }, i) => {
        placement.position = { ...(slots[i] as Placement["position"]) };
        order.set(placement.id, i);
      });
    }
  }
  return order;
}

function reachableFromRoots(
  nodes: SchemaNode[],
  roads: SchemaEdge[],
  known: Map<string, SchemaNode>
) {
  const children = new Map<string, string[]>();
  for (const road of roads) {
    const list = children.get(road.from);
    if (list) list.push(road.to);
    else children.set(road.from, [road.to]);
  }

  const reached = new Set<string>();
  const queue: string[] = [];
  for (const node of nodes) {
    if (node.allowedAsRoot && !node.isElement) {
      reached.add(node.id);
      queue.push(node.id);
    }
  }
  // Breadth first over the queue as it grows. The reached check ends a cycle.
  // biome-ignore lint/style/useForOf: the loop re-reads the length the body appends to.
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i] as string) ?? []) {
      if (reached.has(child) || known.get(child)?.isElement) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  return reached;
}

function layoutRanks(
  nodes: SchemaNode[],
  roads: SchemaEdge[],
  district: string,
  kind: DistrictKind
): Placement[] {
  if (nodes.length === 0) return [];

  const parents = new Map<string, string[]>();
  for (const road of roads) {
    if (road.from === road.to) continue;
    const list = parents.get(road.to);
    if (list) list.push(road.from);
    else parents.set(road.to, [road.from]);
  }

  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  // Only the rank and the left-to-right order inside it are read back, so dagre needs
  // no separation settings. Its own x would be useless here: an allowed-child graph is
  // shallow and wide, and the dummy nodes it threads through a rank for every edge that
  // skips one stretch a rank of twenty types across hundreds of units.
  graph.setGraph({ rankdir: "TB", ranker: "network-simplex" });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    const footprint = footprintOf(node);
    graph.setNode(node.id, { width: footprint, height: footprint });
  }
  for (const road of roads) {
    // A type that allows itself as a child is a fact about the schema with no place in
    // a ranking. Longer cycles stay, and dagre reverses the back edges itself.
    if (road.from !== road.to) graph.setEdge(road.from, road.to);
  }
  layout(graph);

  const at = (id: string) => graph.node(id) as { x: number; y: number };
  // Dagre keeps the rank number in its own layout copy and only writes x and y back,
  // so nodes sharing a y are a rank and their y in order is the rank order.
  const ranks = new Map<number, SchemaNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(at(node.id).y);
    if (rank) rank.push(node);
    else ranks.set(at(node.id).y, [node]);
  }

  // Where each already-placed building sits, so the next rank can line up under it.
  const placedX = new Map<string, number>();
  // A node whose parents are all further up, or absent, sorts to the right of every
  // node that has one in the rank the roads come from.
  const parentColumn = (id: string) => {
    let leftmost = Number.POSITIVE_INFINITY;
    for (const parent of parents.get(id) ?? []) {
      const x = placedX.get(parent);
      if (x !== undefined && x < leftmost) leftmost = x;
    }
    return leftmost;
  };

  // Ordering a rank by the column its parents landed in is what keeps the roads
  // into a folded rank from crossing each other. Dagre's own order breaks the tie,
  // which is what rank 0 and any node with no placed parent sort on. A rank inside a
  // merged band still sorts after the rank to its left, so it sees those columns.
  const ordered = (members: SchemaNode[]) =>
    [...members].sort(
      (a, b) =>
        parentColumn(a.id) - parentColumn(b.id) ||
        at(a.id).x - at(b.id).x ||
        compare(a.alias, b.alias)
    );

  const placements: Placement[] = [];
  let z = 0;
  let step = 0;
  for (const band of bandRanks(
    [...ranks.keys()]
      .sort((a, b) => a - b)
      .map((y) => ranks.get(y) as SchemaNode[]),
    roads
  )) {
    const members = band.flat();
    // One depth for the whole band, so a row of narrow buildings cannot slide under
    // the row behind it.
    const depth = Math.max(...members.map(footprintOf));

    if (band.length === 1 && members.length > ROW_LIMIT) {
      // A rank too wide for one row folds onto more, a building plus a gap apart.
      const rows = Math.ceil(members.length / ROW_LIMIT);
      const sorted = ordered(members);
      for (let i = 0; i < sorted.length; i += ROW_LIMIT) {
        const row = sorted.slice(i, i + ROW_LIMIT);
        const width =
          row.reduce((sum, node) => sum + footprintOf(node), 0) +
          GAP * (row.length - 1);
        const rowZ = z + (i / ROW_LIMIT) * (depth + GAP) + depth / 2;
        let x = -width / 2;
        for (const node of row) {
          const centre = x + footprintOf(node) / 2;
          placements.push(place(node, centre, rowZ, district, kind, step));
          placedX.set(node.id, centre);
          x += footprintOf(node) + GAP;
        }
      }
      z += rows * depth + (rows - 1) * GAP + STREET;
      step += 1;
      continue;
    }

    // One row for the whole band: a gap between two buildings of one rank, a street
    // between the last of one rank and the first of the next, so the generations
    // still read apart. The road between them dips into the street below the band.
    const width =
      members.reduce((sum, node) => sum + footprintOf(node), 0) +
      GAP * (members.length - band.length) +
      STREET * (band.length - 1);
    const rowZ = z + depth / 2;
    let x = -width / 2;
    for (const rank of band) {
      for (const node of ordered(rank)) {
        const centre = x + footprintOf(node) / 2;
        placements.push(place(node, centre, rowZ, district, kind, step));
        placedX.set(node.id, centre);
        x += footprintOf(node) + GAP;
      }
      x += STREET - GAP;
      step += 1;
    }
    z += depth + STREET;
  }
  return placements;
}

/**
 * Which ranks share a band.
 *
 * A rank of one or two buildings still cost a whole band and the nine-unit street
 * under it, so the pathological fixture's twelve-deep chain of single types ranked
 * its Pages folder into 61 by 229 units at eight percent fill, and the camera framed
 * mostly empty ground to show it. Consecutive sparse ranks now stand side by side in
 * one band instead, which turns that chain into a row along one street: 85 by 147.
 *
 * Only sparse ranks merge, and only while the band still fits a row of eight. A rank
 * that fills a row already reads as a generation, and merging those would widen every
 * district that was not the problem and put more roads on each street.
 *
 * A band never merges past a back edge. Dagre reverses cycles to rank them, so a ring
 * whose ranks were folded side by side would run one of its roads right to left while
 * the rest ran left to right, and the band would stop reading as one generation
 * feeding the next.
 */
function bandRanks(
  order: SchemaNode[][],
  roads: SchemaEdge[]
): SchemaNode[][][] {
  const rankOf = new Map<string, number>();
  order.forEach((rank, i) => {
    for (const node of rank) rankOf.set(node.id, i);
  });
  // The rank span of every edge that runs back up the ranking, low end first.
  const backwards: [number, number][] = [];
  for (const road of roads) {
    const from = rankOf.get(road.from);
    const to = rankOf.get(road.to);
    if (from !== undefined && to !== undefined && from > to)
      backwards.push([to, from]);
  }

  const bands: SchemaNode[][][] = [];
  order.forEach((rank, i) => {
    const open = bands[bands.length - 1];
    const size = open ? open.reduce((sum, held) => sum + held.length, 0) : 0;
    const first = i - (open?.length ?? 0);
    const fits =
      open !== undefined &&
      rank.length <= SPARSE_RANK &&
      (open[open.length - 1] as SchemaNode[]).length <= SPARSE_RANK &&
      size + rank.length <= ROW_LIMIT &&
      !backwards.some(([to, from]) => to >= first && from <= i);
    if (fits) (open as SchemaNode[][]).push(rank);
    else bands.push([rank]);
  });
  return bands;
}

/**
 * Packs members into a table centred on the district's axis, filled column by column
 * so the order the members arrive in runs west to east. Each column is as wide as its
 * widest member and each row as deep as its deepest, so one large type widens only
 * its own column. Rows are balanced: nine members take two rows of five and four,
 * not eight and one.
 */
function layoutGrid(
  nodes: SchemaNode[],
  district: string,
  kind: DistrictKind,
  originZ: number,
  firstStep: number
): Placement[] {
  if (nodes.length === 0) return [];

  const rows = Math.ceil(nodes.length / ROW_LIMIT);
  const columns = Math.ceil(nodes.length / rows);
  const widths = new Array<number>(columns).fill(0);
  const depths = new Array<number>(rows).fill(0);
  nodes.forEach((node, i) => {
    const column = Math.floor(i / rows);
    widths[column] = Math.max(widths[column] as number, footprintOf(node));
    depths[i % rows] = Math.max(depths[i % rows] as number, footprintOf(node));
  });
  const lefts = offsets(widths);
  const tops = offsets(depths);
  const width =
    (lefts[columns - 1] as number) + (widths[columns - 1] as number);
  return nodes.map((node, i) => {
    const column = Math.floor(i / rows);
    const row = i % rows;
    return place(
      node,
      (lefts[column] as number) + (widths[column] as number) / 2 - width / 2,
      originZ + (tops[row] as number) + (depths[row] as number) / 2,
      district,
      kind,
      firstStep + row
    );
  });
}

/** Where each cell of a run starts, one gap after the cell before it. */
function offsets(sizes: number[]): number[] {
  let at = 0;
  return sizes.map((size) => {
    const start = at;
    at += size + GAP;
    return start;
  });
}

function place(
  node: SchemaNode,
  x: number,
  z: number,
  district: string,
  districtKind: DistrictKind,
  step: number
): Placement {
  const floors = floorsOf(node);
  return {
    id: node.id,
    position: { x, z },
    footprint: footprintOf(node),
    height: floors * FLOOR_HEIGHT,
    floors,
    district,
    districtKind,
    // A folder that is not the district's own is a folder nested inside it.
    ...(node.folderId && node.folderId !== district
      ? { folder: node.folderId }
      : {}),
    introDelay: step * INTRO_STAGGER,
  };
}

function boxOf(placements: Placement[]) {
  if (placements.length === 0) return EMPTY_BOX;

  return placements.reduce(
    (box, { position, footprint }) => ({
      minX: Math.min(box.minX, position.x - footprint / 2),
      maxX: Math.max(box.maxX, position.x + footprint / 2),
      minZ: Math.min(box.minZ, position.z - footprint / 2),
      maxZ: Math.max(box.maxZ, position.z + footprint / 2),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    }
  );
}
