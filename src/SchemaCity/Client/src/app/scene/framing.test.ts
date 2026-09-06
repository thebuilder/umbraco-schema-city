import { expect, test } from "vitest";
import { isometricZoom } from "./framing";

test.each([
  { width: 1440, height: 900 },
  { width: 390, height: 640 },
])("all projected corners fit the uncovered viewport %j", (size) => {
  const scenarios = [
    { width: 180, depth: 50, height: 1 },
    { width: 180, depth: 50, height: 20 },
    { width: 30, depth: 120, height: 1 },
    { width: 30, depth: 120, height: 20 },
  ];
  for (const bounds of scenarios) {
    const { height } = bounds;
    const panel = size.width > 500 ? 320 : 0;
    const zoom = isometricZoom(bounds, size, height, panel);
    const halfWidth = (size.width - panel) / 2;
    const halfHeight = size.height / 2;
    for (const x of [-bounds.width / 2, bounds.width / 2]) {
      for (const z of [-bounds.depth / 2, bounds.depth / 2]) {
        for (const y of [-height / 2, height / 2]) {
          expect(Math.abs(((x - z) / Math.sqrt(2)) * zoom)).toBeLessThan(
            halfWidth
          );
          expect(
            Math.abs(((-x - z + 2 * y) / Math.sqrt(6)) * zoom)
          ).toBeLessThan(halfHeight);
        }
      }
    }
  }
});
