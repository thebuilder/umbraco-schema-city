import { expect, test } from "vitest";
import type { Placement } from "../layout/city";
import { findNameplate, type Rect, type Run, STAMP_CAP } from "./nameplate";

/** A plate wide enough for a seven-cap name at the full cap height. */
const island: Rect = { minX: 0, maxX: 60, minZ: 0, maxZ: 40 };
/** "PAGES" tracked out, rasterised: about seven cap heights wide. */
const ASPECT = 7;

/** Ground built on: two-unit lots tiling the rectangle, at `height` each. */
function block(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height = 0,
): Placement[] {
  const lots: Placement[] = [];
  for (let z = minZ + 1; z <= maxZ - 1; z += 2) {
    for (let x = minX + 1; x <= maxX - 1; x += 2) {
      lots.push({
        id: `${x},${z}`,
        position: { x, z },
        footprint: 2,
        height,
        floors: 1,
        district: "d",
        districtKind: "structure",
        introDelay: 0,
      });
    }
  }
  return lots;
}

const fence = (x0: number, z0: number, x1: number, z1: number): Run => ({ x0, z0, x1, z1 });

test("a name goes in the strip along the edge that is clear", () => {
  // Everything but the southern eight units is built on.
  const spot = findNameplate(island, block(0, 60, 0, 32), [], ASPECT);

  expect(spot.height).toBeCloseTo(STAMP_CAP);
  expect(spot.rotation).toBe(0);
  // Against the south edge, clear of the buildings, and reading east.
  expect(spot.z + spot.height / 2).toBeGreaterThan(island.maxZ - 6);
  expect(spot.z - spot.height / 2).toBeGreaterThan(32);
});

test("a name goes inside the island when every edge is busy", () => {
  // A road down each side, which is what an island whose roads enter along its edges
  // looks like. The middle is clear.
  const runs = [
    fence(0, 1, 60, 1),
    fence(0, 39, 60, 39),
    fence(1, 0, 1, 40),
    fence(59, 0, 59, 40),
  ];
  const spot = findNameplate(island, [], runs, ASPECT);

  expect(spot.height).toBeCloseTo(STAMP_CAP);
  expect(spot.rotation).toBe(0);
  // Clear of all four runs.
  expect(spot.z - spot.height / 2).toBeGreaterThan(1);
  expect(spot.z + spot.height / 2).toBeLessThan(39);
  expect(spot.x - spot.width / 2).toBeGreaterThan(1);
  expect(spot.x + spot.width / 2).toBeLessThan(59);
});

test("a name reads up a flank when that is the clear side", () => {
  // Built on except for a channel down the west side, too narrow to read across.
  const spot = findNameplate(island, block(8, 60, 0, 40), [], ASPECT);

  expect(spot.rotation).toBeCloseTo(Math.PI / 2);
  expect(spot.x + spot.height / 2).toBeLessThan(8);
});

test("a name falls back to the north band when nothing is clear", () => {
  const spot = findNameplate(island, block(0, 60, 0, 40), [], ASPECT);

  // The band the layout holds clear along the north edge, tucked into its corner.
  expect(spot.rotation).toBe(0);
  expect(spot.height).toBeCloseTo(STAMP_CAP);
  expect(spot.x - spot.width / 2).toBeCloseTo(island.minX + 0.5);
  expect(spot.z - spot.height / 2).toBeCloseTo(island.minZ + 0.5);
});

test("a name too long for its island shrinks to fit the fallback band", () => {
  const narrow: Rect = { minX: 0, maxX: 14, minZ: 0, maxZ: 14 };
  const spot = findNameplate(narrow, block(0, 14, 0, 14), [], ASPECT);

  expect(spot.height).toBeLessThan(STAMP_CAP);
  expect(spot.x + spot.width / 2).toBeCloseTo(narrow.maxX - 0.5);
  // Cap height and width shrink together, so the letters keep their shape.
  expect(spot.width / spot.height).toBeCloseTo(ASPECT);
});

test("the shadow a building throws north is ground a name may not use", () => {
  // One tall building against the south edge, and nothing else. Its face hides
  // sqrt(2) times its height of ground north of it, so the name clears that too.
  const spot = findNameplate(island, block(0, 60, 36, 40, 6), [], ASPECT);

  expect(spot.z + spot.height / 2).toBeLessThan(36 - Math.SQRT2 * 6);
});
