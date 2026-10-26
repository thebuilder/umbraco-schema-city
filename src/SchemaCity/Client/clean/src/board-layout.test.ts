import mediumFixture from "@schema-city/core/fixtures/medium.json";
import { plannedBaseline } from "@schema-city/core/fixtures/planned-baseline.ts";
import { compareSchemas } from "@schema-city/core/model/snapshots";
import type { SchemaGraph } from "@schema-city/core/model/types";
import { expect, test } from "vitest";
import {
  boardEdges,
  boardLayout,
  boardOwnsKey,
  boundsOf,
  CARD_HEIGHT,
  CARD_WIDTH,
  cardCaption,
  cardKey,
  cardLook,
  cardState,
  cardTitle,
  inView,
  keyMove,
  levelRows,
  lineTops,
  linkPath,
  linkState,
  litLast,
  panelCovers,
  picked,
  rampFill,
  readableView,
  revealCentre,
  sizeBar,
  sizeOf,
  tangle,
  untangle,
  zoomBand,
} from "./board-layout";

const medium = mediumFixture as unknown as SchemaGraph;
const PROPERTIES = /^\d+ properties$/;
const ELEMENT = /^Element · \d+ properties$/;
const homeId = medium.nodes.find((node) => node.alias === "home")?.id ?? "";

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD_WIDTH && Math.abs(a.y - b.y) < CARD_HEIGHT;

test("places every type once, no two cards on top of each other", () => {
  const { cards, frames } = boardLayout({ graph: medium, focus: null });
  expect(cards).toHaveLength(medium.nodes.length);
  expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
  for (const [index, card] of cards.entries())
    for (const other of cards.slice(index + 1))
      expect(overlaps(card, other), `${card.id} and ${other.id}`).toBe(false);
  // Every card sits inside one of the district frames.
  for (const card of cards)
    expect(
      frames.some(
        (frame) =>
          card.x >= frame.x &&
          card.y >= frame.y &&
          card.x + CARD_WIDTH <= frame.x + frame.width &&
          card.y + CARD_HEIGHT <= frame.y + frame.height
      )
    ).toBe(true);
});

test("keeps the board about as wide as it is tall, so it fits a screen", () => {
  const { frames } = boardLayout({ graph: medium, focus: null });
  const width = Math.max(...frames.map((frame) => frame.x + frame.width));
  const height = Math.max(...frames.map((frame) => frame.y + frame.height));
  expect(width / height).toBeGreaterThan(0.5);
  expect(width / height).toBeLessThan(3);
});

test("lays out the same board for the same schema", () => {
  expect(boardLayout({ graph: medium, focus: null })).toEqual(
    boardLayout({ graph: medium, focus: null })
  );
});

test("a focus shows the neighbourhood alone, without frames", () => {
  const near = boardLayout({ graph: medium, focus: homeId });
  const far = boardLayout({ graph: medium, focus: homeId, focusDepth: 2 });
  expect(near.frames).toEqual([]);
  expect(near.cards.map((card) => card.id)).toContain(homeId);
  expect(near.cards.length).toBe(near.shown?.size);
  expect(near.cards.length).toBeLessThan(medium.nodes.length);
  expect(far.cards.length).toBeGreaterThan(near.cards.length);
});

test("outlines the baseline's removed types while comparing", () => {
  // The planned baseline lacks Press Release, so read the other way round it is
  // the type the current schema removed.
  const current = plannedBaseline(medium);
  const comparison = compareSchemas(medium, current);
  const { removed, cards } = boardLayout({
    graph: current,
    baseline: medium,
    comparison,
    focus: null,
  });
  const gone = comparison.removed.map((change) => change.baselineId);
  expect(gone).toHaveLength(1);
  expect(removed.map((card) => card.id)).toEqual(gone);
  expect(cards).toHaveLength(current.nodes.length);
  for (const card of cards) expect(overlaps(card, removed[0])).toBe(false);
});

test("draws only the layers that are on, once per pair, inside a focus", () => {
  const edges = medium.edges ?? [];
  const structure = boardEdges(edges, ["structure"], null);
  expect(structure.every((edge) => edge.kind === "allowedChild")).toBe(true);
  expect(new Set(structure.map((edge) => edge.id)).size).toBe(structure.length);
  // inherits repeats a composition, so the compositions layer draws composition only.
  expect(
    boardEdges(edges, ["compositions"], null).some(
      (edge) => edge.kind === "inherits"
    )
  ).toBe(false);
  const shown = new Set([homeId]);
  expect(boardEdges(edges, ["structure"], shown)).toEqual([]);
});

test("paints a card in its district's colour, or the lens's", () => {
  expect(cardLook("elements")).toEqual({
    accent: "var(--amber)",
    tile: "color-mix(in oklab, var(--amber) 16%, var(--panel))",
    wash: undefined,
  });
  expect(cardLook("structure", "var(--azure)")).toEqual({
    accent: "var(--azure)",
    tile: "color-mix(in oklab, var(--azure) 16%, var(--panel))",
    wash: "color-mix(in oklab, var(--azure) 8%, var(--panel))",
  });
});

test("colours a lens the City's way", () => {
  expect(rampFill("binary", 1)).toBe("var(--signal)");
  expect(rampFill("binary", 0)).toBe("var(--phosphor-dim)");
  expect(rampFill("change", 1)).toBe("var(--azure)");
  expect(rampFill("sequential", 0.5)).toBe(
    "color-mix(in oklab, var(--amber), var(--azure) 50%)"
  );
});

test("frames everything, outlines of removed types included", () => {
  const layout = boardLayout({ graph: medium, focus: null });
  const box = boundsOf(layout);
  for (const card of layout.cards) {
    expect(card.x).toBeGreaterThanOrEqual(box.x);
    expect(card.y + CARD_HEIGHT).toBeLessThanOrEqual(box.y + box.height);
  }
});

test("a line falls from the bottom of a card to the top of the next row's", () => {
  const card = { x: 0, y: 0, width: 200, height: 50 };
  // Straight down to a card below, from under it.
  expect(linkPath(card, { ...card, y: 150 })).toBe(
    "M 100,50 C 100,100 100,100 100,150"
  );
  // To a card below and right, it leaves near the right corner and arrives near
  // the left one.
  expect(linkPath(card, { ...card, x: 600, y: 150 })).toBe(
    "M 184,50 C 184,100 616,100 616,150"
  );
  // Up to a card above, from the top.
  expect(linkPath(card, { ...card, y: -150 })).toBe(
    "M 100,0 C 100,-50 100,-50 100,-100"
  );
  // Side to side within a row.
  expect(linkPath(card, { ...card, x: 300 })).toBe(
    "M 200,25 C 250,25 250,25 300,25"
  );
  expect(linkPath(card, { ...card, x: -300 })).toBe(
    "M 0,25 C -50,25 -50,25 -100,25"
  );
});

test("a selection lights its neighbours and fades the rest, not in focus", () => {
  const lit = new Set(["a", "b"]);
  expect(cardState("a", "a", lit)).toBe("selected");
  expect(cardState("b", "a", lit)).toBe("lit");
  expect(cardState("c", "a", lit)).toBe("faded");
  expect(cardState("c", null, null)).toBe("plain");
  expect(linkState({ from: "a", to: "c" }, "a")).toBe("lit");
  expect(linkState({ from: "b", to: "c" }, "a")).toBe("faded");
  expect(linkState({ from: "b", to: "c" }, null)).toBe("plain");
  const edges = [
    { from: "a", to: "b" },
    { from: "c", to: "d" },
    { from: "e", to: "a" },
  ];
  expect(litLast(edges, "a").map((edge) => edge.from)).toEqual(["c", "a", "e"]);
  expect(litLast(edges, null)).toBe(edges);
});

test("says what a card is and how many properties it has", () => {
  const home = medium.nodes.find((node) => node.id === homeId);
  if (!home) throw new Error("the fixture has no home");
  expect(cardCaption(home)).toMatch(PROPERTIES);
  expect(
    cardCaption({ ...home, ownPropertyCount: 1, composedPropertyCount: 0 })
  ).toBe("1 property");
  expect(cardCaption({ ...home, isElement: true })).toMatch(ELEMENT);
  expect(cardCaption(home, true)).toBe("Removed since the baseline");
});

test("arrows pan the way they point, Shift twice as far, + and - zoom", () => {
  const press = (key: string, extra = {}) => ({
    key,
    repeat: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    ...extra,
  });
  expect(keyMove(press("ArrowLeft"))).toEqual({
    pan: { x: 80, y: 0 },
    duration: 120,
  });
  expect(keyMove(press("ArrowDown", { shiftKey: true }))).toEqual({
    pan: { x: 0, y: -160 },
    duration: 120,
  });
  expect(keyMove(press("="))).toEqual({ zoom: "in", duration: 120 });
  expect(keyMove(press("-"))).toEqual({ zoom: "out", duration: 120 });
  // A held key steps without a glide, so repeats do not cut each other short.
  expect(keyMove(press("ArrowUp", { repeat: true }))?.duration).toBe(0);
  expect(keyMove(press("a"))).toBeNull();
  // Cmd and minus is the browser's zoom, not the board's.
  expect(keyMove(press("-", { metaKey: true }))).toBeNull();
});

test("Enter on another card selects it first; Escape keeps focus on the board", () => {
  expect(cardKey("Enter", "b", "a")).toBe("select");
  expect(cardKey("Enter", "a", "a")).toBeUndefined();
  expect(cardKey("Enter", null, "a")).toBeUndefined();
  expect(cardKey("ArrowLeft", "b", "a")).toBeUndefined();
  expect(cardKey("Escape", "a", "a")).toBe("refocus");
  expect(cardKey("Escape", null, null)).toBeUndefined();
});

test("the board takes keys pressed on it or on an unfocused page", () => {
  const card = { tagName: "DIV" };
  const board = { contains: (node: never) => node === (card as never) };
  expect(boardOwnsKey(card, board)).toBe(true);
  expect(boardOwnsKey({ tagName: "BODY" }, board)).toBe(true);
  expect(boardOwnsKey({ tagName: "INPUT" }, board)).toBe(false);
  expect(boardOwnsKey({ tagName: "INPUT" }, null)).toBe(false);
});

test("only a select change picks a card", () => {
  expect(
    picked([
      { type: "select", id: "a", selected: true },
      { type: "select", id: "b", selected: false },
      { type: "position", id: "c" },
    ])
  ).toEqual(["a"]);
});

test("a pick waits for a double-click only where the panel will dock over it", () => {
  expect(panelCovers(1000, 1440, 520)).toBe(true);
  expect(panelCovers(900, 1440, 520)).toBe(false);
  // Open already, the board has narrowed and nothing more moves.
  expect(panelCovers(1000, 1440, 520, true)).toBe(false);
  // Too narrow to dock: the panel covers, and nothing is gained by waiting.
  expect(panelCovers(700, 700, 0)).toBe(false);
});

test("a card the narrowed board cut off is centred, one in view stays put", () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  const area = { width: 800, height: 600 };
  expect(revealCentre({ x: 10, y: 10 }, viewport, area)).toBeNull();
  expect(revealCentre({ x: 700, y: 10 }, viewport, area)).toEqual({
    x: 700 + CARD_WIDTH / 2,
    y: 10 + CARD_HEIGHT / 2,
  });
});

test("a card is in view only when it is clear of the inspector", () => {
  const open = { width: 500, height: 400 };
  const viewport = { x: 0, y: 0, zoom: 1 };
  expect(inView({ x: 10, y: 10 }, viewport, open)).toBe(true);
  expect(inView({ x: 400, y: 10 }, viewport, open)).toBe(false);
  expect(inView({ x: -5, y: 10 }, viewport, open)).toBe(false);
  expect(inView({ x: 400, y: 10 }, { ...viewport, zoom: 0.5 }, open)).toBe(
    true
  );
});

test("a card drops its caption, then a line of its name, then the name, zooming out", () => {
  expect(zoomBand(1)).toBe("near");
  expect(zoomBand(0.75)).toBe("near");
  expect(zoomBand(0.55)).toBe("name");
  expect(zoomBand(0.45)).toBe("name");
  expect(zoomBand(0.35)).toBe("label");
  expect(zoomBand(0.25)).toBe("label");
  expect(zoomBand(0.2)).toBe("tile");
});

test("a board too big to fit starts at its top left, with the focused card in view", () => {
  const open = { width: 500, height: 400 };
  const fitted = { x: -30, y: 20, zoom: 0.5 };
  const wide = { x: 0, y: 0, width: 1200, height: 300 };
  expect(readableView(fitted, wide, undefined, open, 40)).toEqual({
    x: 40,
    y: 20,
    zoom: 0.5,
  });
  const small = { x: 0, y: 0, width: 400, height: 300 };
  expect(readableView(fitted, small, undefined, open, 40)).toEqual(fitted);
  const far = { x: 1100, y: 10 };
  const moved = readableView(fitted, wide, far, open, 40);
  expect(moved.zoom).toBe(0.5);
  expect(inView(far, moved, open)).toBe(true);
});

test("a row is ordered under the cards it hangs from", () => {
  const edges = [
    { from: "A", to: "a", kind: "allowedChild" },
    { from: "B", to: "b", kind: "allowedChild" },
  ];
  expect(
    untangle(
      [
        ["A", "B"],
        ["b", "a"],
      ],
      edges
    )
  ).toEqual([
    ["A", "B"],
    ["a", "b"],
  ]);
  // Nothing to untangle keeps the City's order.
  expect(
    untangle(
      [
        ["A", "B"],
        ["b", "a"],
      ],
      []
    )
  ).toEqual([
    ["A", "B"],
    ["b", "a"],
  ]);
});

test("untangling never leaves rows more tangled than it found them", () => {
  const structure = (medium.edges ?? []).filter(
    (edge) => edge.kind === "allowedChild"
  );
  const links = structure.map((edge): [string, string] => [edge.from, edge.to]);
  const lines = new Map<number, string[]>();
  for (const card of boardLayout({ graph: medium, focus: homeId }).cards)
    lines.set(card.y, [...(lines.get(card.y) ?? []), card.id]);
  // Each row reversed, an order the City never gives.
  const scrambled = [...lines.values()].map((line) => [...line].reverse());
  const untangled = untangle(scrambled, structure);
  expect(tangle(untangled, links)).toBeLessThan(tangle(scrambled, links));
  expect(untangled.flat().sort()).toEqual(scrambled.flat().sort());
});

test("a card's size bar has a segment per group, as long as its properties", () => {
  const group = (id: string, count: number, from: string | null = null) => ({
    id,
    alias: id,
    name: id,
    type: "Group" as const,
    parentAlias: null,
    fromCompositionId: from,
    properties: Array.from({ length: count }, () => ({}) as never),
  });
  const bar = sizeBar({ groups: [group("a", 8), group("b", 0, "seo")] });
  expect(bar).toEqual([
    { id: "a", share: 8 / 32, composed: false },
    { id: "b", share: 0.5 / 32, composed: true },
  ]);
  // A type past the cap fills the bar and no more.
  const big = sizeBar({ groups: [group("a", 30), group("b", 30)] });
  expect(big.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1);
  expect(sizeBar({ groups: [] })).toEqual([]);
  // Past twelve groups the bar is two stretches, own and composed.
  const many = sizeBar({
    groups: [
      ...Array.from({ length: 12 }, (_, at) => group(`own${at}`, 2)),
      group("seo", 4, "seo"),
    ],
  });
  expect(many.map((segment) => segment.id)).toEqual(["own", "composed"]);
  expect(many[0].share).toBeCloseTo(24 / 32);
  expect(sizeOf({ groups: [group("a", 1)] })).toBe("1 group · 1 property");
  const home = medium.nodes.find((node) => node.id === homeId);
  expect(home && sizeOf(home)).toBe("7 groups · 26 properties");
  expect(home && cardTitle(home)).toBe("Home\n7 groups · 26 properties");
  expect(home && cardTitle(home, true)).toBe("Home");
});

test("a district stands in levels below its root, a stray type on a last level", () => {
  const edges = [
    { from: "root", to: "a", kind: "allowedChild" },
    { from: "root", to: "b", kind: "allowedChild" },
    { from: "a", to: "deep", kind: "allowedChild" },
    { from: "b", to: "a", kind: "allowedChild" },
    { from: "outside", to: "lost", kind: "allowedChild" },
  ];
  expect(
    levelRows(["deep", "b", "a", "root", "lost"], edges, new Set(["root"]))
  ).toEqual({
    rows: [["root"], ["b", "a"], ["deep"], ["lost"]],
    labels: ["Level 1", "Level 2", "Level 3", "Not below a root here"],
  });
  // A parent in another district still counts toward the level.
  expect(
    levelRows(
      ["root", "below"],
      [
        { from: "root", to: "elsewhere", kind: "allowedChild" },
        { from: "elsewhere", to: "below", kind: "allowedChild" },
      ],
      new Set(["root"])
    )
  ).toEqual({ rows: [["root"], ["below"]], labels: ["Level 1", "Level 3"] });
  // No root, or one level only, gives one row and no labels.
  expect(levelRows(["x", "y"], edges, new Set())).toEqual({
    rows: [["x", "y"]],
    labels: null,
  });
  expect(levelRows(["root"], edges, new Set(["root"]))).toEqual({
    rows: [["root"]],
    labels: null,
  });
});

test("a wrapped level follows close; a new level opens under its label", () => {
  const { tops, levels, height } = lineTops([0, 1, 1], ["Level 1", "Level 2"]);
  const labelled = (index: number) => levels[index]?.y ?? Number.NaN;
  expect(levels.map((level) => level.label)).toEqual(["Level 1", "Level 2"]);
  // The second level's label sits between the levels, below the first's cards.
  expect(labelled(1)).toBeGreaterThan((tops[0] ?? 0) + CARD_HEIGHT);
  const wrapGap = (tops[2] ?? 0) - (tops[1] ?? 0) - CARD_HEIGHT;
  const levelGap = (tops[1] ?? 0) - (tops[0] ?? 0) - CARD_HEIGHT;
  expect(wrapGap).toBeLessThan(levelGap);
  expect(height).toBe((tops[2] ?? 0) + CARD_HEIGHT);
  // Rows that are not levels carry no labels.
  expect(lineTops([0, 1], null).levels).toEqual([]);
});

test("the Site district reads Home on the level under Site", () => {
  const { cards, levels } = boardLayout({ graph: medium, focus: null });
  const yOf = (alias: string) =>
    cards.find(
      (card) =>
        card.id === medium.nodes.find((node) => node.alias === alias)?.id
    )?.y ?? Number.NaN;
  expect(yOf("home")).toBeGreaterThan(yOf("site"));
  expect(levels.some((level) => level.label === "Level 2")).toBe(true);
  // Grouped by folder, districts are not levels.
  expect(
    boardLayout({ graph: medium, grouping: "folders", focus: null }).levels
  ).toEqual([]);
});
