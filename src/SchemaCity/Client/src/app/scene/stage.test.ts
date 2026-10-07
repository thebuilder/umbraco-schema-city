import { expect, test } from "vitest";
import {
  atmosphere,
  districtStamp,
  framingAction,
  pixelsPerUnit,
  STAMP_BAND,
  STAMP_CAP,
} from "./stage";

test("no part of the city is in fog, wherever the camera orbits over it", () => {
  // The farthest a city point can be from the camera is the camera's distance to
  // its target plus the city's own diagonal, when the target is on one corner.
  for (const span of [4, 12, 87, 400]) {
    for (const distance of [2, span, span * 3]) {
      expect(atmosphere(span, distance).near).toBeGreaterThan(
        distance + span * Math.SQRT2
      );
    }
  }
});

test("the horizon moves out with the camera, so dollying out never finds an edge", () => {
  const close = atmosphere(87, 20);
  const far = atmosphere(87, 300);
  expect(far.near - close.near).toBeCloseTo(280);
  expect(far.far).toBeGreaterThan(close.far);
  expect(close.far).toBeGreaterThan(close.near * 2);
});

test("only a new framing moves the camera", () => {
  const bounds = { width: 40, depth: 87, centre: { x: 0, z: 0 } };
  const other = { ...bounds };
  const controls = {};
  const at = { bounds, controls, reframe: 0 };

  expect(framingAction(null, at)).toBe("snap");
  // The same bounds again is a re-render, a resize or a scroll, and the reader may
  // be mid-orbit through any of them.
  expect(framingAction(at, at)).toBe("none");
  expect(framingAction({ ...at, controls: null }, at)).toBe("snap");
  expect(framingAction(at, { ...at, bounds: other })).toBe("fly");
  // Home asks for the city it is already looking at, so nothing but the count moves.
  expect(framingAction(at, { ...at, reframe: 1 })).toBe("fly");
});

test("a world unit at twice the distance is half the size on screen", () => {
  const near = pixelsPerUnit(900, 100);
  expect(pixelsPerUnit(900, 200)).toBeCloseTo(near / 2);
  // At the 40 degree field of view, 100 units away fills 900 pixels with 72.8 units.
  expect(900 / near).toBeCloseTo(2 * 100 * Math.tan((20 * Math.PI) / 180));
});

test("a district's name prints in the band along the south edge of its island", () => {
  // "PAGES" tracked out, rasterised: about seven cap heights wide.
  const island = { minX: -20, maxX: 40, minZ: -10, maxZ: 30 };
  const stamp = districtStamp(island, 7);

  // A full cap height, with no correction for the angle it is seen at.
  expect(stamp.height).toBeCloseTo(STAMP_CAP);
  expect(stamp.width / stamp.height).toBeCloseTo(7);
  // Tucked into the south-west corner of the band, an inset in from either edge.
  expect(stamp.x - stamp.width / 2).toBeCloseTo(island.minX + 0.5);
  expect(stamp.z + stamp.height / 2).toBeCloseTo(island.maxZ - 0.5);
  // And the whole of it inside the band, so no row can ever stand over a letter.
  expect(stamp.z - stamp.height / 2).toBeGreaterThanOrEqual(
    island.maxZ - STAMP_BAND
  );
});

test("the band leaves half a street and a unit between the last row and the name", () => {
  const island = { minX: 0, maxX: 60, minZ: 0, maxZ: 40 };
  const stamp = districtStamp(island, 7);
  const lastRowEdge = island.maxZ - STAMP_BAND;
  expect(stamp.z - stamp.height / 2 - lastRowEdge).toBeCloseTo(3.5);
});

test("a name too wide for its island shrinks instead of hanging over the void", () => {
  const island = { minX: 0, maxX: 14, minZ: 0, maxZ: 14 };
  const stamp = districtStamp(island, 7);

  expect(stamp.height).toBeLessThan(STAMP_CAP);
  expect(stamp.x + stamp.width / 2).toBeCloseTo(island.maxX - 0.5);
  expect(stamp.z - stamp.height / 2).toBeGreaterThanOrEqual(
    island.maxZ - STAMP_BAND
  );
  // Cap height and width shrink together, so the letters keep their shape.
  expect(stamp.width / stamp.height).toBeCloseTo(7);
});
