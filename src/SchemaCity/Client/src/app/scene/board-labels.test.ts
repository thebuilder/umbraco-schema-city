import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import pathologicalFixture from "../../../dev/fixtures/pathological.json";
import smallFixture from "../../../dev/fixtures/small.json";
import type { SchemaGraph } from "../../model/types";
import { cityDistricts, ISLAND_PAD, layoutCity } from "../layout/city";
import {
  edgeFingers,
  type Finger,
  fingerRect,
  HOLE_CLEAR,
  holeSpots,
  type Island,
  PRINT_MARGIN,
} from "./board";
import {
  BASE_OPACITY,
  type Board,
  boardDistance,
  boardTextPx,
  boardTier,
  byPriority,
  COURTYARD_SEGMENTS,
  courtyard,
  DIMMED,
  type Edge,
  type Fitted,
  fadeToward,
  fitName,
  fittedFontPx,
  footprintRect,
  KNOCKOUT_VERTICES,
  knockout,
  knockoutAlpha,
  LABEL_INSET,
  LINE_HEIGHT,
  LINE_STEP,
  LOD_HIDE_PX,
  LOD_SHOW_PX,
  labelEm,
  labelLight,
  labelRoom,
  labelsFlipped,
  legible,
  MAX_EM,
  MIN_EM,
  MONO_ADVANCE,
  newFades,
  onBoard,
  PRINT_LEVELS,
  packAtlas,
  placeLabels,
  printCorners,
  printRect,
  printStrength,
  printsFor,
  type Ranked,
  type Rect,
  rankPrints,
  readings,
  type Standing,
  sharedContext,
  solveNames,
  stepName,
  type Trace,
  traceIndex,
  tracesOf,
  updateTiers,
  type Want,
} from "./board-labels";
import { planRoutes } from "./roads";
import { districtStamp, pixelsPerUnit } from "./stage";

const WIDE = /[\u3000-\u9fff]|\p{Extended_Pictographic}/u;
/** What a print may hold besides the name's own characters. */
const PRINT_MARK = /[…\n]/u;
const SEPARATOR = /[\s-]/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
const ALONE: Board = { prefix: "", suffix: "", others: [] };

/** A string's user-perceived characters. */
const graphemes = (text: string) =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (part) => part.segment
  );

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
  const elements: Board = {
    prefix: "Element ",
    suffix: "",
    others: ["Element Card", "Card", "Element Grid Row", "Grid Row"],
  };

  it("prints a name that fits whole", () => {
    expect(fitName("Home", 4 * MONO_ADVANCE, mono)).toEqual({
      text: "Home",
      full: true,
    });
  });

  it("wraps a name onto two balanced lines before it drops anything", () => {
    expect(fitName("No Template Page", 11 * MONO_ADVANCE, mono)).toEqual({
      text: "No Template\nPage",
      full: true,
    });
    expect(fitName("Element Accordion Item", 15 * MONO_ADVANCE, mono)).toEqual({
      text: "Element\nAccordion Item",
      full: true,
    });
  });

  it("breaks between a lower-case letter and a capital", () => {
    expect(fitName("GalleryPage", 8 * MONO_ADVANCE, mono)?.text).toBe(
      "Gallery\nPage"
    );
  });

  it("keeps to one line when asked", () => {
    expect(fitName("Gallery Page", 8 * MONO_ADVANCE, mono, ALONE, 1)).toEqual({
      text: "Gallery…",
      full: false,
    });
  });

  it("drops the board's shared prefix or suffix only when the name does not fit", () => {
    expect(fitName("Element Hero", 5 * MONO_ADVANCE, mono, elements)).toEqual({
      text: "Hero",
      full: false,
    });
    expect(fitName("Element Hero", 7 * MONO_ADVANCE, mono, elements)).toEqual({
      text: "Element\nHero",
      full: true,
    });
    const pages: Board = { prefix: "", suffix: " Page", others: [] };
    expect(
      fitName("Overloaded Tab Page", 14 * MONO_ADVANCE, mono, pages, 1)
    ).toEqual({ text: "Overloaded Tab", full: false });
  });

  it("never drops context to leave a name another one on the board reads as", () => {
    const board: Board = { prefix: "", suffix: " Page", others: ["Home"] };
    expect(fitName("Home Page", 4 * MONO_ADVANCE, mono, board, 1)).toBe(null);
  });

  it("cuts whole trailing words, and only when no other name starts the same way", () => {
    expect(
      fitName("Element Grid Settings Panel", 9 * MONO_ADVANCE, mono, {
        ...elements,
        others: ["Card"],
      })
    ).toEqual({ text: "Grid\nSettings…", full: false });
    // Grid Row starts with Grid as well, so "Grid…" would name either.
    expect(
      fitName("Element Grid Settings Panel", 5 * MONO_ADVANCE, mono, elements)
    ).toBe(null);
  });

  it("prints nothing rather than cut inside a word", () => {
    expect(fitName("Editorial00", 6 * MONO_ADVANCE, mono)).toBe(null);
    expect(fitName("Anything", 0.1, mono)).toBe(null);
  });

  it("measures wide characters at their own width, so they never overrun", () => {
    const fitted = fitName("製品 カタログ ページ", 6, mono);
    expect(fitted).not.toBe(null);
    for (const line of fitted?.text.split("\n") ?? [])
      expect(mono(line)).toBeLessThanOrEqual(6 + 1e-9);
  });

  it("never splits an emoji or a letter from its accent", () => {
    const name = "Café 👩🏽‍💻 Landing Page Template";
    const fitted = fitName(name, 12 * MONO_ADVANCE, mono);
    for (const character of graphemes(fitted?.text ?? ""))
      expect(
        graphemes(name).includes(character) || PRINT_MARK.test(character)
      ).toBe(true);
  });
});

describe("rankPrints", () => {
  it("puts whole names first, then shortened, then cut, one line before two", () => {
    const ranked = rankPrints([
      { text: "Grid…", full: false },
      null,
      { text: "Grid Row", full: false },
      { text: "Element\nGrid Row", full: true },
      { text: "Element Grid Row", full: true },
      { text: "Grid…", full: false },
    ]);
    expect(ranked.map((one) => one.text)).toEqual([
      "Element Grid Row",
      "Element\nGrid Row",
      "Grid Row",
      "Grid…",
    ]);
  });
});

describe("sharedContext", () => {
  it("finds the leading and trailing words a board's names share", () => {
    expect(
      sharedContext([
        "Element Card",
        "Element Card Grid",
        "Element Quote",
        "Unused Element",
      ])
    ).toEqual({ prefix: "Element ", suffix: "" });
    expect(
      sharedContext([
        "Home",
        "Gallery Page",
        "Form Thank You Page",
        "Article",
        "Faq Page",
      ])
    ).toEqual({ prefix: "", suffix: " Page" });
  });

  it("finds nothing on a board of unrelated names or of too few", () => {
    expect(sharedContext(["Home", "Article", "News Landing"])).toEqual({
      prefix: "",
      suffix: "",
    });
    expect(sharedContext(["Element A", "Element B"]).prefix).toBe("");
  });
});

describe("readings", () => {
  it("reads a name whole, without either end of its context, and without both", () => {
    const context = { prefix: "Element ", suffix: " Page" };
    expect(readings("Element Hero Page", context)).toEqual([
      "Element Hero Page",
      "Hero Page",
      "Element Hero",
      "Hero",
    ]);
    expect(readings("Element Page", context)).toEqual([
      "Element Page",
      "Page",
      "Element",
    ]);
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

  it("stops the overhang the print margin short of its board's edge", () => {
    const island = { minX: -3, maxX: 20, minZ: -3, maxZ: 3 };
    const room = labelRoom(
      [{ ...at("a", 0, 0), district: "d" }],
      new Map([["d", island]])
    );
    // Two units to the west edge, less the margin, on both sides of a centred name.
    expect(room.get("a")).toBeCloseTo(2 + (2 - PRINT_MARGIN) * 2);
  });
});

describe("level of detail", () => {
  it("turns legible from the high threshold and illegible only under the low one", () => {
    const between = (LOD_HIDE_PX + LOD_SHOW_PX) / 2;
    expect(legible(LOD_SHOW_PX, false)).toBe(true);
    expect(legible(between, false)).toBe(false);
    expect(legible(between, true)).toBe(true);
    expect(legible(LOD_HIDE_PX - 0.1, true)).toBe(false);
  });

  it("does not flicker while the size wobbles inside the band", () => {
    let reads = false;
    const seen: boolean[] = [];
    for (const px of [5, 7.2, 6.4, 6.9, 6.1, 6.8, 6.2, 5.9, 6.5, 6.9]) {
      reads = legible(px, reads);
      seen.push(reads);
    }
    expect(seen).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("fades toward its target by a step at a time, and lands on it", () => {
    expect(fadeToward(0, 1, 0.25)).toBe(0.25);
    expect(fadeToward(0.9, 1, 0.25)).toBe(1);
    expect(fadeToward(0.5, 0, 0.25)).toBe(0.25);
    expect(fadeToward(0.5, 0, 1)).toBe(0);
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

describe("printStrength", () => {
  it("is the rest strength for a lit, revealed name on standing ground", () => {
    expect(printStrength(false, 1, 1, 0).print).toBeCloseTo(BASE_OPACITY);
  });

  it("goes with the building when focus presses it flat", () => {
    expect(printStrength(false, 1, 1, 1)).toEqual({ print: 0, courtyard: 0 });
  });

  it("waits for the intro", () => {
    expect(printStrength(false, 1, 0, 0).print).toBe(0);
  });

  it("gives the print up to a floating label and keeps the courtyard", () => {
    const strength = printStrength(true, 1, 1, 0);
    expect(strength.print).toBe(0);
    expect(strength.courtyard).toBeGreaterThan(0);
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

describe("boardTier", () => {
  /** Pixels a world unit comes to at `distance` in a 1000 px viewport. */
  const at = (distance: number) => pixelsPerUnit(1000, distance);

  it("prints smaller the nearer a board is", () => {
    expect(boardTier(at(400), -1)).toBe(2);
    expect(boardTier(at(20), -1)).toBe(0);
  });

  it("switches only once past a switch point by the margin, either way", () => {
    // Walk in from far, then back out, in small steps, and note every switch.
    const distances = [
      ...Array.from({ length: 200 }, (_, i) => 300 - i * 1.4),
      ...Array.from({ length: 200 }, (_, i) => 20 + i * 1.4),
    ];
    let tier = -1;
    const switches: { from: number; to: number; distance: number }[] = [];
    for (const distance of distances) {
      const next = boardTier(at(distance), tier);
      if (tier >= 0 && next !== tier)
        switches.push({ from: tier, to: next, distance });
      tier = next;
    }
    expect(switches.map(({ from, to }) => [from, to])).toEqual([
      [2, 1],
      [1, 0],
      [0, 1],
      [1, 2],
    ]);
    // The switch back out happens a good way further out than the switch in.
    const [in1, , , out1] = switches;
    expect((out1?.distance ?? 0) / (in1?.distance ?? 1)).toBeGreaterThan(1.4);
  });

  it("holds its size while the distance wobbles around a switch point", () => {
    let tier = boardTier(at(100), -1);
    let switches = 0;
    // Find a switch point, then wobble a tenth either side of it.
    let edge = 100;
    while (boardTier(at(edge), tier) === tier && edge > 1) edge -= 0.5;
    tier = boardTier(at(edge), tier);
    for (let i = 0; i < 100; i++) {
      const next = boardTier(at(edge * (i % 2 ? 1.1 : 0.92)), tier);
      if (next !== tier) switches++;
      tier = next;
    }
    expect(switches).toBe(0);
  });
});

describe("boardDistance", () => {
  const board = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };

  it("is the height over a board the camera stands above", () => {
    expect(boardDistance({ x: 5, y: 30, z: 5 }, board, 0)).toBe(30);
  });

  it("measures to the board's nearest edge from beside it", () => {
    expect(boardDistance({ x: 13, y: 4, z: 5 }, board, 0)).toBe(5);
  });
});

describe("byPriority", () => {
  const ranked = (id: string, extra: Partial<Ranked> = {}): Ranked => ({
    id,
    footprint: 4,
    usage: 0,
    ...extra,
  });

  it("puts larger types, then busier ones, then the rest by id", () => {
    const order = [
      ranked("small"),
      ranked("busy", { usage: 9 }),
      ranked("large", { footprint: 6 }),
      ranked("also small"),
    ]
      .sort(byPriority)
      .map((one) => one.id);
    expect(order).toEqual(["large", "busy", "also small", "small"]);
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

  it("slides a print along its building rather than off the board's edge", () => {
    // The board ends a unit east of the building, so a centred print runs off it.
    const fits = (_: string, rect: Rect) => rect.maxX <= 3;
    const placed = placeLabels(
      [want("a", 0, 0, [8])],
      [building("a", 0, 0)],
      false,
      undefined,
      fits
    );
    const rect = placed.get("a")?.rect;
    // In front still, flush with the building's east side and running west.
    expect(rect?.minZ).toBeGreaterThan(2);
    expect(rect?.maxX).toBeCloseTo(2);
    expect(rect?.minX).toBeCloseTo(-6);
  });

  it("never takes a place its board turns down, even with no other left", () => {
    const placed = placeLabels(
      [want("a", 0, 0, [8, 3])],
      [building("a", 0, 0)],
      false,
      undefined,
      () => false
    );
    expect(placed.has("a")).toBe(false);
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
      // A wall over the strip behind and one to the east, and a's building to the
      // west, so b has no side.
      [
        building("a", 0, 0),
        building("b", 0.5, 30),
        building("wall", 0, -4),
        building("east", 6, 0),
      ],
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

describe("traces under the prints", () => {
  const want = (id: string, x: number, widths: number[]): Want => ({
    id,
    centre: { x, z: 0 },
    footprint: 4,
    prints: widths.map((width) => ({ width, height: 2 })),
  });
  const building = (id: string, x: number, z: number) => ({
    id,
    rect: { minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2 },
  });
  // A road along the street in front of the building, east to west.
  const road: Trace = { x0: -20, z0: 3, x1: 20, z1: 3, from: "p", to: "c" };

  it("reads every run of a route, from its source's centre to its target's", () => {
    const centres = new Map([
      ["p", { x: 0, z: 0 }],
      ["c", { x: 10, z: 10 }],
    ]);
    const traces = tracesOf(
      [
        {
          from: "p",
          to: "c",
          points: [
            { x: 0, z: 5 },
            { x: 10, z: 5 },
          ],
        },
      ],
      (id) => centres.get(id)
    );
    expect(traces.map(({ x0, z0, x1, z1 }) => [x0, z0, x1, z1])).toEqual([
      [0, 0, 0, 5],
      [0, 5, 10, 5],
      [10, 5, 10, 10],
    ]);
  });

  it("finds the traces through a rectangle and none beside it", () => {
    const at = traceIndex([road]);
    expect(at({ minX: -1, maxX: 1, minZ: 2.5, maxZ: 4 })).toEqual([road]);
    expect(at({ minX: -1, maxX: 1, minZ: 4, maxZ: 6 })).toEqual([]);
  });

  it("takes a side clear of the traces over one a trace runs through", () => {
    const at = traceIndex([road]);
    const placed = placeLabels(
      [want("a", 0, [6])],
      [building("a", 0, 0)],
      false,
      (rect) => at(rect).length > 0
    );
    expect(placed.get("a")).toEqual({
      print: 0,
      rect: printRect({ x: 0, z: 0 }, 4, 6, 2, "back", false),
      crosses: false,
    });
  });

  it("prints over a trace when no side is clear, and says so", () => {
    const placed = placeLabels(
      [want("a", 0, [6])],
      [building("a", 0, 0)],
      false,
      () => true
    );
    expect(placed.get("a")?.crosses).toBe(true);
    expect(placed.get("a")?.rect).toEqual(
      printRect({ x: 0, z: 0 }, 4, 6, 2, "front", false)
    );
  });

  it("puts a print beside its building when front and back are taken", () => {
    const placed = placeLabels(
      [want("a", 0, [3])],
      [building("a", 0, 0), building("north", 0, -4), building("south", 0, 4)],
      false
    );
    expect(placed.get("a")?.rect).toEqual(
      printRect({ x: 0, z: 0 }, 4, 3, 2, "left", false)
    );
  });

  it("swaps left and right when the names are flipped", () => {
    const left = printRect({ x: 0, z: 0 }, 4, 3, 2, "left", false);
    expect(left.maxX).toBeCloseTo(-2 - LABEL_INSET);
    expect(printRect({ x: 0, z: 0 }, 4, 3, 2, "left", true).minX).toBeCloseTo(
      2 + LABEL_INSET
    );
    expect(left.minZ).toBe(-1);
  });

  it("frames a print beside its part in one outline round both", () => {
    const out = new Float32Array(COURTYARD_SEGMENTS * 4);
    const print = printRect({ x: 0, z: 0 }, 4, 3, 2, "right", false);
    expect(courtyard({ x: 0, z: 0 }, 4, print, out, 0)).toBe(16);
    const xs = Array.from(out.slice(0, 16)).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeCloseTo(print.maxX + 0.05);
  });

  it("clears the board under a print over a trace, unless the trace is lit", () => {
    const at = traceIndex([road]);
    const rect = printRect({ x: 0, z: 0 }, 4, 6, 2, "front", false);
    const rest = { hovered: null, selected: null };
    const over = { rect, crosses: true };
    expect(knockoutAlpha(over, 0.8, at, rest)).toBe(0.8);
    expect(knockoutAlpha({ rect, crosses: false }, 0.8, at, rest)).toBe(0);
    expect(knockoutAlpha(undefined, 0.8, at, rest)).toBe(0);
    expect(knockoutAlpha(over, 0.8, at, { ...rest, hovered: "c" })).toBe(0);
    expect(knockoutAlpha(over, 0.8, at, { ...rest, selected: "x" })).toBe(0.8);
  });

  it("lays a knockout a little inside the print's lines and past its ends", () => {
    const rect = { minX: 0, maxX: 6, minZ: 0, maxZ: 2 };
    const out = new Float32Array(KNOCKOUT_VERTICES * 2);
    knockout(rect, out, 0);
    const xs = Array.from(out).filter((_, i) => i % 2 === 0);
    const zs = Array.from(out).filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-0.2);
    expect(Math.max(...xs)).toBeCloseTo(6.2);
    expect(Math.min(...zs)).toBeCloseTo(0.1);
    expect(Math.max(...zs)).toBeCloseTo(1.9);
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
    const { spots, height } = packAtlas([40, 40, 40], [10, 10, 10], 100, 2);
    expect(spots).toEqual([
      { x: 2, y: 2 },
      { x: 44, y: 2 },
      { x: 2, y: 14 },
    ]);
    expect(height).toBe(26);
  });

  it("never overlaps two entries", () => {
    const widths = Array.from({ length: 50 }, (_, i) => 20 + ((i * 37) % 90));
    const { spots } = packAtlas(
      widths,
      widths.map(() => 12),
      256,
      3
    );
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
    expect(packAtlas([], [], 100, 2)).toEqual({ spots: [], height: 0 });
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

  it("offers a print that fits the column of a building hemmed in by neighbours", () => {
    const name = "Product Comparison Landing Page";
    const crowded = printsFor(
      [at("a", 0), at("b", 5), at("c", -5)],
      (id) => (id === "a" ? name : "Home"),
      mono
    ).get("a");
    const smallest = crowded?.[0];
    const widest = (text: string) =>
      Math.max(...text.split("\n").map((line) => mono(line)));
    const narrowest = Math.min(
      ...(smallest?.prints ?? []).map((one) => widest(one.text))
    );
    // Its own column: the footprint and 0.2 a side, half the 1-unit gap less 0.3.
    expect(narrowest * (smallest?.em ?? 0)).toBeLessThanOrEqual(4.4 + 1e-9);
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

describe("printsFor on the fixtures", () => {
  /** True when `at` in `text` is a space, a hyphen, or a capital after a lower-case letter. */
  const breaksAt = (text: string, at: number) =>
    SEPARATOR.test(text[at] ?? "") ||
    SEPARATOR.test(text[at - 1] ?? "") ||
    (LOWER.test(text[at - 1] ?? "") && UPPER.test(text[at] ?? ""));

  /** True when `head` is whole leading words of `base`, short of all of it. */
  const leadingWords = (head: string, base: string) =>
    head.length > 0 &&
    head.length < base.length &&
    base.startsWith(head) &&
    breaksAt(base, head.length);

  /**
   * True when a print is the whole name, one of its readings without the board's
   * context, or whole leading words of one with an ellipsis. A line break stands
   * where a space did, or inside a word at a capital.
   */
  const honest = (
    { text, full }: Fitted,
    name: string,
    bases: readonly string[]
  ) => {
    const flat = [text.replace("\n", " "), text.replace("\n", "")];
    if (full) return flat.includes(name);
    if (!text.endsWith("…")) return flat.some((one) => bases.includes(one));
    return flat.some((one) =>
      bases.some((base) => leadingWords(one.slice(0, -1), base))
    );
  };

  it.each([
    ["small", smallFixture],
    ["medium", mediumFixture],
    ["pathological", pathologicalFixture],
  ])("never cuts a name of the %s fixture inside a word", (_, fixture) => {
    const graph = fixture as unknown as SchemaGraph;
    const placements = layoutCity(graph);
    const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
    const boards = new Map<string, string[]>();
    for (const one of placements)
      boards.set(one.district, [
        ...(boards.get(one.district) ?? []),
        names.get(one.id) as string,
      ]);
    const prints = printsFor(placements, (id) => names.get(id), mono);
    const checked = placements.flatMap((one) => {
      const name = names.get(one.id) as string;
      const bases = readings(
        name,
        sharedContext(boards.get(one.district) ?? [])
      );
      return (prints.get(one.id) ?? []).flatMap((size) =>
        size.prints.map((fitted) => ({
          text: fitted.text,
          honest: honest(fitted, name, bases),
        }))
      );
    });
    expect(checked.length).toBeGreaterThan(placements.length);
    for (const one of checked) expect(one).toEqual({ ...one, honest: true });
  });
});

/** Each name's sizes as `solveNames` reads them, from `printsFor` in the mono face. */
function sizesOf(prints: Map<string, { em: number; prints: Fitted[] }[]>) {
  return new Map(
    [...prints].map(([id, sized]) => [
      id,
      {
        ems: sized.map((one) => one.em),
        levels: sized.map(({ em, prints: fitted }) =>
          fitted.map(({ text }) => {
            const lines = text.split("\n");
            return {
              width: em * Math.max(...lines.map(mono)),
              height: em * (LINE_HEIGHT + (lines.length - 1) * LINE_STEP),
            };
          })
        ),
      },
    ])
  );
}

const touching = (a: Rect, b: Rect) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

type Laid = { id: string; size: number; board?: string; rect: Rect };

/** Every print lying over a building other than its own. */
const printsOverBuildings = (
  prints: readonly Laid[],
  placements: readonly Standing[]
) =>
  prints.flatMap((one) =>
    placements
      .filter(
        (building) =>
          building.id !== one.id && touching(one.rect, footprintRect(building))
      )
      .map((building) => `${one.id} over ${building.id}`)
  );

/**
 * Every two prints that touch and can show at once: on one board at one size, or on
 * two boards at any two sizes, since each board picks its own size.
 */
const printsOverPrints = (prints: readonly Laid[]) =>
  prints.flatMap((a, i) =>
    prints
      .slice(i + 1)
      .filter(
        (b) =>
          (a.board !== b.board || a.size === b.size) && touching(a.rect, b.rect)
      )
      .map((b) => `${a.id}@${a.size} on ${b.id}@${b.size}`)
  );

describe("onBoard", () => {
  const island = { minX: 0, maxX: 30, minZ: 0, maxZ: 30 };
  const edge: Edge = {
    island,
    fingers: [{ district: "d", side: "east", x: 30, z: 12 }],
    stamp: { minX: 2, maxX: 14, minZ: 24, maxZ: 28 },
  };
  const rect = (minX: number, minZ: number, width = 4, height = 1) => ({
    minX,
    maxX: minX + width,
    minZ,
    maxZ: minZ + height,
  });

  it("takes a print well inside its board", () => {
    expect(onBoard(rect(10, 10), edge)).toBe(true);
  });

  it("turns down a print within the margin of the edge or past it", () => {
    expect(onBoard(rect(-1, 10), edge)).toBe(false);
    expect(onBoard(rect(PRINT_MARGIN / 2, 10), edge)).toBe(false);
    expect(onBoard(rect(10, 30 - 1 - PRINT_MARGIN / 2), edge)).toBe(false);
  });

  it("turns down a print over a mounting hole's clear radius", () => {
    // The north-west hole stands at (1, 1).
    expect(onBoard(rect(1.5, 1.5), edge)).toBe(false);
    expect(onBoard(rect(1 + HOLE_CLEAR + 0.01, 0.5), edge)).toBe(true);
  });

  it("turns down a print beside a gold finger, and takes one past it", () => {
    expect(onBoard(rect(25.5, 11.8), edge)).toBe(false);
    expect(onBoard(rect(25.5, 14), edge)).toBe(true);
  });

  it("turns down a print over the district's name, and takes one past its end", () => {
    expect(onBoard(rect(8, 23.5), edge)).toBe(false);
    expect(onBoard(rect(16, 25), edge)).toBe(true);
  });
});

/** Every way `rect` leaves its board, as the solver's tests read a board. */
function offBoard(rect: Rect, island: Island, fingers: readonly Finger[]) {
  const out: string[] = [];
  if (
    rect.minX < island.minX + PRINT_MARGIN - 1e-9 ||
    rect.maxX > island.maxX - PRINT_MARGIN + 1e-9 ||
    rect.minZ < island.minZ + PRINT_MARGIN - 1e-9 ||
    rect.maxZ > island.maxZ - PRINT_MARGIN + 1e-9
  )
    out.push("edge");
  for (const hole of holeSpots(island)) {
    const dx = Math.max(rect.minX - hole.x, 0, hole.x - rect.maxX);
    const dz = Math.max(rect.minZ - hole.z, 0, hole.z - rect.maxZ);
    if (Math.hypot(dx, dz) < HOLE_CLEAR - 1e-9) out.push("hole");
  }
  for (const finger of fingers)
    if (touching(rect, fingerRect(finger))) out.push("finger");
  return out;
}

/** The medium mono face's stamp: tracked out by 0.32 em, about 0.7 em to the cap. */
const stampAspect = (name: string) =>
  (name.length * (MONO_ADVANCE + 0.32)) / 0.7;

describe("names on the boards of the fixtures", () => {
  it.each([
    ["small", smallFixture],
    ["medium", mediumFixture],
    ["pathological", pathologicalFixture],
  ])(
    "keeps every print and every district name of the %s fixture on its board, at every size either way up",
    (name, fixture) => {
      const graph = fixture as unknown as SchemaGraph;
      const { placements, districts } = cityDistricts(graph);
      const byId = new Map(placements.map((one) => [one.id, one]));
      const islands = new Map(
        districts.map((d): [string, Island] => [
          d.id,
          {
            minX: d.minX - ISLAND_PAD,
            maxX: d.maxX + ISLAND_PAD,
            minZ: d.minZ - ISLAND_PAD,
            maxZ: d.maxZ + ISLAND_PAD,
          },
        ])
      );
      // Every layer drawn at once, which puts the most fingers on the edges.
      const routes = planRoutes(byId, graph.edges ?? []).routes.map(
        ({ edge, points }) => ({ from: edge.from, to: edge.to, points })
      );
      const fingers = edgeFingers(
        routes,
        (id) => byId.get(id)?.district,
        islands
      );
      const stamps = districts.flatMap((district) => {
        const island = islands.get(district.id) as Island;
        const stamp = districtStamp(
          island,
          stampAspect(district.name.toUpperCase())
        );
        return stamp
          ? [
              {
                district,
                island,
                rect: {
                  minX: stamp.x - stamp.width / 2,
                  maxX: stamp.x + stamp.width / 2,
                  minZ: stamp.z - stamp.height / 2,
                  maxZ: stamp.z + stamp.height / 2,
                },
              },
            ]
          : [];
      });
      const edges = new Map(
        [...islands].map(([id, island]): [string, Edge] => [
          id,
          {
            island,
            fingers: fingers.filter((f) => f.district === id),
            stamp: stamps.find((one) => one.district.id === id)?.rect,
          },
        ])
      );
      const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
      const named = sizesOf(
        printsFor(placements, (id) => names.get(id), mono, islands)
      );
      const solved = solveNames(
        placements,
        named,
        (id) => id.length,
        undefined,
        edges
      );

      // Only a board too narrow for the name at its smallest goes without it, and
      // the medium fixture has none.
      if (name === "medium") expect(stamps).toHaveLength(districts.length);
      const misses = stamps.flatMap(({ district, island, rect }) =>
        offBoard(rect, island, edges.get(district.id)?.fingers ?? []).map(
          (why) => `stamp ${district.name} over ${why}`
        )
      );

      let count = 0;
      solved.placed.forEach((way, flipped) => {
        way.forEach((level, size) => {
          for (const [id, spot] of level) {
            count++;
            const district = byId.get(id)?.district as string;
            const island = islands.get(district) as Island;
            const where = `${id}@${size}${flipped ? " flipped" : ""}`;
            for (const why of offBoard(
              spot.rect,
              island,
              edges.get(district)?.fingers ?? []
            ))
              misses.push(`${where} over ${why}`);
            for (const stamp of stamps)
              if (touching(spot.rect, stamp.rect))
                misses.push(`${where} over the ${stamp.district.name} stamp`);
          }
        });
      });
      expect(count).toBeGreaterThan(placements.length);
      expect(misses).toEqual([]);
    }
  );
});

describe("solveNames", () => {
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

  it("places every name at every size and either way up", () => {
    const solved = solveNames([at("a", 0)], sizes, () => 0);
    expect(solved.placed).toHaveLength(2);
    for (const way of solved.placed)
      for (const level of [0, 1]) expect(way[level]?.has("a")).toBe(true);
    const front = solved.placed[0]?.[1]?.get("a")?.rect;
    expect(front && front.minZ >= footprintRect(at("a", 0)).maxZ).toBe(true);
  });

  it("prints nothing for a flattened building, and leaves it out of its board", () => {
    const solved = solveNames(
      [at("a", 0), at("flat", 40, { flatten: 1 })],
      sizes,
      () => 0
    );
    expect(solved.placed[0]?.[0]?.has("flat")).toBe(false);
    expect(solved.boards.get("d")?.rect.maxX).toBe(2);
  });

  it("counts districts laid out close together as one board", () => {
    const solved = solveNames(
      [
        at("a", 0),
        at("b", 8, { district: "e" }),
        at("far", 80, { district: "f" }),
      ],
      sizes,
      () => 0
    );
    expect(solved.boardOf.get("a")).toBe(solved.boardOf.get("b"));
    expect(solved.boardOf.get("far")).not.toBe(solved.boardOf.get("a"));
    expect(solved.boards.size).toBe(2);
  });

  it("gives the larger type the board first when two names compete", () => {
    const solved = solveNames(
      [at("a", 0), at("b", 0.5, { footprint: 4.5 })],
      sizes,
      () => 0
    );
    expect(solved.placed[0]?.[1]?.has("b")).toBe(true);
  });

  it.each([
    ["small", smallFixture],
    ["medium", mediumFixture],
    ["pathological", pathologicalFixture],
  ])(
    "lays the %s fixture out the same every time, no two prints touching at any mix of sizes",
    (_, fixture) => {
      const graph = fixture as unknown as SchemaGraph;
      const placements = layoutCity(graph);
      const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
      const named = sizesOf(printsFor(placements, (id) => names.get(id), mono));
      const usage = (id: string) => id.length;
      const solved = solveNames(placements, named, usage);
      expect(solveNames(placements, named, usage)).toEqual(solved);
      const clashes = solved.placed.flatMap((way) => {
        const prints = way.flatMap((level, size) =>
          [...level].map(([id, spot]) => ({
            id,
            size,
            board: solved.boardOf.get(id),
            rect: spot.rect,
          }))
        );
        expect(prints.length).toBeGreaterThan(placements.length);
        return [
          ...printsOverBuildings(prints, placements),
          ...printsOverPrints(prints),
        ];
      });
      expect(clashes).toEqual([]);
    }
  );
});

describe("stepName", () => {
  const one = (id: string, x: number): Standing => ({
    id,
    position: { x, z: 0 },
    footprint: 4,
    district: "d",
  });
  const sizes = new Map([
    [
      "a",
      {
        ems: [0.64, 1, 1.6],
        levels: [
          [{ width: 2, height: 1 }],
          [{ width: 3, height: 1.5 }],
          [{ width: 5, height: 2 }],
        ],
      },
    ],
  ]);
  const solution = solveNames([one("a", 0)], sizes, () => 0);
  const name = { id: "a", perEm: 10, ems: sizes.get("a")?.ems ?? [] };
  const upright = { flipped: false, step: 0.5 };

  it("shows a name at its board's size once it reads, fading in a step at a time", () => {
    const fades = newFades(1);
    fades.tiers.set("d", 2);
    expect(stepName(fades, solution, 0, name, upright)).toBe(2);
    expect(Array.from(fades.presence)).toEqual([0, 0, 0.5]);
    expect(fades.moving).toBe(true);
    fades.moving = false;
    stepName(fades, solution, 0, name, upright);
    expect(fades.presence[2]).toBe(1);
    expect(fades.moving).toBe(false);
  });

  it("cross-fades the old size out while the new one fades in", () => {
    const fades = newFades(1);
    fades.tiers.set("d", 2);
    stepName(fades, solution, 0, name, { flipped: false, step: 1 });
    fades.tiers.set("d", 1);
    expect(stepName(fades, solution, 0, name, upright)).toBe(1);
    expect(Array.from(fades.presence)).toEqual([0, 0.5, 0.5]);
  });

  it("keeps a name that read through the band, and fades it only under it", () => {
    const fades = newFades(1);
    fades.tiers.set("d", 2);
    const at = (px: number) => ({ ...name, perEm: px / 1.6 });
    const still = { flipped: false, step: 1 };
    expect(stepName(fades, solution, 0, at(6.5), still)).toBe(-1);
    expect(stepName(fades, solution, 0, at(7), still)).toBe(2);
    expect(stepName(fades, solution, 0, at(6.2), still)).toBe(2);
    expect(stepName(fades, solution, 0, at(5.9), still)).toBe(-1);
    expect(fades.presence[2]).toBe(0);
  });

  it("shows nothing on a board the camera has not sized yet", () => {
    expect(stepName(newFades(1), solution, 0, name, upright)).toBe(-1);
  });
});

describe("updateTiers", () => {
  it("sizes each board from the camera's distance to it, and keeps it through a wobble", () => {
    const fades = newFades(0);
    const boards = new Map([
      ["near", { rect: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, y: 0 }],
      ["far", { rect: { minX: 500, maxX: 510, minZ: 0, maxZ: 10 }, y: 0 }],
    ]);
    updateTiers(fades, boards, { x: 5, y: 20, z: 5 }, 1000);
    expect(fades.tiers.get("near")).toBe(0);
    expect(fades.tiers.get("far")).toBe(2);
    const near = fades.tiers.get("near");
    for (const y of [21, 19, 22, 20])
      updateTiers(fades, boards, { x: 5, y, z: 5 }, 1000);
    expect(fades.tiers.get("near")).toBe(near);
  });
});
