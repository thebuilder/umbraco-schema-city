import { describe, expect, it } from "vitest";
import {
  boardText,
  boardTextPx,
  LABEL_INSET,
  LOD_HIDE_PX,
  LOD_SHOW_PX,
  labelCorners,
  labelEm,
  labelFade,
  labelRoom,
  labelsFlipped,
  MAX_EM,
  MIN_EM,
  packAtlas,
  truncate,
} from "./board-labels";

describe("truncate", () => {
  it("keeps a name that fits", () => {
    expect(truncate("Home", 4)).toBe("Home");
  });

  it("ends a cut name on an ellipsis inside the limit", () => {
    expect(truncate("Article Page", 8)).toBe("Article…");
    expect([...truncate("Article Page", 8)]).toHaveLength(8);
  });

  it("drops the space a cut lands after", () => {
    expect(truncate("Site Settings", 6)).toBe("Site…");
  });

  it("prints only the ellipsis when there is room for one character", () => {
    expect(truncate("Anything", 1)).toBe("…");
  });
});

describe("boardText", () => {
  it("sizes print by footprint between the floor and the cap", () => {
    expect(labelEm(0.5)).toBe(MIN_EM);
    expect(labelEm(100)).toBe(MAX_EM);
    expect(labelEm(4)).toBeGreaterThan(labelEm(3));
  });

  it("prints a short name whole on the smallest footprint", () => {
    expect(boardText("Home", 2.4, 2.4)).toMatchObject({
      text: "Home",
      full: true,
    });
  });

  it("cuts a long name to its room and says so", () => {
    const printed = boardText("Product Comparison Landing Page", 2.4, 3.3);
    expect(printed.full).toBe(false);
    expect(printed.text.endsWith("…")).toBe(true);
    expect([...printed.text].length * printed.em * 0.6).toBeLessThanOrEqual(
      3.3 + 1e-9
    );
  });

  it("prints more of the same name with more room", () => {
    const name = "Product Comparison Landing Page";
    expect(boardText(name, 2.4, 6).text.length).toBeGreaterThan(
      boardText(name, 2.4, 3).text.length
    );
  });
});

describe("labelRoom", () => {
  const at = (id: string, x: number, z: number, footprint = 2) => ({
    id,
    position: { x, z },
    footprint,
  });

  it("splits the gap to a neighbour in the row, less the spacing", () => {
    // Edges 1.5 apart: 0.45 a side, the same on both sides of each.
    const room = labelRoom([at("a", 0, 0), at("b", 3.5, 0)]);
    expect(room.get("a")).toBeCloseTo(2.9);
    expect(room.get("b")).toBeCloseTo(2.9);
  });

  it("gives a building alone in its row the full overhang", () => {
    // The other one stands in the next row, so it does not limit the name.
    const room = labelRoom([at("a", 0, 0), at("b", 0, 5)]);
    expect(room.get("a")).toBeCloseTo(6);
  });

  it("takes the nearer neighbour on either side", () => {
    const room = labelRoom([at("a", 0, 0), at("b", 3, 0), at("c", -8, 0)]);
    // One unit to b: 0.2 a side.
    expect(room.get("a")).toBeCloseTo(2.4);
  });
});

describe("level of detail", () => {
  it("hides below the low threshold, shows from the high one and ramps between", () => {
    expect(labelFade(LOD_HIDE_PX - 1)).toBe(0);
    expect(labelFade(LOD_HIDE_PX)).toBe(0);
    expect(labelFade(LOD_SHOW_PX)).toBe(1);
    const middle = labelFade((LOD_HIDE_PX + LOD_SHOW_PX) / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it("projects larger when closer and smaller when seen at a grazing angle", () => {
    const anchor = { x: 0, y: 0, z: 0 };
    const near = boardTextPx(0.5, 1000, { x: 10, y: 10, z: 10 }, anchor);
    const far = boardTextPx(0.5, 1000, { x: 50, y: 50, z: 50 }, anchor);
    const low = boardTextPx(0.5, 1000, { x: 17, y: 1, z: 0 }, anchor);
    expect(near).toBeGreaterThan(far);
    expect(low).toBeLessThan(near / 4);
  });

  it("projects nothing from below the board", () => {
    expect(
      boardTextPx(0.5, 1000, { x: 0, y: -1, z: 5 }, { x: 0, y: 0, z: 0 })
    ).toBe(0);
  });
});

describe("labelsFlipped", () => {
  it("stays upright for the default view from the south-east", () => {
    expect(labelsFlipped(-1, -1, false)).toBe(false);
  });

  it("flips once the camera looks south", () => {
    expect(labelsFlipped(0, 1, false)).toBe(true);
    expect(labelsFlipped(1, 1, false)).toBe(true);
  });

  it("holds either state through the band around due east and due west", () => {
    // Ten degrees past square to the board, inside the band either way.
    const x = Math.cos((10 * Math.PI) / 180);
    const z = Math.sin((10 * Math.PI) / 180);
    expect(labelsFlipped(x, z, false)).toBe(false);
    expect(labelsFlipped(x, -z, true)).toBe(true);
  });
});

describe("labelCorners", () => {
  it("lies under the south edge, centred, reading west to east", () => {
    const [nwX, nwZ, neX, , , swZ] = labelCorners(
      { x: 10, z: 20 },
      4,
      3,
      0.5,
      false
    );
    expect(nwX).toBeCloseTo(8.5);
    expect(neX).toBeCloseTo(11.5);
    expect(nwZ).toBeCloseTo(22 + LABEL_INSET);
    expect(swZ).toBeCloseTo(22 + LABEL_INSET + 0.5);
  });

  it("turns about the building onto its north edge when flipped", () => {
    const corners = labelCorners({ x: 10, z: 20 }, 4, 3, 0.5, true);
    const [nwX, nwZ, neX] = corners;
    // The upright north-west corner is now the south-east one, past the north edge.
    expect(nwX).toBeCloseTo(11.5);
    expect(neX).toBeCloseTo(8.5);
    expect(nwZ).toBeCloseTo(18 - LABEL_INSET);
    expect(Math.min(...corners.filter((_, i) => i % 2 === 1))).toBeCloseTo(
      18 - LABEL_INSET - 0.5
    );
  });
});

describe("packAtlas", () => {
  it("fills a row and starts the next one when the width runs out", () => {
    const { spots, height } = packAtlas([40, 40, 40], 10, 100, 2);
    expect(spots).toEqual([
      { x: 2, y: 2 },
      { x: 44, y: 2 },
      { x: 2, y: 14 },
    ]);
    expect(height).toBe(26);
  });

  it("never overlaps two entries", () => {
    const widths = Array.from({ length: 50 }, (_, i) => 20 + ((i * 37) % 90));
    const { spots } = packAtlas(widths, 12, 256, 3);
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const one = spots[a] as { x: number; y: number };
        const other = spots[b] as { x: number; y: number };
        const apart =
          one.y !== other.y ||
          one.x + (widths[a] as number) <= other.x ||
          other.x + (widths[b] as number) <= one.x;
        expect(apart).toBe(true);
      }
      expect(
        (spots[a] as { x: number }).x + (widths[a] as number)
      ).toBeLessThanOrEqual(256);
    }
  });

  it("takes no room for no names", () => {
    expect(packAtlas([], 10, 100, 2)).toEqual({ spots: [], height: 0 });
  });
});
