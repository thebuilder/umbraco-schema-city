import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import pathologicalFixture from "../../../dev/fixtures/pathological.json";
import type {
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
} from "../../model/types";
import { cityDistricts, DISTRICT_GAP, type Placement } from "./city";
import { socketsOf, structureGroups } from "./structure";

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

const road = (from: string, to: string): SchemaEdge => ({
  kind: "allowedChild",
  from,
  to,
});

/** A host whose one property is a block editor offering `targets`. */
function host(
  alias: string,
  editor: string,
  targets: [string, "content" | "settings"][]
): SchemaNode {
  const property: SchemaProperty = {
    alias: "blocks",
    name: "Blocks",
    dataTypeId: editor,
    dataTypeName: editor,
    editorAlias: "Umbraco.BlockList",
    editorUiAlias: null,
    mandatory: false,
    variesByCulture: false,
    fromCompositionId: null,
    targets: targets.map(([nodeId, role]) => ({ nodeId, role })),
  };
  return node(alias, {
    groups: [
      {
        id: "g",
        alias: "g",
        name: "g",
        type: "Group",
        parentAlias: null,
        fromCompositionId: null,
        properties: [property],
      },
    ],
  });
}

const groupsOf = (nodes: SchemaNode[], edges: SchemaEdge[] = []) =>
  structureGroups(
    [...nodes].sort((a, b) => (a.alias < b.alias ? -1 : 1)),
    edges
  );

describe("structureGroups", () => {
  it("gives every root its own district, then compositions, elements and the unreachable", () => {
    const groups = groupsOf(
      [
        node("site", { allowedAsRoot: true }),
        node("settings", { allowedAsRoot: true }),
        node("page"),
        node("mixin"),
        node("card", { isElement: true }),
        node("orphan"),
      ],
      [road("site", "page"), { kind: "composition", from: "page", to: "mixin" }]
    );

    expect(groups.map((group) => [group.name, group.members.length])).toEqual([
      ["settings", 1],
      ["site", 2],
      ["Compositions", 1],
      ["Elements", 1],
      ["Unreachable", 1],
    ]);
  });

  it("files a type two roots allow under the nearer one, the earlier root at a tie", () => {
    const groups = groupsOf(
      [
        node("a", { allowedAsRoot: true }),
        node("b", { allowedAsRoot: true }),
        node("mid"),
        node("shared"),
        node("deep"),
      ],
      [
        road("a", "mid"),
        road("mid", "deep"),
        road("b", "deep"),
        road("a", "shared"),
        road("b", "shared"),
      ]
    );
    const home = (alias: string) =>
      groups.find((group) => group.members.some((n) => n.alias === alias))
        ?.name;

    expect(home("shared")).toBe("a");
    expect(home("deep")).toBe("b");
  });

  it("puts a parent's small families in its neighbourhood and a deep child in its own", () => {
    const [site] = groupsOf(
      [
        node("site", { allowedAsRoot: true }),
        node("leaf"),
        node("section"),
        node("article"),
        node("hub"),
        node("sub"),
        node("subleaf"),
      ],
      [
        road("site", "leaf"),
        road("site", "section"),
        road("section", "article"),
        road("site", "hub"),
        road("hub", "sub"),
        road("sub", "subleaf"),
      ]
    );

    expect(site?.clusters).toEqual([
      { head: "site", families: [["leaf"], ["section", "article"]] },
      { head: "hub", families: [["sub", "subleaf"]] },
    ]);
  });

  it("heads a ring no root reaches with its alias-first member", () => {
    const groups = groupsOf(
      [node("x"), node("y"), node("loner"), node("alone")],
      [road("x", "y"), road("y", "x")]
    );
    const unreachable = groups.find((group) => group.id === "unreachable");

    expect(unreachable?.clusters).toEqual([
      { head: "x", families: [["y"]] },
      { head: null, families: [["alone"], ["loner"]] },
    ]);
  });

  it("groups Element Types by the block editor that offers them, one table each", () => {
    const groups = groupsOf([
      host("page", "grid", [
        ["hero", "content"],
        ["quote", "content"],
      ]),
      host("post", "body", [["quote", "content"]]),
      host("news", "body", [["quote", "content"]]),
      node("hero", { isElement: true }),
      node("quote", { isElement: true }),
      node("spare", { isElement: true }),
    ]);
    const elements = groups.find((group) => group.id === "elements");

    // Quote is offered by both editors and goes with body, which offers it twice.
    expect(elements?.clusters).toEqual([
      { head: null, families: [["hero"]] },
      { head: null, families: [["quote"]] },
      { head: null, families: [["spare"]] },
    ]);
    expect(elements?.sockets.get("quote")).toBe("body");
    expect(elements?.sockets.has("spare")).toBe(false);
  });
});

describe("socketsOf", () => {
  it("prefers the editor offering a type as content, then the name", () => {
    const card = node("card", { isElement: true });
    const sockets = socketsOf(
      [
        host("a", "zeta", [["card", "content"]]),
        host("b", "alpha", [["card", "settings"]]),
        host("c", "beta", [["card", "content"]]),
      ],
      [card]
    );

    expect(sockets.get("card")).toBe("beta");
  });
});

describe("cityDistricts by structure", () => {
  it("names the medium fixture's districts after its roots", () => {
    const { districts } = cityDistricts(medium);

    expect(districts.map((district) => district.name).sort()).toEqual([
      "Compositions",
      "Elements",
      "Microsite",
      "Settings",
      "Site",
      "Unreachable",
    ]);
  });

  it("places every node once, with no two sharing ground, on every fixture", () => {
    for (const graph of [medium, pathological]) {
      const { placements } = cityDistricts(graph);
      expect(new Set(placements.map((p) => p.id)).size).toBe(
        graph.nodes.length
      );
      for (let i = 0; i < placements.length; i++)
        for (let j = i + 1; j < placements.length; j++) {
          const a = placements[i] as Placement;
          const b = placements[j] as Placement;
          const reach = (a.footprint + b.footprint) / 2;
          expect(
            Math.abs(a.position.x - b.position.x) >= reach - 1e-9 ||
              Math.abs(a.position.z - b.position.z) >= reach - 1e-9
          ).toBe(true);
        }
    }
  });

  it("keeps two streets of void between any two districts", () => {
    const { districts } = cityDistricts(pathological);
    for (let i = 0; i < districts.length; i++)
      for (let j = i + 1; j < districts.length; j++) {
        const a = districts[i] as (typeof districts)[number];
        const b = districts[j] as (typeof districts)[number];
        const apart = Math.max(
          a.minX - b.maxX,
          b.minX - a.maxX,
          a.minZ - b.maxZ,
          b.minZ - a.maxZ
        );
        expect(apart).toBeGreaterThanOrEqual(DISTRICT_GAP - 1e-9);
      }
  });

  it("tints each Element Type by its block editor", () => {
    const { placements } = cityDistricts(medium);
    const tinted = placements.filter((p) => p.folder?.startsWith("socket/"));

    expect(tinted.length).toBeGreaterThan(0);
    expect(tinted.every((p) => p.district === "elements")).toBe(true);
    // No schema folder tints a structure board.
    expect(
      placements.filter((p) => p.folder && !p.folder.startsWith("socket/"))
    ).toEqual([]);
  });

  it("lays the pathological fixture out the same way twice, in well under a frame", () => {
    const started = performance.now();
    const once = cityDistricts(pathological);
    expect(performance.now() - started).toBeLessThan(100);
    expect(cityDistricts(pathological)).toEqual(once);
  });
});
