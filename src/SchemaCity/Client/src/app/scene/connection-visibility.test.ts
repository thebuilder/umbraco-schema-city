import { expect, test } from "vitest";
import type { SchemaEdge } from "../../model/types";
import { connectionBootAt, visibleConnections } from "./connection-visibility";

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
  expect(visibleConnections(edges, null, null, null, "done")).toEqual([]);
  expect(visibleConnections(edges, null, null, null, "trace")).toEqual(edges);
});
test("hover and selection reveal only direct connections; focus keeps expanded paths", () => {
  expect(visibleConnections(edges, null, "a", null, "done")).toEqual([
    edges[0],
  ]);
  expect(visibleConnections(edges, "c", "a", null, "done")).toEqual([
    edges[0],
    edges[1],
  ]);
  expect(
    visibleConnections(edges, "a", null, new Set(["a", "b", "e"]), "done")
  ).toEqual([edges[0], edges[2]]);
});
