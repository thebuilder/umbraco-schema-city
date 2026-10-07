import { expect, test } from "vitest";
import { type Framed, revealShift, type Vec3, viewOf } from "./framing";
import { CAMERA_FOV } from "./stage";

const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};

/**
 * Where a world point lands on a canvas, in CSS pixels from its top-left corner, for
 * a perspective camera at `position` looking at `target`, the way three.js does it.
 */
function project(
  point: Vec3,
  view: { position: Vec3; target: Vec3 },
  size: { width: number; height: number }
) {
  const back = unit(sub(view.position, view.target));
  const right = unit(cross({ x: 0, y: 1, z: 0 }, back));
  const up = cross(back, right);
  const offset = sub(point, view.position);
  const depth = -dot(offset, back);
  const focal = size.height / 2 / Math.tan((CAMERA_FOV * Math.PI) / 360);
  return {
    x: size.width / 2 + (dot(offset, right) / depth) * focal,
    y: size.height / 2 - (dot(offset, up) / depth) * focal,
    depth,
  };
}

const box = (minX: number, maxX: number, minZ: number, maxZ: number) => ({
  minX,
  maxX,
  minZ,
  maxZ,
});
const framed = (grounds: Framed["grounds"]): Framed => ({
  centre: {
    x:
      (Math.min(...grounds.map((g) => g.minX)) +
        Math.max(...grounds.map((g) => g.maxX))) /
      2,
    z:
      (Math.min(...grounds.map((g) => g.minZ)) +
        Math.max(...grounds.map((g) => g.maxZ))) /
      2,
  },
  grounds,
});

const CITIES: { bounds: Framed; height: number }[] = [
  { bounds: framed([box(-90, 90, -25, 25)]), height: 20 },
  { bounds: framed([box(-15, 15, -60, 60)]), height: 20 },
  // The small sample: close enough that perspective matters most.
  { bounds: framed([box(-20, 20, -30, 30)]), height: 6 },
  // Islands in an L, which leaves the rectangle around them half empty.
  {
    bounds: framed([box(0, 120, 0, 40), box(0, 40, 40, 140)]),
    height: 12,
  },
];

const CANVASES = [
  { width: 1440, height: 900, panel: 520 },
  { width: 1000, height: 800, panel: 340 },
  { width: 900, height: 700, panel: 340 },
  { width: 1440, height: 900, panel: 0 },
  { width: 390, height: 640, panel: 0 },
];

const cornersOf = (city: (typeof CITIES)[number]) =>
  city.bounds.grounds.flatMap((g) =>
    [g.minX, g.maxX].flatMap((x) =>
      [g.minZ, g.maxZ].flatMap((z) =>
        [0, city.height].map((y) => ({ x, y, z }))
      )
    )
  );

test.each(CANVASES)(
  "every corner lands beside the panel, and the fit is tight %j",
  (canvas) => {
    const uncovered = canvas.width - canvas.panel;
    for (const city of CITIES) {
      const view = viewOf(city.bounds, canvas, canvas.panel, 0.9, city.height);
      const landed = cornersOf(city).map((corner) =>
        project(corner, view, canvas)
      );
      for (const at of landed) {
        expect(at.depth).toBeGreaterThan(0);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x).toBeLessThanOrEqual(uncovered);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(canvas.height);
      }
      // Inside the fill, centred in the uncovered part, and touching it on one axis.
      const xs = landed.map((at) => at.x);
      const ys = landed.map((at) => at.y);
      const leftGap = Math.min(...xs);
      const rightGap = uncovered - Math.max(...xs);
      const marginX = (uncovered * 0.1) / 2;
      const marginY = (canvas.height * 0.1) / 2;
      expect(leftGap).toBeGreaterThanOrEqual(marginX - 0.5);
      expect(rightGap).toBeGreaterThanOrEqual(marginX - 0.5);
      const topGap = Math.min(...ys);
      const bottomGap = canvas.height - Math.max(...ys);
      expect(Math.min(topGap, bottomGap)).toBeGreaterThanOrEqual(marginY - 0.5);
      const touchesX = Math.abs(leftGap - marginX) < 0.5;
      const touchesY = Math.abs(Math.min(topGap, bottomGap) - marginY) < 0.5;
      expect(touchesX || touchesY).toBe(true);
      // Horizontally centred whenever the height leaves room to spare.
      expect(leftGap).toBeCloseTo(rightGap, 0);
    }
  }
);

test("a building the panel opens over slides out beside it", () => {
  const canvas = { width: 1440, height: 900 };
  const panel = 520;
  const [city] = CITIES;
  // Framed with the panel closed, the way the city stands before a search pick.
  const view = viewOf(city.bounds, canvas, 0, 0.9, city.height);
  const add = (a: Vec3, b: Vec3) => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  });
  const corners = cornersOf(city);
  const hidden = corners.find(
    (corner) => project(corner, view, canvas).x > canvas.width - panel
  );
  expect(hidden).toBeDefined();
  const point = hidden as Vec3;
  const slide = revealShift(point, view, canvas, panel, CAMERA_FOV);
  expect(slide.y).toBe(0);
  const moved = {
    position: add(view.position, slide),
    target: add(view.target, slide),
  };
  const at = project(point, moved, canvas);
  expect(at.x).toBeGreaterThan(0);
  expect(at.x).toBeLessThan(canvas.width - panel);

  // One already beside the panel stays where it is.
  const shown = corners.find((corner) => {
    const { x } = project(corner, view, canvas);
    return x > 200 && x < canvas.width - panel - 200;
  });
  expect(revealShift(shown as Vec3, view, canvas, panel, CAMERA_FOV)).toEqual({
    x: 0,
    y: 0,
    z: 0,
  });
});
