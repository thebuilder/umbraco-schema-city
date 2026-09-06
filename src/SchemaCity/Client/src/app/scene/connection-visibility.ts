import type { SchemaEdge } from "../../model/types";
export type BootPhase = "trace" | "fade" | "done";
export function connectionBootAt(
  elapsed: number,
  reducedMotion: boolean
): { phase: BootPhase; trace: number } {
  if (reducedMotion) return { phase: "done", trace: 1 };
  return {
    phase: elapsed < 2.1 ? "trace" : elapsed < 2.65 ? "fade" : "done",
    trace: Math.min(1, Math.max(0, (elapsed - 1.35) / 0.65)),
  };
}
export function visibleConnections(
  edges: SchemaEdge[],
  selected: string | null,
  hovered: string | null,
  focusIds: ReadonlySet<string> | null,
  boot: BootPhase
): SchemaEdge[] {
  if (focusIds)
    return edges.filter(
      (edge) => focusIds.has(edge.from) && focusIds.has(edge.to)
    );
  if (boot !== "done") return edges;
  return edges.filter(
    (edge) =>
      edge.from === selected ||
      edge.to === selected ||
      edge.from === hovered ||
      edge.to === hovered
  );
}
