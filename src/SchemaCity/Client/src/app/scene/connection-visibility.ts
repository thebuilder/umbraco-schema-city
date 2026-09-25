import type { SchemaEdge } from "../../model/types";
export type BootPhase = "trace" | "fade" | "done";

export type ConnectionTrace = {
  trace: number;
  opacity: number;
};

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

/** The short, bright trace that introduces the otherwise quiet connection layer. */
export function connectionTraceAt(
  elapsed: number,
  reducedMotion = false
): ConnectionTrace {
  const { trace } = connectionBootAt(elapsed, reducedMotion);
  if (reducedMotion) return { trace, opacity: 0 };
  const fadeIn = Math.min(1, Math.max(0, (elapsed - 1.35) / 0.12));
  const fadeOut = Math.min(1, Math.max(0, (elapsed - 2.1) / 0.55));
  return {
    trace,
    opacity: elapsed >= 2.65 ? 0 : Math.max(0, fadeIn * (1 - fadeOut)),
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

/** Whether a connection mesh should accept a click at a face index. */
export function connectionPickable(
  visible: boolean,
  opacity: number,
  faceIndex: number | null | undefined,
  vertexStride: number,
  colors: Float32Array
): boolean {
  if (!visible || opacity < 0.1 || typeof faceIndex !== "number") return false;
  return (colors[faceIndex * vertexStride * 4 + 3] ?? 0) >= 0.01;
}

/**
 * How strong an enabled layer draws with nothing hovered or selected. Strong enough
 * that the overview reads as a board of traces, not a board of buildings.
 */
const IDLE = 0.4;
/**
 * How strong an enabled layer's other connections draw while a type is hovered or
 * selected. Its own connections draw at full strength, so the ratio between the two
 * is what lets one type's paths be picked out of the rest.
 */
const BACKGROUND = 0.07;

/** Opacity for a shared range: any represented edge can provide emphasis. */
export function connectionEmphasis(
  edges: SchemaEdge[],
  selected: string | null,
  hovered: string | null,
  focused: boolean,
  boot: BootPhase,
  enabled = true
): number {
  const active = new Set(
    [selected, hovered].filter((id): id is string => id !== null)
  );
  const touchesActive = edges.some(
    (edge) => active.has(edge.from) || active.has(edge.to)
  );
  if (boot === "trace" || focused) return enabled || touchesActive ? 1 : 0;
  if (!(selected || hovered)) return enabled ? IDLE : 0;
  return touchesActive ? 1 : enabled ? BACKGROUND : 0;
}
