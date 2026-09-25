import { describe, expect, it } from "vitest";
import type {
  PropertyGroup,
  SchemaEdge,
  SchemaNode,
  SchemaProperty,
} from "../../model/types";
import type { Placement } from "../layout/city";
import {
  buildFloorCells,
  buildingBox,
  buildPlazaCells,
  connectionsOf,
  roleOf,
  smootherstep,
} from "./buildings";

function node(id: string, extra: Partial<SchemaNode> = {}): SchemaNode {
  return {
    id,
    alias: id,
    name: id,
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

function group(extra: Partial<PropertyGroup> = {}): PropertyGroup {
  return {
    id: "g",
    alias: "g",
    name: "g",
    type: "Group",
    parentAlias: null,
    fromCompositionId: null,
    properties: [],
    ...extra,
  };
}

function placement(id: string, extra: Partial<Placement> = {}): Placement {
  return {
    id,
    position: { x: 0, z: 0 },
    footprint: 2,
    height: 0.6,
    floors: 1,
    district: "pages",
    districtKind: "structure",
    introDelay: 0,
    ...extra,
  };
}

const property = (alias: string, mandatory = false): SchemaProperty => ({
  alias,
  name: alias,
  dataTypeId: "d",
  dataTypeName: null,
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: null,
  mandatory,
  variesByCulture: false,
  fromCompositionId: null,
  targets: [],
});

const edge = (
  kind: SchemaEdge["kind"],
  from: string,
  to: string,
  propertyAlias?: string
): SchemaEdge => ({ kind, from, to, propertyAlias });

const kinds = (cells: { kind: string }[]) => cells.map((c) => c.kind);

describe("property windows", () => {
  it("puts one window per property on the walls of its own slab", () => {
    const nodes = new Map([
      [
        "a",
        node("a", {
          groups: [
            group({ properties: [property("one"), property("two", true)] }),
            group({
              alias: "b",
              fromCompositionId: "comp",
              properties: [property("three")],
            }),
          ],
        }),
      ],
    ]);
    const { windows } = buildFloorCells(nodes, [placement("a")]);

    expect(windows).toHaveLength(3);
    expect(windows.map((w) => w.kind)).toEqual(["own", "own", "composed"]);
    expect(windows.map((w) => w.mandatory)).toEqual([false, true, false]);
    // Two windows on one slab land on opposite walls, and the composed slab's
    // window sits a floor higher: plinth, gap, then half a slab.
    expect(windows[0].rotY).not.toBe(windows[1].rotY);
    expect(windows[0].cy).toBeCloseTo(0.49);
    expect(windows[2].cy).toBeCloseTo(1.09);
    // Every window stands just off the slab, which is 0.8 of the 2-unit footprint.
    for (const w of windows) {
      expect(Math.max(Math.abs(w.cx), Math.abs(w.cz))).toBeCloseTo(0.812);
    }
  });

  it("stops a row of windows before it draws on itself", () => {
    const properties = Array.from({ length: 60 }, (_, i) => property(`p${i}`));
    const nodes = new Map([
      ["a", node("a", { groups: [group({ properties })] })],
    ]);
    const { windows } = buildFloorCells(nodes, [placement("a")]);

    // A 1.6-unit slab has 6.4 units of wall, and windows sit 0.28 apart.
    expect(windows).toHaveLength(22);
  });

  it("gives an Element Type no windows, because it has no floors", () => {
    const nodes = new Map([
      [
        "a",
        node("a", {
          isElement: true,
          groups: [group({ properties: [property("one")] })],
        }),
      ],
    ]);

    expect(buildFloorCells(nodes, [placement("a")]).windows).toEqual([]);
  });
});

describe("buildFloorCells", () => {
  it("gives a node with no groups a plinth, one own slab, a core and a lid", () => {
    const nodes = new Map([["a", node("a")]]);
    const { cells, heights } = buildFloorCells(nodes, [placement("a")]);

    expect(kinds(cells)).toEqual(["plinth", "own", "core", "lid"]);
    expect(heights.get("a")).toBeCloseTo(0.8);
  });

  it("leaves a gap between slabs and puts a board in the gap before a tab", () => {
    const nodes = new Map([
      [
        "a",
        node("a", {
          groups: [
            group({ type: "Tab" }),
            group({ type: "Group" }),
            group({ type: "Tab", fromCompositionId: "comp" }),
          ],
        }),
      ],
    ]);
    const { cells, heights } = buildFloorCells(nodes, [placement("a")]);
    const slabs = cells.filter(
      (c) => c.kind === "own" || c.kind === "composed"
    );

    expect(kinds(slabs)).toEqual(["own", "own", "composed"]);
    expect(cells.filter((c) => c.kind === "separator")).toHaveLength(1);
    // Every slab is clear of the one under it, so the groups can be counted.
    for (let i = 1; i < slabs.length; i++) {
      const below = slabs[i - 1].cy + slabs[i - 1].sy / 2;
      expect(slabs[i].cy - slabs[i].sy / 2 - below).toBeCloseTo(0.1);
    }
    expect(heights.get("a")).toBeCloseTo(0.14 + 3 * 0.6 + 0.06);
  });

  it("lights the lid of a page with a template", () => {
    const nodes = new Map([
      [
        "a",
        node("a", {
          templates: [{ id: "t", alias: "t", name: "t", isDefault: true }],
        }),
      ],
    ]);

    expect(kinds(buildFloorCells(nodes, [placement("a")]).cells)).toContain(
      "litLid"
    );
  });

  it("renders an element type as one low block, never stacked", () => {
    const nodes = new Map([
      [
        "e",
        node("e", {
          isElement: true,
          groups: [group(), group()],
        }),
      ],
    ]);
    const { cells, heights } = buildFloorCells(nodes, [placement("e")]);

    expect(kinds(cells)).toEqual(["plinth", "element"]);
    expect(heights.get("e")).toBeCloseTo(0.6);
  });

  it("builds a composition as a hollow shell with no core and no lid", () => {
    const nodes = new Map([
      ["comp", node("comp", { groups: [group(), group()] })],
      ["page", node("page")],
    ]);
    const connections = connectionsOf([edge("composition", "page", "comp")]);
    const { cells } = buildFloorCells(nodes, [placement("comp")], connections);

    expect(kinds(cells).filter((k) => k !== "pin")).toEqual([
      "plinth",
      "composed",
      "composed",
    ]);
  });

  it("marks culture and segment variants with a dot each on the roof", () => {
    const nodes = new Map([
      ["a", node("a", { variesByCulture: true, variesBySegment: true })],
      ["b", node("b", { variesByCulture: true })],
    ]);
    const { cells, heights } = buildFloorCells(nodes, [
      placement("a"),
      placement("b", { position: { x: 10, z: 0 } }),
    ]);
    const markers = cells.filter((c) => c.kind === "marker");

    expect(markers.map((m) => m.buildingId)).toEqual(["a", "a", "b"]);
    for (const m of markers)
      expect(m.cy - m.sy / 2).toBeCloseTo(heights.get(m.buildingId) ?? 0);
  });
});

describe("connectionsOf and roleOf", () => {
  it("counts distinct types per side and skips self edges", () => {
    const { pins, composed } = connectionsOf([
      edge("allowedChild", "home", "page"),
      edge("allowedChild", "home", "news"),
      edge("allowedChild", "home", "home"),
      edge("block", "page", "card", "blocks"),
      edge("block", "page", "card", "moreBlocks"),
      edge("reference", "page", "home", "link"),
      edge("composition", "page", "seo"),
    ]);

    expect(pins.get("home")).toEqual({ north: 0, south: 2, east: 0, west: 1 });
    expect(pins.get("page")).toEqual({ north: 1, south: 0, east: 3, west: 0 });
    expect(pins.get("card")).toEqual({ north: 0, south: 0, east: 0, west: 1 });
    expect([...composed]).toEqual(["seo"]);
  });

  it("calls a composed type a page once content can be made from it", () => {
    const connections = connectionsOf([
      edge("composition", "page", "seo"),
      edge("composition", "page", "base"),
      edge("allowedChild", "home", "base"),
      edge("composition", "page", "root"),
    ]);

    expect(roleOf(node("seo"), connections)).toBe("composition");
    expect(roleOf(node("base"), connections)).toBe("page");
    expect(roleOf(node("root", { allowedAsRoot: true }), connections)).toBe(
      "page"
    );
    expect(roleOf(node("e", { isElement: true }), connections)).toBe("element");
  });

  it("puts one pin per connection on its side, and cuts a long row", () => {
    const children = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const connections = connectionsOf([
      edge("allowedChild", "p", "a"),
      ...children.map((child) => edge("allowedChild", "a", child)),
    ]);
    const { cells } = buildFloorCells(
      new Map([["a", node("a")]]),
      [placement("a")],
      connections
    );
    const pins = cells.filter((c) => c.kind === "pin");
    const north = pins.filter((p) => p.cz < 0);
    const south = pins.filter((p) => p.cz > 0);

    expect(north).toHaveLength(1);
    // A 1.8-unit plinth less its corners holds 7 pins at 0.2 apart.
    expect(south).toHaveLength(7);
    // Pins stand between the plinth and the footprint's edge, never past it.
    for (const pin of pins)
      expect(Math.abs(pin.cz) + pin.sz / 2).toBeCloseTo(1);
  });
});

describe("buildingBox", () => {
  it("wraps the risen building, grown on every side and on top", () => {
    const at = placement("a", { position: { x: 4, z: -2 }, y: 1 });
    const heights = new Map([["a", 2]]);

    expect(buildingBox(at, heights, 0.5, 0, 1)).toEqual({
      x: 4,
      y: 1.5,
      z: -2,
      sx: 2,
      sy: 1,
      sz: 2,
    });
    expect(buildingBox(at, heights, 1, 0.1, 1)).toMatchObject({
      sx: 2.2,
      sy: 2.2,
      y: 2.1,
    });
  });

  it("has none for a building pressed past its limit", () => {
    const flat = placement("a", { flatten: 0.6 });

    expect(buildingBox(flat, new Map(), 1, 0, 0.5)).toBeNull();
    expect(buildingBox(flat, new Map(), 1, 0, 0.999)).not.toBeNull();
  });
});

describe("buildPlazaCells", () => {
  it("puts a plaza under a root that is not an Element Type", () => {
    const nodes = new Map([
      ["root", node("root", { allowedAsRoot: true })],
      ["leaf", node("leaf")],
      ["block", node("block", { allowedAsRoot: true, isElement: true })],
    ]);
    const plazas = buildPlazaCells(nodes, [
      placement("root"),
      placement("leaf"),
      placement("block"),
    ]);

    expect(plazas.map((p) => p.buildingId)).toEqual(["root"]);
  });
});

describe("smootherstep", () => {
  it("clamps and eases between 0 and 1", () => {
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(0.5)).toBeCloseTo(0.5);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(2)).toBe(1);
  });
});

describe("focus mode's flat plates", () => {
  it("presses a whole building down to a plate and back", () => {
    const nodes = new Map([
      ["a", node("a", { groups: [group(), group(), group()] })],
    ]);

    const standing = buildFloorCells(nodes, [placement("a")]);
    expect(standing.heights.get("a")).toBeCloseTo(2);

    const flat = buildFloorCells(nodes, [placement("a", { flatten: 1 })]);
    expect(flat.heights.get("a")).toBeCloseTo(0.1);
    // Every part is still there, stacked inside the plate rather than dropped.
    expect(flat.cells).toHaveLength(standing.cells.length);
    expect(Math.max(...flat.cells.map((c) => c.cy + c.sy / 2))).toBeCloseTo(
      0.1
    );
    expect(flat.windows).toEqual([]);

    // Half way through the tween it is half way down, near enough.
    const half = buildFloorCells(nodes, [placement("a", { flatten: 0.5 })]);
    expect(half.heights.get("a")).toBeCloseTo(1.05);
  });

  it("flattens an Element Type too", () => {
    const nodes = new Map([["a", node("a", { isElement: true })]]);

    expect(
      buildFloorCells(nodes, [placement("a", { flatten: 1 })]).heights.get("a")
    ).toBeCloseTo(0.1);
  });
});
