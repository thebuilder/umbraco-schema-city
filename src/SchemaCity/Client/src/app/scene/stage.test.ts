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

/** The isometric camera, looking north-west and down at 35.26 degrees. */
const ISO_VIEW = {
  forward: { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
  elevation: Math.asin(1 / Math.sqrt(3)),
};

/** Half the ground a turned stamp covers along x and along z. */
function stampExtent(
  stamp: { width: number; height: number; spin: number },
  view: { forward: { x: number; z: number } },
) {
  const right = { x: -view.forward.z, z: view.forward.x };
  return {
    x: (Math.abs(right.x) * stamp.width + Math.abs(view.forward.x) * stamp.height) / 2,
    z: (Math.abs(right.z) * stamp.width + Math.abs(view.forward.z) * stamp.height) / 2,
  };
}

test("a district's name prints in the band along the north edge of its island", () => {
  // "PAGES" tracked out, rasterised: about seven cap heights wide.
  const island = { minX: -20, maxX: 40, minZ: -10, maxZ: 30 };
  const stamp = districtStamp(island, 7, ISO_VIEW);
  const extent = stampExtent(stamp, ISO_VIEW);

  // The isometric angle lays a flat quad over sqrt(3) of its own height, so the cap
  // has to be that much taller in the world to read as STAMP_CAP on screen.
  expect(stamp.height * Math.sin(ISO_VIEW.elevation)).toBeCloseTo(STAMP_CAP);
  expect(stamp.width / stamp.height).toBeCloseTo(7);
  // Half an inset in from the island's own west edge, whatever the turn.
  expect(stamp.x - extent.x).toBeCloseTo(island.minX + 0.5);
  // And half an inset clear of where the first row starts, which is the band in.
  expect(stamp.z + extent.z).toBeCloseTo(island.minZ + STAMP_BAND - 0.5);
});

test("no camera angle prints a name over the row the band holds clear", () => {
  // The first row of buildings starts a band in from the island's north edge, and
  // nothing the controls allow may push a letter onto it: the overview is pinned to
  // the isometric elevation and Explore orbits freely down to the horizon.
  const island = { minX: -20, maxX: 40, minZ: -10, maxZ: 30 };
  const rowStartsAt = island.minZ + STAMP_BAND;

  for (const azimuth of [0, 0.4, Math.PI / 2, 2.5, -1.9, Math.PI]) {
    for (const elevation of [ISO_VIEW.elevation, 0.9, 1.4, 0.3, 0.01]) {
      const view = {
        forward: { x: Math.sin(azimuth), z: Math.cos(azimuth) },
        elevation,
      };
      const stamp = districtStamp(island, 7, view);
      expect(stamp.z + stampExtent(stamp, view).z).toBeLessThanOrEqual(rowStartsAt);
      // And the name never loses its cap height to a shallow view: the correction
      // stops at the isometric elevation instead of running away.
      expect(stamp.height).toBeLessThanOrEqual(STAMP_BAND);
    }
  }
});

test("the name turns to face the camera and reads horizontally", () => {
  for (const azimuth of [0, 0.4, Math.PI / 2, 2.5, -1.9]) {
    const view = {
      forward: { x: Math.sin(azimuth), z: Math.cos(azimuth) },
      elevation: 0.6,
    };
    const { spin } = districtStamp({ minX: 0, maxX: 60, minZ: 0, maxZ: 60 }, 7, view);
    // The quad is laid flat by a quarter turn about x, so its own +x ends up here.
    const baseline = { x: Math.cos(spin), z: -Math.sin(spin) };
    // Square to the view direction on the ground, which is what puts the letters
    // along the screen's horizontal.
    expect(baseline.x * view.forward.x + baseline.z * view.forward.z).toBeCloseTo(0);
    // And running to the right of it rather than to the left.
    expect(view.forward.x * baseline.z - view.forward.z * baseline.x).toBeCloseTo(1);
  }
});

test("a name too big for its island shrinks instead of hanging over the void", () => {
  const island = { minX: 0, maxX: 14, minZ: 0, maxZ: 14 };
  const stamp = districtStamp(island, 7, ISO_VIEW);
  const extent = stampExtent(stamp, ISO_VIEW);

  expect(stamp.height).toBeLessThan(STAMP_CAP);
  expect(stamp.x + extent.x).toBeLessThanOrEqual(island.maxX);
  expect(stamp.z + extent.z).toBeLessThanOrEqual(island.maxZ);
  // Cap height and width shrink together, so the letters keep their shape.
  expect(stamp.width / stamp.height).toBeCloseTo(7);
});

test("a grazing view never blows the name up past the band it stands in", () => {
  const island = { minX: 0, maxX: 60, minZ: 0, maxZ: 40 };
  const flat = districtStamp(island, 7, { forward: { x: 0, z: -1 }, elevation: 0.02 });
  const iso = districtStamp(island, 7, ISO_VIEW);

  // The correction stops at the overview's own elevation, so tilting toward the
  // horizon in Explore shrinks the name with the ground rather than stretching it to
  // five cap heights over the district it names.
  expect(flat.height).toBeCloseTo(iso.height);
  expect(flat.height).toBeLessThan(STAMP_BAND);
});
