import { describe, expect, it } from "vitest";
import type { SchemaEdge } from "../../model/types";
import type { Placement } from "../layout/city";
import { buildRoadGeometry } from "./roads";

function placement(id: string, x: number, z: number): Placement {
  return {
    id,
    position: { x, z },
    footprint: 2,
    height: 0.6,
    floors: 1,
    district: "structure",
    introDelay: 0,
  };
}

const placements = new Map([
  ["a", placement("a", 0, 0)],
  ["b", placement("b", 6, 0)],
]);

const road = (from: string, to: string): SchemaEdge => ({ kind: "allowedChild", from, to });

describe("buildRoadGeometry", () => {
  it("draws nothing for an empty edge list", () => {
    const { positions, ranges } = buildRoadGeometry(placements, []);
    expect(positions.length).toBe(0);
    expect(ranges).toEqual([]);
  });

  it("draws only allowedChild edges", () => {
    const { ranges } = buildRoadGeometry(placements, [
      road("a", "b"),
      { kind: "composition", from: "a", to: "b" },
    ]);
    expect(ranges).toHaveLength(1);
  });

  it("skips an edge whose end has no placement", () => {
    const { positions, ranges } = buildRoadGeometry(placements, [road("a", "ghost")]);
    expect(positions.length).toBe(0);
    expect(ranges).toEqual([]);
  });

  it("draws a ribbon starting past the parent's footprint edge", () => {
    const { positions, ranges } = buildRoadGeometry(placements, [road("a", "b")]);
    expect(ranges).toHaveLength(1);
    expect(positions.length).toBeGreaterThan(0);

    // Every ribbon and chevron vertex sits strictly inside the gap between
    // the two footprints, never on top of either building.
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThanOrEqual(1);
      expect(positions[i]).toBeLessThanOrEqual(5);
    }
  });

  it("draws a self-loop as a ring instead of a ribbon", () => {
    const { positions, ranges } = buildRoadGeometry(placements, [road("a", "a")]);
    expect(ranges).toHaveLength(1);
    // A ring sits beside the footprint, so every x is past its right edge.
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThan(1);
    }
  });

  it("gives every edge a distinct, contiguous vertex range", () => {
    const { ranges } = buildRoadGeometry(placements, [road("a", "b"), road("b", "a")]);
    expect(ranges[0]?.start).toBe(0);
    expect(ranges[1]?.start).toBe(ranges[0]?.count);
  });
});
