import { describe, expect, it } from "vitest";
import type {
  PropertyGroup,
  SchemaNode,
  SchemaProperty,
} from "../../model/types";
import type { Placement } from "../layout/city";
import { buildFloorCells, buildPlazaCells, smootherstep } from "./buildings";

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
  editorAlias: "Umbraco.TextBox",
  editorUiAlias: null,
  mandatory,
  variesByCulture: false,
  fromCompositionId: null,
  targets: [],
});

describe("property windows", () => {
  it("puts one window per property on the walls of its own floor", () => {
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
    // Two windows on one floor land on opposite walls, and the composed floor's
    // window sits a floor higher.
    expect(windows[0].rotY).not.toBe(windows[1].rotY);
    expect(windows[0].cy).toBeCloseTo(0.3);
    expect(windows[2].cy).toBeCloseTo(0.9);
    // Every window stands just off the 2-unit footprint, never inside it.
    for (const w of windows) {
      expect(Math.max(Math.abs(w.cx), Math.abs(w.cz))).toBeCloseTo(1.012);
    }
  });

  it("stops a row of windows before it draws on itself", () => {
    const properties = Array.from({ length: 60 }, (_, i) => property(`p${i}`));
    const nodes = new Map([
      ["a", node("a", { groups: [group({ properties })] })],
    ]);
    const { windows } = buildFloorCells(nodes, [placement("a")]);

    // A 2-unit footprint has 8 units of wall, and windows sit 0.28 apart.
    expect(windows).toHaveLength(28);
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
  it("gives a node with no groups one own floor", () => {
    const nodes = new Map([["a", node("a")]]);
    const { cells, heights } = buildFloorCells(nodes, [placement("a")]);

    expect(cells).toEqual([
      expect.objectContaining({ buildingId: "a", kind: "own" }),
    ]);
    expect(heights.get("a")).toBeCloseTo(0.6);
  });

  it("marks a composed group and separates a new tab", () => {
    const nodes = new Map([
      [
        "a",
        node("a", {
          groups: [
            group({ type: "Tab", fromCompositionId: null }),
            group({ type: "Tab", fromCompositionId: "comp" }),
          ],
        }),
      ],
    ]);
    const { cells, heights } = buildFloorCells(nodes, [placement("a")]);

    expect(cells.map((c) => c.kind)).toEqual(["own", "separator", "composed"]);
    expect(heights.get("a")).toBeCloseTo(1.26);
  });

  it("renders an element type as one warehouse box, never stacked", () => {
    const nodes = new Map([
      [
        "e",
        node("e", {
          isElement: true,
          groups: [group(), group()],
        }),
      ],
    ]);
    const { cells } = buildFloorCells(nodes, [placement("e")]);

    expect(cells).toEqual([expect.objectContaining({ kind: "element" })]);
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
    expect(standing.heights.get("a")).toBeCloseTo(1.8);

    const flat = buildFloorCells(nodes, [placement("a", { flatten: 1 })]);
    expect(flat.heights.get("a")).toBeCloseTo(0.1);
    // Three floors still, stacked inside the plate rather than dropped.
    expect(flat.cells).toHaveLength(3);
    expect(Math.max(...flat.cells.map((c) => c.cy + c.sy / 2))).toBeCloseTo(
      0.1
    );

    // Half way through the tween it is half way down, near enough.
    const half = buildFloorCells(nodes, [placement("a", { flatten: 0.5 })]);
    expect(half.heights.get("a")).toBeCloseTo(0.95);
  });

  it("flattens an Element Type's warehouse too", () => {
    const nodes = new Map([["a", node("a", { isElement: true })]]);

    expect(
      buildFloorCells(nodes, [placement("a", { flatten: 1 })]).heights.get("a")
    ).toBeCloseTo(0.1);
  });
});
