import { expect, test } from "vitest";
import { fogRange, groundReach, stageMetrics, zoomRange } from "./stage";

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
