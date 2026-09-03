import { describe, expect, it } from "vitest";
import { type Neighbourhood, neighbourhoods } from "../../model/neighbourhood";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../../model/types";
import { layoutCity, type Placement } from "./city";
import { layoutFocus } from "./focus";

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

const graphOf = (nodes: SchemaNode[], edges: SchemaEdge[] = []): SchemaGraph => ({
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
    { kind: "reference", from: "hub", to: "referenceTarget", propertyAlias: "picker" },
    { kind: "reference", from: "referenceSource", to: "hub", propertyAlias: "picker" },
  ],
);

function focusOn(graph: SchemaGraph, id: string) {
  const city = layoutCity(graph);
  const focus = layoutFocus(graph, neighbourhoods(graph).get(id) as Neighbourhood, id, city);
  return {
    city,
    focus,
    at: (nodeId: string) => focus.find((p) => p.id === nodeId) as Placement,
    moved: focus.filter((placement, i) => placement !== city[i]),
  };
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
    const quarter = ({ position, y }: Placement) => ({
      x: Math.sign(position.x),
      z: Math.sign(position.z),
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
    expect(quarter(at("referenceTarget"))).toEqual({ x: 1, z: 0, raised: false });
    expect(quarter(at("referenceSource"))).toEqual({ x: -1, z: 0, raised: false });
  });

  it("folds forty children onto five rows to the south", () => {
    const children = Array.from({ length: 40 }, (_, i) => `child${String(i).padStart(2, "0")}`);
    const graph = graphOf(
      [node("home", { allowedAsRoot: true }), ...children.map((alias) => node(alias))],
      children.map((alias): SchemaEdge => ({ kind: "allowedChild", from: "home", to: alias })),
    );
    const { at } = focusOn(graph, "home");

    const rows = new Map<number, number>();
    for (const alias of children) {
      const { position } = at(alias);
      expect(position.z).toBeGreaterThan(0);
      rows.set(position.z, (rows.get(position.z) ?? 0) + 1);
    }

    expect([...rows.values()]).toEqual([8, 8, 8, 8, 8]);
  });

  it("leaves every node outside the neighbourhood exactly where the city put it", () => {
    const graph = graphOf(
      [node("hub", { allowedAsRoot: true }), node("child"), node("stranger", { allowedAsRoot: true })],
      [{ kind: "allowedChild", from: "hub", to: "child" }],
    );
    const { city, focus } = focusOn(graph, "hub");
    const before = city.find((p) => p.id === "stranger");

    expect(focus.find((p) => p.id === "stranger")).toBe(before);
  });

  it("moves only the focused node when it has no neighbours", () => {
    const graph = graphOf([node("lonely", { allowedAsRoot: true }), node("stranger")]);
    const { moved, at } = focusOn(graph, "lonely");

    expect(moved.map((p) => p.id)).toEqual(["lonely"]);
    expect(at("lonely").position).toEqual({ x: 0, z: 0 });
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
