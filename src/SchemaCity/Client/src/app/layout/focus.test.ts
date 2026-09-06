import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import pathologicalFixture from "../../../dev/fixtures/pathological.json";
import { type Neighbourhood, neighbourhoods } from "../../model/neighbourhood";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../../model/types";
import {
  ISLAND_PAD,
  layoutCity,
  type Placement,
  ROW_LIMIT,
  STREET,
} from "./city";
import { focusAnchor, focusBounds, layoutFocus } from "./focus";

const medium = mediumFixture as unknown as SchemaGraph;
const pathological = pathologicalFixture as unknown as SchemaGraph;

function node(alias: string, extra: Partial<SchemaNode> = {}): SchemaNode {
  return {
    id: alias,
    alias,
    name: alias,
    icon: "icon-document",
    iconColor: null,
    folderId: null,
    isElement: false,
    allowedAsRoot: false,
    variesByCulture: false,
    variesBySegment: false,
    description: null,
    groups: [],
    ownPropertyCount: 0,
    composedPropertyCount: 0,
    templates: [],
    ...extra,
  };
}

const graphOf = (
  nodes: SchemaNode[],
  edges: SchemaEdge[] = []
): SchemaGraph => ({
  generatedAt: "2026-09-03T00:00:00Z",
  folders: [],
  nodes,
  edges,
});

/** Every relation a hub can have, one neighbour each, so each group is identifiable. */
const hub = graphOf(
  [
    node("hub", { allowedAsRoot: true }),
    node("parent", { allowedAsRoot: true }),
    node("child"),
    node("mixin"),
    node("base"),
    node("user"),
    node("blockTarget", { isElement: true }),
    node("blockHost"),
    node("referenceTarget"),
    node("referenceSource"),
  ],
  [
    { kind: "allowedChild", from: "parent", to: "hub" },
    { kind: "allowedChild", from: "hub", to: "child" },
    { kind: "composition", from: "hub", to: "mixin" },
    { kind: "composition", from: "hub", to: "base" },
    { kind: "inherits", from: "hub", to: "base" },
    { kind: "composition", from: "user", to: "hub" },
    { kind: "block", from: "hub", to: "blockTarget", propertyAlias: "blocks" },
    { kind: "block", from: "blockHost", to: "hub", propertyAlias: "blocks" },
    {
      kind: "reference",
      from: "hub",
      to: "referenceTarget",
      propertyAlias: "picker",
    },
    {
      kind: "reference",
      from: "referenceSource",
      to: "hub",
      propertyAlias: "picker",
    },
  ]
);

function focusOn(graph: SchemaGraph, id: string) {
  const city = layoutCity(graph);
  const focus = layoutFocus(
    graph,
    neighbourhoods(graph).get(id) as Neighbourhood,
    id,
    city
  );
  const moved = focus.filter((placement, i) => placement !== city[i]);
  return {
    city,
    focus,
    at: (nodeId: string) => focus.find((p) => p.id === nodeId) as Placement,
    moved,
    bounds: focusBounds(moved),
  };
}

/**
 * The pair of neighbours whose lots overlap, or nothing when the ground is clear.
 * The composition platform is not an excuse: a building standing over another one
 * reads as an overlap from the camera's angle whatever its height.
 */
function overlap(placements: Placement[]): string[] | null {
  for (const a of placements) {
    for (const b of placements) {
      if (a === b) continue;
      const apart = (a.footprint + b.footprint) / 2;
      const clearX = Math.abs(a.position.x - b.position.x) >= apart;
      const clearZ = Math.abs(a.position.z - b.position.z) >= apart;
      if (!(clearX || clearZ)) return [a.id, b.id];
    }
  }
  return null;
}

describe("layoutFocus", () => {
  it("places the focused node at the origin", () => {
    const { at } = focusOn(hub, "hub");

    expect(at("hub").position).toEqual({ x: 0, z: 0 });
    expect(at("hub").y).toBe(0);
  });

  it("moves every neighbour exactly once", () => {
    const { moved } = focusOn(hub, "hub");

    expect(moved.map((p) => p.id).sort()).toEqual([
      "base",
      "blockHost",
      "blockTarget",
      "child",
      "hub",
      "mixin",
      "parent",
      "referenceSource",
      "referenceTarget",
      "user",
    ]);
  });

  it("sends each group to its own quarter of the compass", () => {
    const { at } = focusOn(hub, "hub");
    const side = (value: number) =>
      Math.abs(value) < 1e-9 ? 0 : Math.sign(value);
    const quarter = ({ position, y }: Placement) => ({
      x: side(position.x),
      z: side(position.z),
      raised: (y ?? 0) > 0,
    });

    // North is negative z, south positive, east positive x, west negative.
    expect(quarter(at("parent"))).toEqual({ x: 0, z: -1, raised: false });
    expect(quarter(at("child"))).toEqual({ x: 0, z: 1, raised: false });
    expect(quarter(at("mixin"))).toEqual({ x: -1, z: -1, raised: true });
    expect(quarter(at("base"))).toEqual({ x: -1, z: -1, raised: true });
    expect(quarter(at("user"))).toEqual({ x: 1, z: -1, raised: false });
    expect(quarter(at("blockTarget"))).toEqual({ x: -1, z: 1, raised: false });
    expect(quarter(at("blockHost"))).toEqual({ x: 1, z: 1, raised: false });
    expect(quarter(at("referenceTarget"))).toEqual({
      x: 1,
      z: 0,
      raised: false,
    });
    expect(quarter(at("referenceSource"))).toEqual({
      x: -1,
      z: 0,
      raised: false,
    });
  });

  it("keeps a neighbourhood of one each within three streets of the origin", () => {
    const { moved } = focusOn(hub, "hub");

    for (const placement of moved) {
      expect(Math.abs(placement.position.x)).toBeLessThanOrEqual(STREET * 3);
      expect(Math.abs(placement.position.z)).toBeLessThanOrEqual(STREET * 3);
    }
  });

  it("keeps a group that fits one row within three streets whatever another group does", () => {
    // Forty children fold onto five rows, which is the one reason to stand further
    // out than three streets. The parents to the north are not pushed with them.
    const children = Array.from(
      { length: 40 },
      (_, i) => `child${String(i).padStart(2, "0")}`
    );
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true }),
        node("parent"),
        ...children.map((a) => node(a)),
      ],
      [
        { kind: "allowedChild", from: "parent", to: "home" },
        ...children.map(
          (alias): SchemaEdge => ({
            kind: "allowedChild",
            from: "home",
            to: alias,
          })
        ),
      ]
    );
    const { at } = focusOn(graph, "home");

    expect(Math.abs(at("parent").position.z)).toBeLessThanOrEqual(STREET * 3);
  });

  it("folds forty children onto five rows to the south", () => {
    const children = Array.from(
      { length: 40 },
      (_, i) => `child${String(i).padStart(2, "0")}`
    );
    const graph = graphOf(
      [
        node("home", { allowedAsRoot: true }),
        ...children.map((alias) => node(alias)),
      ],
      children.map(
        (alias): SchemaEdge => ({
          kind: "allowedChild",
          from: "home",
          to: alias,
        })
      )
    );
    const { at } = focusOn(graph, "home");

    const rows = new Map<number, number>();
    for (const alias of children) {
      const { position } = at(alias);
      expect(position.z).toBeGreaterThan(0);
      rows.set(position.z, (rows.get(position.z) ?? 0) + 1);
    }

    expect([...rows.values()]).toEqual([
      ROW_LIMIT,
      ROW_LIMIT,
      ROW_LIMIT,
      ROW_LIMIT,
      ROW_LIMIT,
    ]);
  });

  it("leaves no two buildings standing on the same ground", () => {
    expect(overlap(focusOn(hub, "hub").moved)).toBeNull();

    // Every type in the seeded schema, so a hub with three full groups and a type
    // with one neighbour are both covered, plus the stress fixture's worst hub, whose
    // sixty-two neighbours fill every group at once.
    for (const type of medium.nodes) {
      expect([type.alias, overlap(focusOn(medium, type.id).moved)]).toEqual([
        type.alias,
        null,
      ]);
    }
    const hubPage = pathological.nodes.find(
      (type) => type.alias === "hubPage"
    ) as SchemaNode;
    expect(overlap(focusOn(pathological, hubPage.id).moved)).toBeNull();
  });

  it("covers every placed building plus the island's padding", () => {
    const { moved, bounds } = focusOn(
      medium,
      medium.nodes.find((n) => n.alias === "home")?.id ?? ""
    );

    for (const placement of moved) {
      expect(bounds.minX).toBeLessThanOrEqual(
        placement.position.x - placement.footprint / 2 - ISLAND_PAD
      );
      expect(bounds.maxX).toBeGreaterThanOrEqual(
        placement.position.x + placement.footprint / 2 + ISLAND_PAD
      );
      expect(bounds.minZ).toBeLessThanOrEqual(
        placement.position.z - placement.footprint / 2 - ISLAND_PAD
      );
      expect(bounds.maxZ).toBeGreaterThanOrEqual(
        placement.position.z + placement.footprint / 2 + ISLAND_PAD
      );
    }
    expect(bounds.centre.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2);
    expect(bounds.centre.z).toBeCloseTo((bounds.minZ + bounds.maxZ) / 2);
  });

  it("fits the seeded Home and its forty-two neighbours into about sixty-five units square", () => {
    const home = medium.nodes.find(
      (type) => type.alias === "home"
    ) as SchemaNode;
    const { moved, bounds } = focusOn(medium, home.id);

    expect(moved.length).toBe(43);
    // The buildings themselves, before the island's padding around them.
    expect(bounds.maxX - bounds.minX - ISLAND_PAD * 2).toBeLessThan(65);
    expect(bounds.maxZ - bounds.minZ - ISLAND_PAD * 2).toBeLessThan(65);
  });

  it("gives a node with no neighbours its own footprint plus padding", () => {
    const graph = graphOf([
      node("lonely", { allowedAsRoot: true }),
      node("stranger"),
    ]);
    const { moved, at, bounds } = focusOn(graph, "lonely");

    expect(moved.map((p) => p.id)).toEqual(["lonely"]);
    expect(at("lonely").position).toEqual({ x: 0, z: 0 });
    expect(bounds).toEqual({
      minX: -at("lonely").footprint / 2 - ISLAND_PAD,
      maxX: at("lonely").footprint / 2 + ISLAND_PAD,
      minZ: -at("lonely").footprint / 2 - ISLAND_PAD,
      maxZ: at("lonely").footprint / 2 + ISLAND_PAD,
      centre: { x: 0, z: 0 },
    });
  });

  it("anchors the neighbourhood on the focused node's city position", () => {
    const { city } = focusOn(hub, "hub");
    const home = city.find((p) => p.id === "hub") as Placement;

    expect(focusAnchor(city, "hub")).toEqual(home.position);
    expect(focusAnchor(city, "gone")).toEqual({ x: 0, z: 0 });
  });

  it("leaves every node outside the neighbourhood exactly where the city put it", () => {
    const graph = graphOf(
      [
        node("hub", { allowedAsRoot: true }),
        node("child"),
        node("stranger", { allowedAsRoot: true }),
      ],
      [{ kind: "allowedChild", from: "hub", to: "child" }]
    );
    const { city, focus } = focusOn(graph, "hub");
    const before = city.find((p) => p.id === "stranger");

    expect(focus.find((p) => p.id === "stranger")).toBe(before);
  });

  it("gives the same layout for the same input twice", () => {
    const first = focusOn(hub, "hub").focus;
    const second = focusOn(hub, "hub").focus;

    expect(first).toEqual(second);
  });

  it("keeps a building's own size and district while it is moved", () => {
    const { city, at } = focusOn(hub, "hub");
    const before = city.find((p) => p.id === "blockTarget") as Placement;

    expect(at("blockTarget").footprint).toBe(before.footprint);
    expect(at("blockTarget").district).toBe("elements");
  });
});
