import { expect, test } from "vitest";
import { framingDistance } from "./framing";

const DIRECTION = { x: 1, y: 1, z: 1 };
const FOV = 40;

/** Where a point lands on screen, in CSS pixels from the centre, and how deep. */
function project(
  point: { x: number; y: number; z: number },
  distance: number,
  size: { width: number; height: number }
) {
  const back = 1 / Math.sqrt(3);
  const right = { x: 1 / Math.SQRT2, z: -1 / Math.SQRT2 };
  const up = {
    x: -1 / Math.sqrt(6),
    y: 2 / Math.sqrt(6),
    z: -1 / Math.sqrt(6),
  };
  const depth = distance - (point.x + point.y + point.z) * back;
  const perUnit = size.height / (2 * Math.tan((FOV * Math.PI) / 360));
  return {
    x: ((point.x * right.x + point.z * right.z) / depth) * perUnit,
    y: ((point.x * up.x + point.y * up.y + point.z * up.z) / depth) * perUnit,
    depth,
  };
}

/** The eight corners of a box centred on the target. */
const cornersOf = (box: { width: number; height: number; depth: number }) =>
  [-1, 1].flatMap((sx) =>
    [-1, 1].flatMap((sy) =>
      [-1, 1].map((sz) => ({
        x: (sx * box.width) / 2,
        y: (sy * box.height) / 2,
        z: (sz * box.depth) / 2,
      }))
    )
  );

const SCENARIOS = [
  { width: 180, depth: 50, height: 1 },
  { width: 180, depth: 50, height: 20 },
  { width: 30, depth: 120, height: 1 },
  { width: 30, depth: 120, height: 20 },
  // The small sample: close enough that perspective matters most.
  { width: 40, depth: 60, height: 6 },
];

test.each([
  { width: 1440, height: 900, panel: 320 },
  { width: 390, height: 640, panel: 0 },
])("every corner lands in the uncovered viewport %j", (size) => {
  const halfWidth = ((size.width - size.panel) / 2) * 0.9;
  const halfHeight = (size.height / 2) * 0.9;
  for (const box of SCENARIOS) {
    const corners = cornersOf(box);
    const distance = framingDistance(
      corners,
      DIRECTION,
      size,
      size.panel,
      0.9,
      FOV
    );
    const landed = corners.map((corner) => project(corner, distance, size));
    for (const at of landed) expect(at.depth).toBeGreaterThan(0);
    const widest = Math.max(...landed.map((at) => Math.abs(at.x)));
    const tallest = Math.max(...landed.map((at) => Math.abs(at.y)));
    // Inside the fill, and the tightest such distance: one side touches it.
    expect(Math.max(widest / halfWidth, tallest / halfHeight)).toBeCloseTo(1);
  }
});
