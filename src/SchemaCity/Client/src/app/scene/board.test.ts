import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import type { SchemaGraph } from "../../model/types";
import { cityDistricts, ISLAND_PAD } from "../layout/city";
import {
  edgeFingers,
  HOLE_INSET,
  holeSpots,
  type Island,
  type Traced,
  traceVias,
} from "./board";
import { planRoutes } from "./roads";

const left: Island = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
const right: Island = { minX: 20, maxX: 30, minZ: 0, maxZ: 10 };
const islands = new Map([
  ["left", left],
  ["right", right],
]);
const home: Record<string, string> = { a: "left", b: "left", c: "right" };
const districtOf = (id: string) => home[id];

/** A route from a building on the left board to one on the right, along z = `z`. */
const across = (from: string, z: number): Traced => ({
  from,
  to: "c",
  points: [
    { x: 5, z: 4 },
    { x: 5, z },
    { x: 25, z },
    { x: 25, z: 4 },
  ],
});

describe("edgeFingers", () => {
  it("puts a finger where a lane leaves its board, on the edge it leaves by", () => {
    expect(edgeFingers([across("a", 6)], districtOf, islands)).toEqual([
      { district: "left", side: "east", x: 10, z: 6 },
    ]);
  });

  it("gives two connections on one lane one finger, and two lanes two", () => {
    const shared = edgeFingers(
      [across("a", 6), across("b", 6)],
      districtOf,
      islands
    );
    const apart = edgeFingers(
      [across("a", 6), across("b", 7)],
      districtOf,
      islands
    );

    expect(shared).toHaveLength(1);
    expect(apart).toHaveLength(2);
  });

  it("makes no finger for a trace that stays on its board", () => {
    const inside: Traced = {
      from: "a",
      to: "b",
      points: [
        { x: 2, z: 2 },
        { x: 2, z: 5 },
        { x: 8, z: 5 },
      ],
    };
    expect(edgeFingers([inside], districtOf, islands)).toEqual([]);
  });

  it("names the north and south edges for a trace that leaves up or down", () => {
    const down: Traced = {
      from: "a",
      to: "c",
      points: [
        { x: 3, z: 5 },
        { x: 3, z: 14 },
      ],
    };
    expect(edgeFingers([down], districtOf, islands)).toEqual([
      { district: "left", side: "south", x: 3, z: 10 },
    ]);
  });

  it("finds at least one finger per pair of linked boards on the medium fixture", () => {
    const graph = mediumFixture as unknown as SchemaGraph;
    const city = cityDistricts(graph);
    const byId = new Map(city.placements.map((p) => [p.id, p] as const));
    const routes = planRoutes(byId, graph.edges).routes.map(
      ({ edge, points }) => ({ from: edge.from, to: edge.to, points })
    );
    const boards = new Map(
      city.districts.map((d) => [
        d.id,
        {
          minX: d.minX - ISLAND_PAD,
          maxX: d.maxX + ISLAND_PAD,
          minZ: d.minZ - ISLAND_PAD,
          maxZ: d.maxZ + ISLAND_PAD,
        },
      ])
    );
    const fingers = edgeFingers(routes, (id) => byId.get(id)?.district, boards);
    const leaving = new Set(
      routes
        .map((route) => byId.get(route.from)?.district)
        .filter(
          (district, i) =>
            district !== byId.get((routes[i] as Traced).to)?.district
        )
    );

    expect(new Set(fingers.map((finger) => finger.district))).toEqual(leaving);
  });
});

describe("traceVias", () => {
  it("puts a via at every turn but not at the two buildings' faces", () => {
    expect(traceVias([across("a", 6)])).toEqual([
      { x: 5, z: 6 },
      { x: 25, z: 6 },
    ]);
  });

  it("puts one via where several traces turn at the same point", () => {
    expect(traceVias([across("a", 6), across("b", 6)])).toHaveLength(2);
  });

  it("puts none where a trace runs straight on", () => {
    const straight: Traced = {
      from: "a",
      to: "b",
      points: [
        { x: 0, z: 0 },
        { x: 0, z: 3 },
        { x: 0, z: 6 },
      ],
    };
    expect(traceVias([straight])).toEqual([]);
  });
});

describe("holeSpots", () => {
  it("insets a hole from each corner", () => {
    expect(holeSpots(left)).toEqual([
      { x: HOLE_INSET, z: HOLE_INSET },
      { x: 10 - HOLE_INSET, z: HOLE_INSET },
      { x: HOLE_INSET, z: 10 - HOLE_INSET },
      { x: 10 - HOLE_INSET, z: 10 - HOLE_INSET },
    ]);
  });

  it("drills none in a board too small to keep four holes apart", () => {
    expect(holeSpots({ minX: 0, maxX: 30, minZ: 0, maxZ: 3 })).toEqual([]);
  });
});
