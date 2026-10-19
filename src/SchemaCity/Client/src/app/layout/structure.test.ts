import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import pathologicalFixture from "../../../dev/fixtures/pathological.json";
import type {
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
} from "../../model/types";
import { socketNameWidth } from "../scene/stage";
import {
  cityDistricts,
  DISTRICT_GAP,
  type District,
  ISLAND_PAD,
  type Placement,
  SOCKET,
  socketPatch,
} from "./city";
import { editorNames, socketsOf, structureGroups } from "./structure";

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

describe("editorNames", () => {
  it("names every block editor that offers an Element Type, and no other", () => {
    const unnamed = host("c", "plain", [["card", "content"]]);
    const property = unnamed.groups[0]?.properties[0] as SchemaProperty;
    property.dataTypeName = null;
    const names = editorNames([
      host("a", "grid", [["card", "content"]]),
      host("b", "list", [["page", "content"]]),
      unnamed,
      node("card", { isElement: true }),
      node("page"),
    ]);

    expect([...names]).toEqual([["grid", "grid"]]);
  });
});

describe("socket patches", () => {
  /** Each socket's patch on a fixture, as a box, with the ids of its types. */
  function patchesOf(graph: SchemaGraph) {
    const { placements } = cityDistricts(graph);
    const names = editorNames(graph.nodes);
    const bySocket = new Map<string, Placement[]>();
    for (const placement of placements) {
      if (!placement.folder?.startsWith(SOCKET)) continue;
      const held = bySocket.get(placement.folder) ?? [];
      held.push(placement);
      bySocket.set(placement.folder, held);
    }
    return {
      placements,
      patches: [...bySocket].map(([id, held]) => {
        const name = names.get(id.slice(SOCKET.length)) as string;
        const { centre, width, depth } = socketPatch(held, name, 1);
        return {
          id,
          name,
          members: new Set(held.map((placement) => placement.id)),
          minX: centre.x - width / 2,
          maxX: centre.x + width / 2,
          minZ: centre.z - depth / 2,
          maxZ: centre.z + depth / 2,
        };
      }),
    };
  }

  type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
  const apart = (a: Box, b: Box) =>
    a.maxX <= b.minX ||
    a.minX >= b.maxX ||
    a.maxZ <= b.minZ ||
    a.minZ >= b.maxZ;
  const ground = ({ position, footprint }: Placement): Box => ({
    minX: position.x - footprint / 2,
    maxX: position.x + footprint / 2,
    minZ: position.z - footprint / 2,
    maxZ: position.z + footprint / 2,
  });

  it("covers only its own types, never another socket's patch, on every fixture", () => {
    for (const graph of [medium, pathological]) {
      const { placements, patches } = patchesOf(graph);
      expect(patches.length).toBeGreaterThan(1);
      for (const patch of patches) {
        expect(patch.maxX - patch.minX).toBeGreaterThanOrEqual(
          socketNameWidth(patch.name)
        );
        const others = placements.filter((one) => !patch.members.has(one.id));
        expect(others.every((one) => apart(ground(one), patch))).toBe(true);
        const rest = patches.filter((other) => other !== patch);
        expect(rest.every((other) => apart(other, patch))).toBe(true);
      }
    }
  });

  it("keeps every patch on its board, on every fixture", () => {
    for (const graph of [medium, pathological]) {
      const { districts } = cityDistricts(graph);
      const { placements, patches } = patchesOf(graph);
      for (const patch of patches) {
        const member = placements.find((one) => patch.members.has(one.id));
        const board = districts.find(
          (district) => district.id === member?.district
        ) as District;
        expect(patch.minX).toBeGreaterThanOrEqual(board.minX - ISLAND_PAD);
        expect(patch.maxX).toBeLessThanOrEqual(board.maxX + ISLAND_PAD);
        expect(patch.minZ).toBeGreaterThanOrEqual(board.minZ - ISLAND_PAD);
        expect(patch.maxZ).toBeLessThanOrEqual(board.maxZ + ISLAND_PAD);
      }
    }
  });

  it("gives a socket of one type a patch wide enough for the editor's name", () => {
    const { patches } = patchesOf(medium);
    const single = patches.find((patch) => patch.members.size === 1);

    expect(single?.name).toBeDefined();
    expect((single?.maxX ?? 0) - (single?.minX ?? 0)).toBeGreaterThan(
      socketNameWidth(single?.name ?? "")
    );
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
