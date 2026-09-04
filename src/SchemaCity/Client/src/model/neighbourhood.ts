// The per-node edge lists the inspector reads, derived from the edge array once.
// Pure: no DOM, no React, no three.js.
//
// app/scene/graph-links.ts stays separate on purpose. It answers a different
// question, the flat set of everything one hop away that the scene keeps lit,
// and it includes directions this file has no section for.
import type { SchemaGraph } from "./types";

/**
 * Sorts ids by the alias of the type they name. An id no node claims sorts after
 * every real alias, because no alias starts with U+FFFF, and a block editor can
 * still name a type that was deleted.
 */
export function byAliasOf(
  graph: SchemaGraph
): (a: string, b: string) => number {
  const aliasOf = new Map(graph.nodes.map((node) => [node.id, node.alias]));
  const key = (id: string) => aliasOf.get(id) ?? `\uffff${id}`;
  return (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

/** The nodes one property points at, for block and reference edges. */
export type PropertyTargets = { propertyAlias: string; ids: string[] };

export type Neighbourhood = {
  compositions: string[];
  inherits: string[];
  allowedParents: string[];
  allowedChildren: string[];
  blockHosts: string[];
  blockTargets: PropertyTargets[];
  referencesOut: PropertyTargets[];
  referencesIn: string[];
};

const empty = (): Neighbourhood => ({
  compositions: [],
  inherits: [],
  allowedParents: [],
  allowedChildren: [],
  blockHosts: [],
  blockTargets: [],
  referencesOut: [],
  referencesIn: [],
});

/**
 * One entry per node in the graph, keyed by node id. Ids inside every list are
 * sorted by the target's alias so the panel order never depends on the order the
 * backend happened to emit edges in. An id that resolves to no node sorts last
 * and keeps its place; the inspector renders it as a missing type.
 */
export function neighbourhoods(graph: SchemaGraph): Map<string, Neighbourhood> {
  const map = new Map<string, Neighbourhood>();
  const at = (id: string) => {
    const found = map.get(id);
    if (found) return found;
    const made = empty();
    map.set(id, made);
    return made;
  };
  const into = (
    groups: PropertyTargets[],
    propertyAlias: string,
    id: string
  ) => {
    const group = groups.find(
      (candidate) => candidate.propertyAlias === propertyAlias
    );
    if (group) group.ids.push(id);
    else groups.push({ propertyAlias, ids: [id] });
  };

  for (const node of graph.nodes) at(node.id);

  for (const edge of graph.edges ?? []) {
    switch (edge.kind) {
      case "composition":
        at(edge.from).compositions.push(edge.to);
        break;
      case "inherits":
        at(edge.from).inherits.push(edge.to);
        break;
      case "allowedChild":
        at(edge.from).allowedChildren.push(edge.to);
        at(edge.to).allowedParents.push(edge.from);
        break;
      case "block":
        into(at(edge.from).blockTargets, edge.propertyAlias ?? "", edge.to);
        at(edge.to).blockHosts.push(edge.from);
        break;
      case "reference":
        into(at(edge.from).referencesOut, edge.propertyAlias ?? "", edge.to);
        at(edge.to).referencesIn.push(edge.from);
        break;
      default:
        break;
    }
  }

  const byAlias = byAliasOf(graph);
  const byPropertyAlias = (a: PropertyTargets, b: PropertyTargets) =>
    a.propertyAlias < b.propertyAlias
      ? -1
      : a.propertyAlias > b.propertyAlias
        ? 1
        : 0;

  // Two block properties pointing at the same element type are one host and one
  // target, so the flat lists drop repeats. The grouped lists keep theirs, because
  // there the property alias is what tells the two rows apart.
  const tidy = (ids: string[]) => [...new Set(ids)].sort(byAlias);

  for (const entry of map.values()) {
    entry.compositions = tidy(entry.compositions);
    entry.inherits = tidy(entry.inherits);
    entry.allowedParents = tidy(entry.allowedParents);
    entry.allowedChildren = tidy(entry.allowedChildren);
    entry.blockHosts = tidy(entry.blockHosts);
    entry.referencesIn = tidy(entry.referencesIn);
    for (const group of [...entry.blockTargets, ...entry.referencesOut])
      group.ids.sort(byAlias);
    entry.blockTargets.sort(byPropertyAlias);
    entry.referencesOut.sort(byPropertyAlias);
  }

  return map;
}
