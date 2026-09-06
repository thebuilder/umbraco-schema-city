import { describe, expect, it } from "vitest";
import { buildOutlinePositions, revealAt, transitionToward } from "./reveal";

it("builds twelve edge segments without triangle diagonals", () => {
  const positions = buildOutlinePositions([
    { x: 0, y: 0, z: 0, width: 2, height: 3, depth: 4 },
  ]);
  expect(positions).toHaveLength(72);
  expect([...positions.slice(0, 6)]).toEqual([-1, 0, -2, 1, 0, -2]);
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
