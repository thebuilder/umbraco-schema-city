import { expect, test } from "vitest";
import {
  districtStamp,
  fogRange,
  framingAction,
  groundReach,
  pixelsPerUnit,
  STAMP_BAND,
  STAMP_CAP,
  stageMetrics,
  zoomRange,
} from "./stage";

/** Wide, square and tall, because the zoom range depends on the viewport's shape. */
const VIEWPORTS = [
  { width: 1600, height: 900 },
  { width: 900, height: 900 },
  { width: 900, height: 1600 },
];

/** What `viewOf` sets the camera to when it frames a city of this span. */
const framingZoom = (span: number, size: { width: number; height: number }) =>
  Math.min(size.width, size.height) / span;

test("zooming out stops exactly where the ground runs out of grid", () => {
  for (const size of VIEWPORTS) {
    const { minZoom } = zoomRange(87, size);
    expect(groundReach(minZoom, size)).toBeCloseTo(stageMetrics(87).fadeFar);
  }
});

test("every framing the camera flies to is inside the zoom range", () => {
  // One building, a small schema, the seeded one, and a city five times its size.
  for (const span of [4, 12, 87, 400]) {
    for (const size of VIEWPORTS) {
      const { minZoom, maxZoom } = zoomRange(span, size);
      expect(framingZoom(span, size)).toBeGreaterThanOrEqual(minZoom);
      expect(framingZoom(span, size)).toBeLessThanOrEqual(maxZoom);
    }
  }
});

test("no part of the city is in fog, at any zoom", () => {
  // A ground point is at most (width + depth) / (2 * sqrt(3)) of view depth from the
  // target, which the camera holds `span` units away, and ortho zoom moves no camera.
  // A square city is the deepest one that frames at a given span, so both sides are it.
  for (const span of [4, 12, 87, 400]) {
    expect(fogRange(span).near).toBeGreaterThan(span + (span + span) / (2 * Math.sqrt(3)));
  }
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

test("a world unit measures the same on screen through either camera", () => {
  const size = { width: 1600, height: 900 };
  const span = 87;
  const zoom = framingZoom(span, size);
  // The perspective camera the Explore toggle stands up frames the same world height
  // the orthographic one was showing, so at the point it is aimed at the two agree.
  const worldHeight = size.height / zoom;
  const fov = 45;
  const distance = worldHeight / (2 * Math.tan(((fov * Math.PI) / 180) / 2));

  expect(pixelsPerUnit({ isOrthographicCamera: true, zoom }, size.height, 999)).toBe(zoom);
  expect(pixelsPerUnit({ zoom: 1, fov }, size.height, distance)).toBeCloseTo(zoom);
  // Twice as far away is half the size.
  expect(pixelsPerUnit({ zoom: 1, fov }, size.height, distance * 2)).toBeCloseTo(zoom / 2);
});
test("a district's name prints in the band along the north edge of its island", () => {
  // "PAGES" tracked out, rasterised: about seven cap heights wide.
  const island = { minX: -20, maxX: 40, minZ: -10, maxZ: 30 };
  const stamp = districtStamp(island, 7);

  // A full cap height, with no correction for the angle it is seen at.
  expect(stamp.height).toBeCloseTo(STAMP_CAP);
  expect(stamp.width / stamp.height).toBeCloseTo(7);
  // Tucked into the north-west corner of the band, an inset in from either edge.
  expect(stamp.x - stamp.width / 2).toBeCloseTo(island.minX + 0.5);
  expect(stamp.z - stamp.height / 2).toBeCloseTo(island.minZ + 0.5);
  // And the whole of it inside the band, so no row can ever stand over a letter.
  expect(stamp.z + stamp.height / 2).toBeLessThanOrEqual(island.minZ + STAMP_BAND);
});

test("the band is a cap height with an inset above it and below it", () => {
  expect(STAMP_BAND).toBeCloseTo(STAMP_CAP + 1);
});

test("a name too wide for its island shrinks instead of hanging over the void", () => {
  const island = { minX: 0, maxX: 14, minZ: 0, maxZ: 14 };
  const stamp = districtStamp(island, 7);

  expect(stamp.height).toBeLessThan(STAMP_CAP);
  expect(stamp.x + stamp.width / 2).toBeCloseTo(island.maxX - 0.5);
  expect(stamp.z + stamp.height / 2).toBeLessThanOrEqual(island.minZ + STAMP_BAND);
  // Cap height and width shrink together, so the letters keep their shape.
  expect(stamp.width / stamp.height).toBeCloseTo(7);
});
