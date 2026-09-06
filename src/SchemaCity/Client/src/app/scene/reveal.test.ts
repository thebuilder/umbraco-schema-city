import { describe, expect, it } from "vitest";
import {
  buildBoardOutlinePositions,
  buildBuildingOutlinePositions,
  buildingRiseAt,
  buildOutlinePositions,
  growBuildingOutline,
  revealAt,
  traceOutlinePositions,
  transitionToward,
} from "./reveal";

it("builds twelve edge segments without triangle diagonals", () => {
  const positions = buildOutlinePositions([
    { x: 0, y: 0, z: 0, width: 2, height: 3, depth: 4 },
  ]);
  expect(positions).toHaveLength(72);
  expect([...positions.slice(0, 6)]).toEqual([-1, 0, -2, 1, 0, -2]);
});

it("merges every floor of a building into one outer outline", () => {
  const positions = buildBuildingOutlinePositions([
    { buildingId: "a", kind: "own", cx: 0, cy: 1, cz: 0, sx: 2, sy: 2, sz: 2 },
    {
      buildingId: "a",
      kind: "composed",
      cx: 0,
      cy: 3,
      cz: 0,
      sx: 2,
      sy: 2,
      sz: 2,
    },
    { buildingId: "b", kind: "own", cx: 6, cy: 1, cz: 0, sx: 2, sy: 2, sz: 2 },
  ]);
  expect(positions).toHaveLength(144);
  expect([...positions.slice(0, 6)]).toEqual([-1, 0, -1, 1, 0, -1]);
  expect(positions[25]).toBe(4);
});

it("draws only the four top perimeter segments of each board", () => {
  expect(
    buildBoardOutlinePositions([
      { x: 0, y: -1, z: 0, width: 4, height: 2, depth: 6 },
    ])
  ).toHaveLength(24);
});

it("grows buildings from a visible base without moving the ground", () => {
  const outline = buildOutlinePositions([
    { x: 0, y: 2, z: 0, width: 2, height: 4, depth: 2 },
  ]);
  growBuildingOutline(outline, 0.5);
  expect(outline[1]).toBe(2);
  expect(outline[25]).toBe(4);
});

it("supports an elevated building base and partial vertex buffers", () => {
  const outline = buildOutlinePositions([
    { x: 0, y: 7, z: 0, width: 2, height: 4, depth: 2 },
  ]);
  growBuildingOutline(outline, 0, 1);
  expect(outline[1]).toBe(7);
  expect(outline[25]).toBe(11);
  expect(buildingRiseAt(0)).toBeCloseTo(0.08);
  expect(buildingRiseAt(0.75)).toBeGreaterThan(0.08);
  expect(buildingRiseAt(2)).toBe(1);
  expect(buildingRiseAt(0, true)).toBe(1);
});

describe("traceOutlinePositions", () => {
  const source = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 1]);

  it("interpolates a long segment instead of popping its far endpoint", () => {
    const target = new Float32Array(source.length);
    const vertices = traceOutlinePositions(source, target, 0.25);
    expect(vertices).toBe(2);
    expect(target[3]).toBeCloseTo(2.75);
    expect(target[4]).toBe(0);
  });

  it("handles endpoints and monotonic progress", () => {
    const target = new Float32Array(source.length);
    expect(traceOutlinePositions(source, target, 0)).toBe(0);
    expect(traceOutlinePositions(source, target, 1)).toBe(4);
    const partial = new Float32Array(source.length);
    traceOutlinePositions(source, partial, 0.9);
    expect(partial[3]).toBeLessThan(source[3]);
    const earlier = new Float32Array(source.length);
    traceOutlinePositions(source, earlier, 0.8);
    expect(partial[3]).toBeGreaterThan(earlier[3]);
  });
});

describe("revealAt", () => {
  it("boots from a wireframe into districts and links", () => {
    expect(revealAt(0)).toEqual({
      trace: 0,
      wireframe: 0,
      districts: 0,
      links: 0,
    });
    const middle = revealAt(0.8);
    expect(middle.wireframe).toBeGreaterThan(0);
    expect(middle.districts).toBeGreaterThan(0);
    expect(middle.links).toBe(0);
    expect(revealAt(2).links).toBe(1);
  });

  it("skips the boot animation when motion is reduced", () => {
    expect(revealAt(0, true)).toEqual({
      trace: 1,
      wireframe: 0,
      districts: 1,
      links: 1,
    });
    expect(transitionToward(0, 1, 1)).toBe(1);
  });
});

it("finishes tracing before solids appear and never retracts completed edges", () => {
  expect(revealAt(0.7).trace).toBe(1);
  expect(revealAt(0.7).districts).toBe(0);
  expect(revealAt(1.2).trace).toBe(1);
  expect(revealAt(1.2).wireframe).toBeLessThan(revealAt(0.8).wireframe);
});
