import { describe, expect, it } from "vitest";
import type { SchemaEdge } from "../../model/types";
import { type Anchor, buildLinkGeometry } from "./layers";

const anchors = new Map<string, Anchor>([
  ["a", { x: 0, y: 2, z: 0 }],
  ["b", { x: 10, y: 3, z: 0 }],
]);

const edge = (kind: SchemaEdge["kind"], from: string, to: string, propertyAlias?: string) =>
  ({ kind, from, to, propertyAlias }) as SchemaEdge;

const highest = (positions: Float32Array) => {
  let top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i] as number);
  return top;
};

const lowest = (positions: Float32Array) => {
  let bottom = Infinity;
  for (let i = 1; i < positions.length; i += 3) bottom = Math.min(bottom, positions[i] as number);
  return bottom;
};

describe("buildLinkGeometry", () => {
  it("draws nothing for an empty edge list", () => {
    const { positions, ranges } = buildLinkGeometry("blocks", [], anchors);
    expect(positions.length).toBe(0);
    expect(ranges).toEqual([]);
  });

  it("draws only the edges belonging to the layer", () => {
    const edges = [
      edge("composition", "a", "b"),
      edge("block", "a", "b"),
      edge("reference", "a", "b"),
      edge("allowedChild", "a", "b"),
    ];
    expect(buildLinkGeometry("compositions", edges, anchors).ranges).toHaveLength(1);
    expect(buildLinkGeometry("blocks", edges, anchors).ranges).toHaveLength(1);
    expect(buildLinkGeometry("references", edges, anchors).ranges).toHaveLength(1);
  });

  it("skips an edge whose end has no placement", () => {
    const { positions } = buildLinkGeometry("blocks", [edge("block", "a", "ghost")], anchors);
    expect(positions.length).toBe(0);
  });

  it("arches a composition the full ARCH above the taller roof", () => {
    const { positions } = buildLinkGeometry("compositions", [edge("composition", "a", "b")], anchors);
    // The taller roof is at 3 and ARCH is 3, so the curve itself has to reach 6,
    // which is what the control point being twice as high buys.
    expect(highest(positions)).toBeCloseTo(6, 1);
  });

  it("dips a block link down to the ground", () => {
    const { positions } = buildLinkGeometry("blocks", [edge("block", "a", "b")], anchors);
    expect(lowest(positions)).toBeLessThan(0.5);
    expect(lowest(positions)).toBeGreaterThan(-0.5);
  });

  it("draws a reference as detached dashes", () => {
    const { positions } = buildLinkGeometry("references", [edge("reference", "a", "b")], anchors);
    // Every dash ends short of where the next one starts, which is what makes the
    // line read as dotted rather than solid.
    for (let vertex = 1; vertex + 1 < positions.length / 3; vertex += 2) {
      expect(positions[vertex * 3] as number).toBeLessThan(positions[(vertex + 1) * 3] as number);
    }
  });

  it("draws one line for two block properties pointing at the same type", () => {
    const { ranges } = buildLinkGeometry(
      "blocks",
      [edge("block", "a", "b", "hero"), edge("block", "a", "b", "body")],
      anchors,
    );
    expect(ranges).toHaveLength(1);
  });

  it("draws inheritance thicker than a composition, and only once", () => {
    const thin = buildLinkGeometry("compositions", [edge("composition", "a", "b")], anchors);
    const thick = buildLinkGeometry(
      "compositions",
      [edge("composition", "a", "b"), edge("inherits", "a", "b")],
      anchors,
    );
    expect(thick.ranges).toHaveLength(1);
    expect(thick.positions.length).toBe(thin.positions.length * 2);
  });

  it("gives every edge a distinct, contiguous vertex range", () => {
    const { ranges } = buildLinkGeometry(
      "blocks",
      [edge("block", "a", "b"), edge("block", "b", "a")],
      anchors,
    );
    expect(ranges[0]?.start).toBe(0);
    expect(ranges[1]?.start).toBe(ranges[0]?.count);
  });

  it("skips a type that blocks itself, which has no curve to draw", () => {
    const { positions } = buildLinkGeometry("blocks", [edge("block", "a", "a")], anchors);
    expect(positions.length).toBe(0);
  });
});
