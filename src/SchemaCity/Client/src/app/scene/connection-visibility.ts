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
  focusIds: ReadonlySet<string> | null
): SchemaEdge[] {
  return focusIds
    ? edges.filter((edge) => focusIds.has(edge.from) && focusIds.has(edge.to))
    : edges;
}

/** Opacity for a shared range: any represented edge can provide emphasis. */
export function connectionEmphasis(
  edges: SchemaEdge[],
  selected: string | null,
  hovered: string | null,
  focused: boolean,
  boot: BootPhase
): number {
  if (boot === "trace" || focused) return 1;
  if (!(selected || hovered)) return 0.28;
  const active = new Set(
    [selected, hovered].filter((id): id is string => id !== null)
  );
  return edges.some((edge) => active.has(edge.from) || active.has(edge.to))
    ? 1
    : 0.12;
}
