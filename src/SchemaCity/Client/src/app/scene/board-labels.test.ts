import { describe, expect, it } from "vitest";
import {
  arrangeNames,
  BASE_OPACITY,
  boardTextPx,
  byPriority,
  courtyard,
  DIMMED,
  fitName,
  fittedFontPx,
  footprintRect,
  graphemes,
  LABEL_INSET,
  LOD_HIDE_PX,
  LOD_SHOW_PX,
  labelEm,
  labelFade,
  labelLight,
  labelOpacity,
  labelRoom,
  labelsFlipped,
  labelTier,
  MAX_EM,
  MIN_EM,
  MONO_ADVANCE,
  PRINT_LEVELS,
  packAtlas,
  placeLabels,
  printCorners,
  printLevel,
  printRect,
  printsFor,
  type Ranked,
  type Standing,
  sharedPrefix,
  type Want,
  worthPrinting,
} from "./board-labels";

const WIDE = /[\u3000-\u9fff]|\p{Extended_Pictographic}/u;

/** A mono face: every character 0.6 em, and a CJK character or an emoji a whole em. */
const mono = (text: string) =>
  graphemes(text).reduce(
    (sum, character) => sum + (WIDE.test(character) ? 1 : MONO_ADVANCE),
    0
  );

describe("labelEm", () => {
  it("sizes print by footprint between the floor and the cap", () => {
    expect(labelEm(0.5)).toBe(MIN_EM);
    expect(labelEm(100)).toBe(MAX_EM);
    expect(labelEm(5)).toBeGreaterThan(labelEm(4.2));
  });
});

describe("fitName", () => {
  it("prints a name that fits whole", () => {
    expect(fitName("Home", 4 * MONO_ADVANCE, mono)).toEqual({
      text: "Home",
      full: true,
    });
  });

  it("drops the board's shared prefix before it cuts anything", () => {
    expect(
      fitName("Element Card Grid", 10 * MONO_ADVANCE, mono, "Element ")
    ).toEqual({
      text: "Card Grid",
      full: false,
    });
  });

  it("cuts the middle, so names that differ at the end still differ", () => {
    const room = 9 * MONO_ADVANCE;
    const column = fitName("Element Grid Column", room, mono);
    const row = fitName("Element Grid Row Settings", room, mono);
    expect(column.text).not.toBe(row.text);
    expect(column.text).toContain("…");
    expect(column.text.startsWith("Eleme")).toBe(true);
    expect(column.text.endsWith("mn")).toBe(true);
    expect(mono(column.text)).toBeLessThanOrEqual(room + 1e-9);
  });

  it("measures wide characters at their own width, so they never overrun", () => {
    const name = "製品カタログページ一覧";
    const fitted = fitName(name, 6 * MONO_ADVANCE, mono);
    expect(mono(fitted.text)).toBeLessThanOrEqual(6 * MONO_ADVANCE + 1e-9);
    expect(fitted.full).toBe(false);
  });

  it("never splits an emoji or a letter from its accent", () => {
    const name = "Café 👩🏽‍💻 Landing Page Template";
    const fitted = fitName(name, 12 * MONO_ADVANCE, mono);
    for (const character of graphemes(fitted.text))
      expect(graphemes(name).includes(character) || character === "…").toBe(
        true
      );
  });

  it("prints only an ellipsis with no room at all", () => {
    expect(fitName("Anything", 0.1, mono).text).toBe("…");
  });
});

describe("worthPrinting", () => {
  it("keeps a whole name and a cut that still reads, and drops a stub", () => {
    expect(worthPrinting({ text: "Faq", full: true })).toBe(true);
    expect(worthPrinting({ text: "Prod…age", full: false })).toBe(true);
    expect(worthPrinting({ text: "Pr…y", full: false })).toBe(false);
  });
});

describe("sharedPrefix", () => {
  it("finds the leading word most names on a board share", () => {
    expect(
      sharedPrefix([
        "Element Card",
        "Element Card Grid",
        "Element Quote",
        "Unused Element",
      ])
    ).toBe("Element ");
  });

  it("finds nothing on a board of unrelated names or of too few", () => {
    expect(sharedPrefix(["Home", "Article", "News Landing"])).toBe("");
    expect(sharedPrefix(["Element A", "Element B"])).toBe("");
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
    expect(room.get("a")).toBeCloseTo(8);
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

  it("counts a name at the default diagonal view at the height it has on screen", () => {
    // From (1, 1, 1) the print's height and its strokes both shorten to the sine of
    // 54.7 degrees, 0.816, where the steepness alone said 0.577.
    const anchor = { x: 0, y: 0, z: 0 };
    const diagonal = boardTextPx(1, 1000, { x: 30, y: 30, z: 30 }, anchor);
    const above = boardTextPx(
      1,
      1000,
      { x: 0, y: Math.sqrt(2700), z: 0 },
      anchor
    );
    expect(diagonal / above).toBeCloseTo(Math.sqrt(2 / 3), 3);
  });

  it("projects nothing from below the board", () => {
    expect(
      boardTextPx(0.5, 1000, { x: 0, y: -1, z: 5 }, { x: 0, y: 0, z: 0 })
    ).toBe(0);
  });
});

describe("labelLight", () => {
  const rest = {
    hovered: null,
    selected: null,
    neighbours: null,
    hoveredNeighbours: null,
  };

  it("keeps every name whole when nothing is hovered or selected", () => {
    expect(labelLight("a", rest)).toBe(1);
  });

  it("dims names unrelated to the hovered type and keeps related ones", () => {
    const now = {
      ...rest,
      hovered: "a",
      hoveredNeighbours: new Set(["a", "b"]),
    };
    expect(labelLight("b", now)).toBe(1);
    expect(labelLight("c", now)).toBe(DIMMED);
  });

  it("keeps the hovered and selected names lit, for when no floating label shows", () => {
    const now = {
      ...rest,
      hovered: "a",
      selected: "b",
      neighbours: new Set(["c"]),
    };
    expect(labelLight("a", now)).toBe(1);
    expect(labelLight("b", now)).toBe(1);
  });

  it("dims everything outside a focus with nothing selected", () => {
    const now = { ...rest, neighbours: new Set(["a"]) };
    expect(labelLight("a", now)).toBe(1);
    expect(labelLight("z", now)).toBe(DIMMED);
  });
});

describe("labelOpacity", () => {
  it("is the rest strength for a legible, lit, revealed name on standing ground", () => {
    expect(labelOpacity(LOD_SHOW_PX, 1, 1, 0)).toBeCloseTo(BASE_OPACITY);
  });

  it("goes with the building when focus presses it flat", () => {
    expect(labelOpacity(LOD_SHOW_PX, 1, 1, 1)).toBe(0);
  });

  it("waits for the intro", () => {
    expect(labelOpacity(LOD_SHOW_PX, 1, 0, 0)).toBe(0);
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

  it("leaves the band at 105 degrees from north one way and 75 the other", () => {
    const facing = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      // 0 looks due north, along -z.
      return [Math.sin(radians), -Math.cos(radians)] as const;
    };
    expect(labelsFlipped(...facing(104), false)).toBe(false);
    expect(labelsFlipped(...facing(106), false)).toBe(true);
    expect(labelsFlipped(...facing(76), true)).toBe(true);
    expect(labelsFlipped(...facing(74), true)).toBe(false);
  });
});

describe("printLevel", () => {
  const ems = [0.8, 1.2, 2];

  it("takes the smallest size that reads comfortably", () => {
    expect(printLevel(12, ems)).toBe(0);
    expect(printLevel(8, ems)).toBe(1);
  });

  it("takes the largest while it is fading in, and nothing below that", () => {
    expect(printLevel(LOD_SHOW_PX / 2, ems)).toBe(2);
    expect(printLevel((LOD_HIDE_PX - 0.5) / 2, ems)).toBe(-1);
  });
});

describe("byPriority", () => {
  const ranked = (id: string, extra: Partial<Ranked> = {}): Ranked => ({
    id,
    tier: 2,
    footprint: 4,
    usage: 0,
    ...extra,
  });

  it("puts the selection, then its neighbours, then larger types, then busier ones", () => {
    const order = [
      ranked("small"),
      ranked("busy", { usage: 9 }),
      ranked("large", { footprint: 6 }),
      ranked("neighbour", { tier: 1, footprint: 3.2 }),
      ranked("selected", { tier: 0, footprint: 3.2 }),
    ]
      .sort(byPriority)
      .map((one) => one.id);
    expect(order).toEqual(["selected", "neighbour", "large", "busy", "small"]);
  });
});

describe("placeLabels", () => {
  const want = (
    id: string,
    x: number,
    z: number,
    widths: number[],
    footprint = 4
  ): Want => ({
    id,
    centre: { x, z },
    footprint,
    prints: widths.map((width) => ({ width, height: 2 })),
  });
  const building = (id: string, x: number, z: number, footprint = 4) => ({
    id,
    rect: {
      minX: x - footprint / 2,
      maxX: x + footprint / 2,
      minZ: z - footprint / 2,
      maxZ: z + footprint / 2,
    },
  });
  const apart = (
    a: { minX: number; maxX: number; minZ: number; maxZ: number },
    b: typeof a
  ) =>
    a.maxX <= b.minX ||
    b.maxX <= a.minX ||
    a.maxZ <= b.minZ ||
    b.maxZ <= a.minZ;

  it("prints in front of a building when the board there is clear", () => {
    const placed = placeLabels(
      [want("a", 0, 0, [6])],
      [building("a", 0, 0)],
      false
    );
    expect(placed.get("a")?.rect).toEqual(
      printRect({ x: 0, z: 0 }, 4, 6, 2, "front", false)
    );
  });

  it("prints two close neighbours whole on opposite sides", () => {
    // Two buildings 5.5 apart: their whole names would meet in front.
    const placed = placeLabels(
      [want("a", 0, 0, [8, 4]), want("b", 5.5, 0, [8, 4])],
      [building("a", 0, 0), building("b", 5.5, 0)],
      false
    );
    expect(placed.get("a")?.print).toBe(0);
    expect(placed.get("b")?.print).toBe(0);
    const behind = (id: string) => (placed.get(id)?.rect.maxZ ?? 0) < 0;
    expect(behind("a")).not.toBe(behind("b"));
  });

  it("gives every name a place before any name a longer print", () => {
    // Three in a row 5 apart: whole names for all three cannot fit on two sides.
    const row = ["a", "b", "c"];
    const placed = placeLabels(
      row.map((id, i) => want(id, i * 5, 0, [9, 4])),
      row.map((id, i) => building(id, i * 5, 0)),
      false
    );
    expect(placed.size).toBe(3);
  });

  it("never lays a print over another or over another building", () => {
    const wants: Want[] = [];
    const buildings: ReturnType<typeof building>[] = [];
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 8; column++) {
        const id = `${row}|${column}`;
        wants.push(want(id, column * 5.5, row * 8, [9, 6, 4]));
        buildings.push(building(id, column * 5.5, row * 8));
      }
    const placed = [...placeLabels(wants, buildings, false)];
    expect(placed.length).toBeGreaterThan(16);
    for (const [id, { rect }] of placed) {
      for (const [other, spot] of placed)
        if (other !== id) expect(apart(rect, spot.rect)).toBe(true);
      for (const one of buildings)
        if (one.id !== id) expect(apart(rect, one.rect)).toBe(true);
    }
  });

  it("leaves a name off when no print of it fits", () => {
    const placed = placeLabels(
      [want("a", 0, 0, [6]), want("b", 0.5, 0, [6])],
      // A wall over the strip behind, so b has neither side.
      [building("a", 0, 0), building("b", 0.5, 30), building("wall", 0, -4)],
      false
    );
    expect(placed.has("a")).toBe(true);
    expect(placed.has("b")).toBe(false);
  });

  it("swaps front and back when the names are flipped", () => {
    const placed = placeLabels(
      [want("a", 0, 0, [6])],
      [building("a", 0, 0)],
      true
    );
    expect(placed.get("a")?.rect.maxZ).toBeCloseTo(-2 - LABEL_INSET);
  });
});

describe("printCorners", () => {
  const rect = { minX: 8.5, maxX: 11.5, minZ: 22, maxZ: 22.5 };

  it("reads west to east with its top to the north, upright", () => {
    expect(printCorners(rect, false, [])).toEqual([
      8.5, 22, 11.5, 22, 8.5, 22.5, 11.5, 22.5,
    ]);
  });

  it("turns the text 180 degrees in its rectangle when flipped", () => {
    expect(printCorners(rect, true, [])).toEqual([
      11.5, 22.5, 8.5, 22.5, 11.5, 22, 8.5, 22,
    ]);
  });
});

describe("courtyard", () => {
  const segments = (print: Parameters<typeof courtyard>[2]) => {
    const out = new Float32Array(32);
    const end = courtyard({ x: 0, z: 0 }, 4, print, out, 0);
    return Array.from(out.slice(0, end));
  };

  it("outlines the footprint alone with four sides when there is no print", () => {
    expect(segments(null)).toHaveLength(16);
  });

  it("takes in the print beside it, so the outline closes round both", () => {
    const lines = segments({ minX: -4, maxX: 4, minZ: 2.1, maxZ: 4.1 });
    expect(lines).toHaveLength(32);
    const zs = lines.filter((_, i) => i % 2 === 1);
    const xs = lines.filter((_, i) => i % 2 === 0);
    expect(Math.max(...zs)).toBeGreaterThan(4.1);
    expect(Math.max(...xs)).toBeGreaterThan(4);
    expect(Math.min(...zs)).toBeLessThan(-2);
  });
});

describe("fittedFontPx", () => {
  it("keeps the font when the atlas fits", () => {
    expect(fittedFontPx(48, 1000, 4096, 8)).toBe(48);
  });

  it("shrinks by the square root of the overflow, since the area goes with its square", () => {
    // Four times too tall: half the font packs into about a quarter of the area.
    expect(fittedFontPx(48, 16_384, 4096, 8)).toBe(23);
  });

  it("never goes below the floor, however large the schema", () => {
    expect(fittedFontPx(48, 10_000_000, 4096, 8)).toBe(8);
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

describe("printsFor", () => {
  const at = (id: string, x: number, district = "d"): Standing => ({
    id,
    position: { x, z: 0 },
    footprint: 4,
    district,
  });

  it("prepares every name at each size, the whole name where it fits", () => {
    const prints = printsFor([at("a", 0)], () => "Home", mono);
    const sizes = prints.get("a") ?? [];
    expect(sizes).toHaveLength(PRINT_LEVELS.length);
    for (const size of sizes)
      expect(size.prints).toEqual([{ text: "Home", full: true }]);
    expect((sizes[0]?.em ?? 0) < (sizes[2]?.em ?? 0)).toBe(true);
  });

  it("cuts a long name further for a building hemmed in by neighbours", () => {
    const name = "Product Comparison Landing Page";
    const alone = printsFor([at("a", 0)], () => name, mono).get("a");
    const crowded = printsFor(
      [at("a", 0), at("b", 5), at("c", -5)],
      () => name,
      mono
    ).get("a");
    const narrowest = (sizes: typeof alone) =>
      Math.min(...(sizes?.[0]?.prints ?? []).map((one) => mono(one.text)));
    expect(narrowest(crowded)).toBeLessThan(narrowest(alone));
  });

  it("drops the leading word a board's names share before it cuts", () => {
    const names: Record<string, string> = {
      a: "Element Accordion Item With Long Name",
      b: "Element Card",
      c: "Element Quote",
    };
    const prints = printsFor(
      [at("a", 0, "e"), at("b", 30, "e"), at("c", 60, "e")],
      (id) => names[id],
      mono
    );
    const texts = (prints.get("a") ?? []).flatMap((size) =>
      size.prints.map((one) => one.text)
    );
    expect(texts.some((text) => text.startsWith("Accordion"))).toBe(true);
  });

  it("prints nothing for a type it has no name for", () => {
    expect(printsFor([at("a", 0)], () => undefined, mono).has("a")).toBe(false);
  });
});

describe("labelTier", () => {
  const rest = {
    hovered: null,
    selected: null,
    neighbours: null,
    hoveredNeighbours: null,
  };

  it("ranks the hovered and selected, then their neighbours, then the rest", () => {
    const now = {
      ...rest,
      selected: "s",
      hovered: "h",
      neighbours: new Set(["n"]),
      hoveredNeighbours: new Set(["m"]),
    };
    expect(labelTier("s", now)).toBe(0);
    expect(labelTier("h", now)).toBe(0);
    expect(labelTier("n", now)).toBe(1);
    expect(labelTier("m", now)).toBe(1);
    expect(labelTier("x", now)).toBe(2);
    expect(labelTier("x", rest)).toBe(2);
  });
});

describe("arrangeNames", () => {
  const rest = {
    hovered: null,
    selected: null,
    neighbours: null,
    hoveredNeighbours: null,
  };
  const at = (id: string, x: number, extra: Partial<Standing> = {}) => ({
    id,
    position: { x, z: 0 },
    footprint: 4,
    district: "d",
    ...extra,
  });
  const sizes = new Map(
    ["a", "b", "flat"].map((id) => [
      id,
      {
        ems: [0.8, 1.6],
        levels: [[{ width: 3, height: 1 }], [{ width: 6, height: 2 }]],
      },
    ])
  );

  it("prints the smallest size that reads, and the larger one further out", () => {
    const near = arrangeNames(
      [at("a", 0)],
      sizes,
      () => 12,
      rest,
      () => 0,
      false
    );
    const far = arrangeNames(
      [at("a", 0)],
      sizes,
      () => 6,
      rest,
      () => 0,
      false
    );
    expect(near.get("a")?.level).toBe(0);
    expect(near.get("a")?.px).toBeCloseTo(9.6);
    expect(far.get("a")?.level).toBe(1);
    expect(far.get("a")?.px).toBeCloseTo(9.6);
  });

  it("prints nothing too small to read, and nothing for a flattened building", () => {
    const placed = arrangeNames(
      [at("a", 0), at("flat", 20, { flatten: 1 })],
      sizes,
      (one) => (one.id === "a" ? 1 : 12),
      rest,
      () => 0,
      false
    );
    expect(placed.size).toBe(0);
  });

  it("gives the selected type the board first when two names compete", () => {
    // Side by side, close enough that only one print fits each strip... and
    // a wall behind both, so each has only its front.
    const standing = [at("a", 0), at("b", 1)];
    const placed = arrangeNames(
      standing,
      sizes,
      () => 6,
      { ...rest, selected: "b" },
      () => 0,
      false
    );
    expect(placed.has("b")).toBe(true);
  });

  it("puts a print beside its footprint, never over it", () => {
    const one = at("a", 0);
    const placed = arrangeNames(
      [one],
      sizes,
      () => 6,
      rest,
      () => 0,
      false
    );
    const rect = placed.get("a")?.rect;
    const footprint = footprintRect(one);
    expect(rect && rect.minZ >= footprint.maxZ).toBe(true);
  });
});
