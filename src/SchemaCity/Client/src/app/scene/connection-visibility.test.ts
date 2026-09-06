import { expect, test } from "vitest";
import type { SchemaEdge } from "../../model/types";
import {
  connectionBootAt,
  connectionEmphasis,
  connectionPickable,
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
  expect(
    connectionEmphasis([edges[0], edges[1]], "a", null, false, "done", false)
  ).toBe(1);
  expect(
    connectionEmphasis([edges[0], edges[1]], "z", null, false, "done", false)
  ).toBe(0);
  expect(
    connectionEmphasis([edges[0], edges[1]], null, null, false, "done", false)
  ).toBe(0);
});

test("disabled layers keep every directly incident hover connection", () => {
  // The hovered node is the destination of one edge and the source of another.
  expect(connectionEmphasis([edges[0]], null, "b", false, "done", false)).toBe(
    1
  );
  expect(connectionEmphasis([edges[2]], null, "b", false, "done", false)).toBe(
    1
  );

  // Selection and hover form one active set, so either endpoint can keep a range.
  expect(
    connectionEmphasis([edges[0], edges[1]], "a", "d", false, "done", false)
  ).toBe(1);
});

test("disabled layers suppress unrelated ranges during boot and focus", () => {
  expect(connectionEmphasis([edges[1]], "a", null, false, "trace", false)).toBe(
    0
  );
  expect(connectionEmphasis([edges[1]], "a", null, true, "done", false)).toBe(
    0
  );

  expect(connectionEmphasis([edges[1]], "a", null, false, "done", true)).toBe(
    0.12
  );
  expect(connectionEmphasis([edges[1]], "a", null, false, "done", false)).toBe(
    0
  );
});

test("connection picking follows visibility and vertex alpha", () => {
  const colors = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0.8]);
  expect(connectionPickable(true, 1, 0, 1, colors)).toBe(false);
  expect(connectionPickable(true, 1, 1, 1, colors)).toBe(true);
  expect(connectionPickable(false, 1, 1, 1, colors)).toBe(false);
  expect(connectionPickable(true, 0, 1, 1, colors)).toBe(false);
  expect(connectionPickable(true, 1, null, 1, colors)).toBe(false);
});
