// Groups a schema the way an editor meets it: what can be created under each root,
// which Element Types each block editor offers, the compositions, and whatever no
// root reaches. Pure: no three.js, no React, no DOM. city.ts lays the groups out.
import type { SchemaEdge, SchemaNode } from "../../model/types";

/**
 * A neighbourhood by id, before sizes: a parent and the families below it, each a
 * child followed by its own children. No head is a plain table.
 */
export type IdCluster = { head: string | null; families: string[][] };

export type StructureGroup = {
  id: string;
  name: string;
  members: SchemaNode[];
  clusters: IdCluster[];
  /** The block editor each Element Type is grouped under, for the socket outlines. */
  sockets: Map<string, string>;
};

/**
 * The most children a child may have and still stand in its parent's neighbourhood,
 * beside it in one family. A child with more, or with grandchildren, heads a
 * neighbourhood of its own beside its parent's.
 */
const FAMILY_LIMIT = 3;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One district per type allowed at root, holding everything that root reaches first,
 * then Compositions, Elements and Unreachable.
 *
 * A type several roots or parents allow is placed once, under the parent a breadth
 * first walk from every root reaches it from first. Roots and children are walked in
 * alias order, so the answer is the same on every machine, and the traces from the
 * other parents show the rest.
 *
 * `nodes` and `edges` arrive sorted, as cityDistricts sorts them.
 */
export function structureGroups(
  nodes: readonly SchemaNode[],
  edges: readonly SchemaEdge[]
): StructureGroup[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const alias = (id: string) => byId.get(id)?.alias ?? "";
  const byAlias = (a: string, b: string) => compare(alias(a), alias(b));

  // Allowed children per type, Element Types left out: they are never created in
  // the content tree, whatever a stale rule says.
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "allowedChild" || edge.from === edge.to) continue;
    const child = byId.get(edge.to);
    if (!(byId.has(edge.from) && child) || child.isElement) continue;
    const list = children.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    children.set(edge.from, list);
    hasParent.add(edge.to);
  }
  for (const list of children.values()) list.sort(byAlias);

  const roots = nodes
    .filter((node) => node.allowedAsRoot && !node.isElement)
    .map((node) => node.id);
  const reached = walk(roots, children, new Set(byId.keys()), emptyWalk());

  const composed = new Set(
    edges.filter((edge) => edge.kind === "composition").map((edge) => edge.to)
  );
  const left = nodes.filter(
    (node) => !(node.isElement || reached.home.has(node.id))
  );
  // The inspector's rule: composed by something, and nothing can create it.
  const isComposition = (node: SchemaNode) =>
    composed.has(node.id) && !hasParent.has(node.id) && !node.allowedAsRoot;

  const groups: StructureGroup[] = roots.map((root) => {
    const members = nodes.filter((node) => reached.home.get(node.id) === root);
    return {
      id: `root/${root}`,
      name: byId.get(root)?.name ?? root,
      members,
      clusters: clustersOf([root], reached.tree),
      sockets: new Map(),
    };
  });

  const compositions = left.filter(isComposition);
  groups.push({
    id: "compositions",
    name: "Compositions",
    members: compositions,
    clusters: [table(compositions.map((node) => node.id))],
    sockets: new Map(),
  });

  const elements = nodes.filter((node) => node.isElement);
  const sockets = socketsOf(nodes, elements);
  groups.push({
    id: "elements",
    name: "Elements",
    members: elements,
    clusters: socketClusters(elements, sockets),
    sockets,
  });

  // Whatever no root reaches: its own forest, headed by the types with no parent in
  // it. A ring with no way in has no such type, so its alias-first member heads it.
  const stranded = left.filter((node) => !isComposition(node));
  const strandedIds = new Set(stranded.map((node) => node.id));
  const parented = new Set(
    [...strandedIds].flatMap((id) => children.get(id) ?? [])
  );
  const heads = [...strandedIds].filter((id) => !parented.has(id));
  const forest = walk(heads, children, strandedIds, emptyWalk());
  for (const node of stranded) {
    if (forest.home.has(node.id)) continue;
    heads.push(node.id);
    walk([node.id], children, strandedIds, forest);
  }
  groups.push({
    id: "unreachable",
    name: "Unreachable",
    members: stranded,
    clusters: gatherLoners(clustersOf(heads, forest.tree)),
    sockets: new Map(),
  });

  return groups.filter((group) => group.members.length > 0);
}

type Walk = {
  /** The head each reached type was reached from. */
  home: Map<string, string>;
  /** Children per parent along the walk: each type under the parent it came by. */
  tree: Map<string, string[]>;
};

const emptyWalk = (): Walk => ({ home: new Map(), tree: new Map() });

/**
 * Breadth first from every head at once, inside `allowed`, so each type is claimed
 * by the head nearest it and, at equal depth, by the earlier head. Carries on
 * `into`, so a later walk never claims what an earlier one reached.
 */
function walk(
  heads: readonly string[],
  children: ReadonlyMap<string, string[]>,
  allowed: ReadonlySet<string>,
  into: Walk
): Walk {
  const open = (id: string) => allowed.has(id) && !into.home.has(id);
  const queue = heads.filter(open);
  for (const head of queue) into.home.set(head, head);
  // biome-ignore lint/style/useForOf: the loop re-reads the length the body appends to.
  for (let i = 0; i < queue.length; i++) {
    const parent = queue[i] as string;
    const claimed = (children.get(parent) ?? []).filter(open);
    for (const child of claimed)
      into.home.set(child, into.home.get(parent) as string);
    if (claimed.length > 0) into.tree.set(parent, claimed);
    queue.push(...claimed);
  }
  return into;
}

/**
 * Neighbourhoods down a tree, depth first: each parent with the families below it,
 * then the neighbourhood of each child too big to join it, so a family's
 * neighbourhoods stand next to each other.
 */
function clustersOf(
  heads: readonly string[],
  tree: ReadonlyMap<string, string[]>
): IdCluster[] {
  const out: IdCluster[] = [];
  const visit = (head: string) => {
    const families: string[][] = [];
    const deeper: string[] = [];
    for (const child of tree.get(head) ?? []) {
      const below = tree.get(child) ?? [];
      const joins =
        below.length <= FAMILY_LIMIT &&
        below.every((grandchild) => !tree.get(grandchild)?.length);
      if (joins) families.push([child, ...below]);
      else deeper.push(child);
    }
    out.push({ head, families });
    for (const child of deeper) visit(child);
  };
  for (const head of heads) visit(head);
  return out;
}

/** A table of types with no parent among them. */
const table = (ids: readonly string[]): IdCluster => ({
  head: null,
  families: ids.map((id) => [id]),
});

/**
 * Neighbourhoods of one building, a type with no parent and no child, gathered into
 * one table at the end, so a board of loose types packs as a grid rather than as a
 * row of lanes.
 */
function gatherLoners(clusters: IdCluster[]): IdCluster[] {
  const loners = clusters.filter(
    (cluster) => cluster.head !== null && cluster.families.length === 0
  );
  if (loners.length < 2) return clusters;
  return [
    ...clusters.filter((cluster) => !loners.includes(cluster)),
    table(loners.map((cluster) => cluster.head as string)),
  ];
}

/** One property offering one Element Type, as content or as settings. */
type Offer = {
  element: string;
  editor: string;
  name: string;
  role: "content" | "settings";
};

/** Every block editor property's offer of an Element Type, across the schema. */
function offersOf(
  nodes: readonly SchemaNode[],
  isElement: ReadonlySet<string>
): Offer[] {
  return nodes.flatMap((host) =>
    (host.groups ?? []).flatMap((group) =>
      (group.properties ?? []).flatMap((property) =>
        (property.targets ?? []).flatMap((target) =>
          target.role !== "picker" && isElement.has(target.nodeId)
            ? [
                {
                  element: target.nodeId,
                  editor: property.dataTypeId,
                  name: property.dataTypeName ?? "",
                  role: target.role,
                },
              ]
            : []
        )
      )
    )
  );
}

/** How often each editor offers one Element Type, as content and as settings. */
type Tally = {
  editor: string;
  name: string;
  content: number;
  settings: number;
};

const byOffers = (a: Tally, b: Tally) =>
  b.content - a.content ||
  b.settings - a.settings ||
  compare(a.name, b.name) ||
  compare(a.editor, b.editor);

/**
 * The block editor each Element Type is grouped under: the Data Type that offers it
 * as content from the most properties, then as settings, then by name and id, so a
 * type offered by several editors lands with the same one every time. A type no
 * block editor offers has no entry.
 */
export function socketsOf(
  nodes: readonly SchemaNode[],
  elements: readonly SchemaNode[]
): Map<string, string> {
  const tallies = new Map<string, Map<string, Tally>>();
  for (const offer of offersOf(nodes, new Set(elements.map((n) => n.id)))) {
    const byEditor = tallies.get(offer.element) ?? new Map<string, Tally>();
    tallies.set(offer.element, byEditor);
    const tally = byEditor.get(offer.editor) ?? {
      editor: offer.editor,
      name: offer.name,
      content: 0,
      settings: 0,
    };
    tally[offer.role] += 1;
    byEditor.set(offer.editor, tally);
  }
  return new Map(
    [...tallies].map(([element, byEditor]) => [
      element,
      ([...byEditor.values()].sort(byOffers)[0] as Tally).editor,
    ])
  );
}

/**
 * One table per block editor, in the order of the editors' first members, and one
 * last table for the types no editor offers.
 */
function socketClusters(
  elements: readonly SchemaNode[],
  sockets: ReadonlyMap<string, string>
): IdCluster[] {
  const bySocket = new Map<string, string[]>();
  const unoffered: string[] = [];
  for (const node of elements) {
    const socket = sockets.get(node.id);
    if (socket === undefined) {
      unoffered.push(node.id);
      continue;
    }
    const list = bySocket.get(socket) ?? [];
    list.push(node.id);
    bySocket.set(socket, list);
  }
  return [...bySocket.values(), unoffered]
    .filter((ids) => ids.length > 0)
    .map(table);
}
