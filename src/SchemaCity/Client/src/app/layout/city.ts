// Turns a SchemaGraph into ground positions. Pure: no three.js, no React, no DOM.
// The scene reads the output and owns everything visual.
import {
  Graph,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
  layout,
} from "@dagrejs/dagre";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../../model/types";

export type District = "structure" | "detached" | "element";

export type Placement = {
  id: string;
  position: { x: number; z: number };
  footprint: number;
  height: number;
  floors: number;
  district: District;
  /** Seconds to wait before this building rises, so the city builds outward. */
  introDelay: number;
};

export type CityBounds = {
  width: number;
  depth: number;
  centre: { x: number; z: number };
};

/** A building is 2 units square before its own properties widen it. */
const FOOTPRINT = 2;
/** Gap between two dagre ranks, and the street between two districts. */
const RANK_GAP = 6;
const FLOOR_HEIGHT = 0.6;
const GRID_COLUMNS = 8;
const INTRO_STAGGER = 0.06;
const EMPTY_BOX = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

/**
 * Places every node exactly once, in three districts.
 *
 * The structure district is whatever an editor can reach by creating content from a
 * root, ranked top to bottom by dagre. The other two are packed grids, because a
 * detached type or an element type has no position worth computing.
 */
export function layoutCity(graph: SchemaGraph): Placement[] {
  const nodes = [...graph.nodes].sort(compareByAlias);
  if (nodes.length === 0) return [];

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
            compare(a.propertyAlias ?? "", b.propertyAlias ?? ""),
        )
    : [];

  const roads = edges.filter((edge) => edge.kind === "allowedChild");
  const structure = reachableFromRoots(nodes, roads, known);
  const districtOf = (node: SchemaNode): District =>
    node.isElement
      ? "element"
      : structure.has(node.id)
        ? "structure"
        : "detached";
  const inDistrict = (district: District) =>
    nodes.filter((node) => districtOf(node) === district);

  const ranked = layoutRanks(
    inDistrict("structure"),
    roads.filter((road) => structure.has(road.from) && structure.has(road.to)),
  );
  const s = boxOf(ranked);

  // Element types go south of the structure district, one street down.
  const elements = layoutGrid(inDistrict("element"), "element", s.minX, s.maxZ + RANK_GAP);

  // Detached types go east of both, so a wide element grid can never grow into them.
  const detached = layoutGrid(
    inDistrict("detached"),
    "detached",
    Math.max(s.maxX, boxOf(elements).maxX) + RANK_GAP,
    s.minZ,
  );

  return [...ranked, ...elements, ...detached];
}

/** The box the camera has to frame, including each building's own footprint. */
export function cityBounds(placements: Placement[]): CityBounds {
  const box = boxOf(placements);
  return {
    width: box.maxX - box.minX,
    depth: box.maxZ - box.minZ,
    centre: { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 },
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Not localeCompare, because its order depends on the machine's locale and the city
// has to be the same everywhere.
const compareByAlias = (a: SchemaNode, b: SchemaNode) => compare(a.alias, b.alias);

const footprintOf = (node: SchemaNode) =>
  FOOTPRINT + 0.25 * Math.min(Math.max(node.ownPropertyCount, 0), 12);

// ponytail: one floor per group, and a type with no groups still gets a ground floor.
// M1's building work splits a Tab from a Group; today they are the same slab.
const floorsOf = (node: SchemaNode) => Math.max(1, node.groups?.length ?? 0);

function reachableFromRoots(
  nodes: SchemaNode[],
  roads: SchemaEdge[],
  known: Map<string, SchemaNode>,
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
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i] as string) ?? []) {
      if (reached.has(child) || known.get(child)?.isElement) continue;
      reached.add(child);
      queue.push(child);
    }
  }
  return reached;
}

function layoutRanks(nodes: SchemaNode[], roads: SchemaEdge[]): Placement[] {
  if (nodes.length === 0) return [];

  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  graph.setGraph({
    rankdir: "TB",
    ranker: "network-simplex",
    nodesep: FOOTPRINT,
    ranksep: RANK_GAP,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    // Dagre separates nodes in the units it is given, so feeding it world units means
    // the result needs no scaling and a wide building gets the room it needs.
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
  // so the distinct y values in order are the ranks the ripple needs.
  const ranks = [...new Set(nodes.map((node) => at(node.id).y))].sort(
    (a, b) => a - b,
  );

  return nodes.map((node) => {
    const { x, y } = at(node.id);
    return place(node, x, y, "structure", ranks.indexOf(y));
  });
}

function layoutGrid(
  nodes: SchemaNode[],
  district: District,
  originX: number,
  originZ: number,
): Placement[] {
  if (nodes.length === 0) return [];

  // One pitch for the whole grid, so squares of different widths still cannot touch.
  const pitch = Math.max(...nodes.map(footprintOf)) + FOOTPRINT;
  return nodes.map((node, i) => {
    const row = Math.floor(i / GRID_COLUMNS);
    const column = i % GRID_COLUMNS;
    return place(
      node,
      originX + (column + 0.5) * pitch,
      originZ + (row + 0.5) * pitch,
      district,
      row,
    );
  });
}

function place(
  node: SchemaNode,
  x: number,
  z: number,
  district: District,
  step: number,
): Placement {
  const floors = floorsOf(node);
  return {
    id: node.id,
    position: { x, z },
    footprint: footprintOf(node),
    height: floors * FLOOR_HEIGHT,
    floors,
    district,
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
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    },
  );
}
