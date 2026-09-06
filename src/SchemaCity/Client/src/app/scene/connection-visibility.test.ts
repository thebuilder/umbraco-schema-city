import { expect, test } from "vitest";
import type { SchemaEdge } from "../../model/types";
import {
  connectionBootAt,
  connectionEmphasis,
  connectionTraceAt,
  visibleConnections,
} from "./connection-visibility";

const edges: SchemaEdge[] = [
  { kind: "composition", from: "a", to: "b" },
  { kind: "allowedChild", from: "c", to: "d" },
  { kind: "block", from: "b", to: "e" },
];
test("the boot traces completely, fades, then leaves a quiet overview", () => {
  expect(connectionBootAt(0, false)).toEqual({ phase: "trace", trace: 0 });
  expect(connectionBootAt(2.05, false)).toEqual({ phase: "trace", trace: 1 });
  expect(connectionBootAt(2.3, false).phase).toBe("fade");
  expect(connectionBootAt(3, false).phase).toBe("done");
  expect(connectionBootAt(0, true)).toEqual({ phase: "done", trace: 1 });
  expect(visibleConnections(edges, null)).toEqual(edges);
  expect(visibleConnections(edges, new Set(["a", "b", "e"]))).toEqual([
    edges[0],
    edges[2],
  ]);
});
test("focus keeps only complete paths; overview retains every edge", () => {
  expect(visibleConnections(edges, null)).toEqual(edges);
  expect(visibleConnections(edges, new Set(["a", "b", "e"]))).toEqual([
    edges[0],
    edges[2],
  ]);
});
test("traces before fading and stays quiet when motion is reduced", () => {
  expect(connectionTraceAt(1.34)).toEqual({ trace: 0, opacity: 0 });
  expect(connectionTraceAt(1.47).trace).toBeCloseTo(0.1846, 3);
  expect(connectionTraceAt(1.47).opacity).toBeCloseTo(1, 6);
  expect(connectionTraceAt(2.05)).toEqual({ trace: 1, opacity: 1 });
  expect(connectionTraceAt(2.3).trace).toBe(1);
  expect(connectionTraceAt(2.3).opacity).toBeLessThan(1);
  expect(connectionTraceAt(2.65).opacity).toBe(0);
  expect(connectionTraceAt(0, true)).toEqual({ trace: 1, opacity: 0 });
});
test("emphasizes boot, focus, and any edge in a shared trunk", () => {
  expect(
    connectionEmphasis([edges[0], edges[1]], null, null, false, "trace")
  ).toBe(1);
  expect(
    connectionEmphasis([edges[0], edges[1]], null, null, true, "done")
  ).toBe(1);
  expect(
    connectionEmphasis([edges[0], edges[1]], null, "a", false, "done")
  ).toBe(1);
  expect(
    connectionEmphasis([edges[0], edges[1]], "z", null, false, "done")
  ).toBe(0.12);
  expect(
    connectionEmphasis([edges[0], edges[1]], null, null, false, "done")
  ).toBe(0.28);
});
