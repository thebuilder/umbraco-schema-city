// Which edges count as a relationship for selection fade and neighbour labels.
// Pure: no three.js, no React, no DOM.
import type { EdgeKind, SchemaGraph } from "../../model/types";

const LINK_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set([
  "allowedChild",
  "composition",
  "inherits",
  "block",
  "reference",
]);

/**
 * The selected node plus every node one hop away from it over a link edge, in
 * either direction. The scene fades everything outside this set and never
 * labels anything outside it either.
 */
export function neighboursOf(graph: SchemaGraph, id: string): Set<string> {
  const ids = new Set<string>([id]);
  for (const edge of graph.edges ?? []) {
    if (!LINK_EDGE_KINDS.has(edge.kind)) continue;
    if (edge.from === id) ids.add(edge.to);
    if (edge.to === id) ids.add(edge.from);
  }
  return ids;
}
