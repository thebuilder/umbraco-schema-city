import { describe, expect, it } from "vitest";
import type { PropertyGroup, SchemaNode } from "../../model/types";
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
    district: "structure",
    introDelay: 0,
    ...extra,
  };
}

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
