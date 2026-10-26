import type { SchemaGraph } from "./types";

/** Undirected schema neighbourhood, bounded by relationship steps and safe in cycles. */
export function reachableWithin(
  graph: SchemaGraph,
  id: string,
  depth: number
): Set<string> {
  const known = new Set(graph.nodes.map((node) => node.id));
  if (!known.has(id)) return new Set();
  const adjacency = connectionMap(graph, known);
  const found = new Set([id]);
  let frontier = [id];
  for (
    let hop = 0;
    hop < Math.max(0, Math.floor(depth)) && frontier.length > 0;
    hop++
  ) {
    const next: string[] = [];
    for (const at of frontier)
      for (const neighbour of adjacency.get(at) ?? []) {
        if (found.has(neighbour)) continue;
        found.add(neighbour);
        next.push(neighbour);
      }
    frontier = next;
  }
  return found;
}

function connectionMap(graph: SchemaGraph, known: Set<string>) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!(known.has(edge.from) && known.has(edge.to))) continue;
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      const neighbours = adjacency.get(from) ?? new Set<string>();
      neighbours.add(to);
      adjacency.set(from, neighbours);
    }
  }
  return adjacency;
}
