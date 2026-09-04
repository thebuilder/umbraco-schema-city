import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import pathologicalFixture from "../../../dev/fixtures/pathological.json";
import smallFixture from "../../../dev/fixtures/small.json";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../../model/types";
import { STAMP_BAND } from "../scene/stage";
import {
  cityBounds,
  cityDistricts,
  ISLAND_PAD,
  layoutCity,
  ROW_LIMIT,
  SPARSE_RANK,
  DISTRICT_GAP,
  STREET,
  type District,
  type Placement,
} from "./city";

const small = smallFixture as unknown as SchemaGraph;
const medium = mediumFixture as unknown as SchemaGraph;
const pathological = pathologicalFixture as unknown as SchemaGraph;
/** The same schema with nothing filed, which is what the role fallback is for. */
const folderless: SchemaGraph = {
  ...small,
  folders: [],
  nodes: small.nodes.map((node) => ({ ...node, folderId: null })),
};

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
  edges: SchemaEdge[] = [],
  folders: SchemaGraph["folders"] = []
): SchemaGraph => ({
  generatedAt: "2026-09-03T00:00:00Z",
  folders,
  nodes,
  edges,
});

const road = (from: string, to: string): SchemaEdge => ({
  kind: "allowedChild",
  from,
  to,
});

const districts = (placements: Placement[]) =>
  Object.fromEntries(placements.map((p) => [p.id, p.district]));

const summarise = (graph: SchemaGraph) => {
  const { placements, districts } = cityDistricts(graph);
  return districts.map((d) => ({
    name: d.name,
    kind: d.kind,
    size: placements.filter((p) => p.district === d.id).length,
  }));
};

/** Every pair of squares, checked as axis-aligned boxes on the ground. */
function overlaps(placements: Placement[]) {
  const found: string[] = [];
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i] as Placement;
      const b = placements[j] as Placement;
      const gapX =
        Math.abs(a.position.x - b.position.x) - (a.footprint + b.footprint) / 2;
      const gapZ =
        Math.abs(a.position.z - b.position.z) - (a.footprint + b.footprint) / 2;
      // A shared edge is not an overlap, so only a negative gap on both axes counts.
      if (gapX < -1e-9 && gapZ < -1e-9) found.push(`${a.id} over ${b.id}`);
    }
  }
  return found;
}

/**
 * The ranked block of each district, as its ranks in the order dagre gave them. A
 * rank is a district plus an intro delay, which is the only place the rank number
 * survives into the output; the packed grid is left out, because it is a street
 * below the block by design rather than a rank that failed to merge.
 */
function rankedBlocks(graph: SchemaGraph): Map<string, Placement[][]> {
  const placements = layoutCity(graph);
  const byId = new Map(placements.map((p) => [p.id, p]));
  const linked = new Set<string>();
  for (const edge of graph.edges ?? []) {
    if (edge.kind !== "allowedChild" || edge.from === edge.to) continue;
    if (byId.get(edge.from)?.district !== byId.get(edge.to)?.district) continue;
    if (!byId.has(edge.from)) continue;
    linked.add(edge.from).add(edge.to);
  }

  const blocks = new Map<string, Map<number, Placement[]>>();
  for (const placement of placements) {
    if (!linked.has(placement.id)) continue;
    const ranks =
      blocks.get(placement.district) ?? new Map<number, Placement[]>();
    blocks.set(placement.district, ranks);
    ranks.set(placement.introDelay, [
      ...(ranks.get(placement.introDelay) ?? []),
      placement,
    ]);
  }
  return new Map(
    [...blocks].map(([id, ranks]) => [
      id,
      [...ranks].sort((a, b) => a[0] - b[0]).map(([, members]) => members),
    ])
  );
}

/**
 * Sparse ranks that could have shared the band above them and did not. A rank of at
 * most `SPARSE_RANK` buildings merges into the open band while the band still fits a
 * row, so anything this finds is a band spent on ground no building stands on.
 *
 * Cycles are the one case that legitimately blocks a merge, and none of the fixtures
 * runs a back edge between two sparse ranks, so anything here is a real gap.
 */
function strandedRanks(graph: SchemaGraph): string[] {
  const found: string[] = [];
  for (const [district, ranks] of rankedBlocks(graph)) {
    let held = 0;
    let band = Number.NaN;
    for (const rank of ranks) {
      const z = (rank[0] as Placement).position.z;
      const sparse = rank.length <= SPARSE_RANK;
      if (sparse && held > 0 && held + rank.length <= ROW_LIMIT && z !== band) {
        found.push(`${district} rank at ${z} left out of the band at ${band}`);
      }
      held = sparse ? (z === band ? held : 0) + rank.length : 0;
      band = z;
    }
  }
  return found;
}

/** Pairs of districts closer than a street on both axes. */
function crowded(list: District[], street: number) {
  const found: string[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as District;
      const b = list[j] as District;
      const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX);
      const gapZ = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ);
      if (Math.max(gapX, gapZ) < street - 1e-9)
        found.push(`${a.name} near ${b.name}`);
    }
  }
  return found;
}

describe("cityDistricts", () => {
  it("returns nothing for a graph with no nodes", () => {
    expect(cityDistricts(graphOf([]))).toEqual({
      placements: [],
      districts: [],
    });
  });

  it("gives the medium fixture one district per top-level folder plus Unfiled", () => {
    expect(summarise(medium)).toEqual([
      { name: "Compositions", kind: "compositions", size: 7 },
      { name: "Pages", kind: "structure", size: 42 },
      { name: "Elements", kind: "elements", size: 15 },
      { name: "Unfiled", kind: "structure", size: 14 },
    ]);
  });

  it("names the district on every placement and carries its kind along", () => {
    const { placements, districts } = cityDistricts(medium);
    const kinds = new Map(districts.map((d) => [d.id, d.kind]));

    expect(placements).toHaveLength(78);
    for (const placement of placements) {
      expect(kinds.get(placement.district)).toBe(placement.districtKind);
    }
  });

  it("keeps a nested folder as a tint, not a district of its own", () => {
    const inner = { id: "inner", name: "Inner", parentId: "outer" };
    const outer = { id: "outer", name: "Outer", parentId: null };
    const { placements, districts } = cityDistricts(
      graphOf(
        [node("a", { folderId: "outer" }), node("b", { folderId: "inner" })],
        [],
        [outer, inner]
      )
    );

    expect(districts.map((d) => d.name)).toEqual(["Outer"]);
    expect(placements.map((p) => [p.district, p.folder])).toEqual([
      ["outer", undefined],
      ["outer", "inner"],
    ]);
  });

  it("files a type whose folder no longer exists under Unfiled", () => {
    const { districts } = cityDistricts(
      graphOf(
        [node("a", { folderId: "kept" }), node("b", { folderId: "deleted" })],
        [],
        [{ id: "kept", name: "Kept", parentId: null }]
      )
    );

    expect(districts.map((d) => d.name)).toEqual(["Kept", "Unfiled"]);
  });

  it("falls back to districts named by role when nothing is filed", () => {
    expect(summarise(folderless)).toEqual([
      { name: "Compositions", kind: "compositions", size: 1 },
      { name: "Pages", kind: "structure", size: 6 },
      { name: "Elements", kind: "elements", size: 3 },
      { name: "Unplaced", kind: "mixed", size: 2 },
    ]);
  });

  it("puts compositions north of the structure districts and elements south", () => {
    const { districts } = cityDistricts(folderless);
    const at = (name: string) =>
      districts.find((d) => d.name === name) as District;

    expect(at("Compositions").maxZ).toBeLessThan(at("Pages").minZ);
    expect(at("Elements").minZ).toBeGreaterThan(at("Pages").maxZ);
    expect(at("Unplaced").minX).toBeGreaterThan(at("Pages").maxX);
  });

  it("orders the middle row largest district first", () => {
    const graph = graphOf(
      [
        node("bigRoot", { allowedAsRoot: true, folderId: "big" }),
        node("bigChild", { folderId: "big" }),
        node("bigOther", { folderId: "big" }),
        node("smallRoot", { allowedAsRoot: true, folderId: "small" }),
      ],
      [road("bigRoot", "bigChild")],
      [
        { id: "big", name: "Big", parentId: null },
        { id: "small", name: "Small", parentId: null },
      ]
    );
    const { districts } = cityDistricts(graph);

    expect(districts.map((d) => d.name)).toEqual(["Big", "Small"]);
    expect((districts[0] as District).maxX).toBeLessThan(
      (districts[1] as District).minX
    );
  });

  it("leaves a void of two streets between any two districts", () => {
    expect(DISTRICT_GAP).toBe(STREET * 2);
    expect(crowded(cityDistricts(medium).districts, DISTRICT_GAP)).toEqual([]);
    expect(crowded(cityDistricts(folderless).districts, DISTRICT_GAP)).toEqual(
      []
    );
  });

  it("holds a band clear along each island's north edge for the name", () => {
    // The name is printed on the ground and writes no depth, so a row standing in
    // the band would draw over the letters.
    for (const graph of [small, medium, pathological]) {
      const { placements, districts } = cityDistricts(graph);
      const byId = new Map(districts.map((d) => [d.id, d]));
      for (const p of placements) {
        const island = (byId.get(p.district) as District).minZ - ISLAND_PAD;
        expect(p.position.z - p.footprint / 2).toBeGreaterThanOrEqual(
          island + STAMP_BAND - 1e-9
        );
      }
    }
  });

  it("keeps every building inside the bounds its district reports", () => {
    const { placements, districts } = cityDistricts(medium);
    const byId = new Map(districts.map((d) => [d.id, d]));

    for (const p of placements) {
      const d = byId.get(p.district) as District;
      expect(p.position.x - p.footprint / 2).toBeGreaterThanOrEqual(
        d.minX - 1e-9
      );
      expect(p.position.x + p.footprint / 2).toBeLessThanOrEqual(d.maxX + 1e-9);
      expect(p.position.z - p.footprint / 2).toBeGreaterThanOrEqual(
        d.minZ - 1e-9
      );
      expect(p.position.z + p.footprint / 2).toBeLessThanOrEqual(d.maxZ + 1e-9);
    }
  });
});

describe("layoutCity", () => {
  it("returns an empty array for a graph with no nodes", () => {
    expect(layoutCity(graphOf([]))).toEqual([]);
  });

  it("gives the same output for the same input twice", () => {
    expect(layoutCity(small)).toEqual(layoutCity(small));
  });

  it("ignores the order the nodes arrived in", () => {
    const shuffled = graphOf(
      [...small.nodes].reverse(),
      [...small.edges].reverse(),
      [...small.folders].reverse()
    );
    expect(layoutCity(shuffled)).toEqual(layoutCity(small));
  });

  it("places every node exactly once", () => {
    const placements = layoutCity(small);
    expect(placements.map((p) => p.id).sort()).toEqual(
      small.nodes.map((n) => n.id).sort()
    );
  });

  it("sorts a folderless schema by reachability from a root", () => {
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true }),
          node("child"),
          node("orphan"),
          node("block", { isElement: true }),
        ],
        [road("root", "child")]
      )
    );

    expect(districts(placements)).toEqual({
      root: "pages",
      child: "pages",
      orphan: "unplaced",
      block: "elements",
    });
  });

  it("keeps an element type out of the Pages district even when a root allows it", () => {
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true }),
          node("block", { isElement: true }),
        ],
        [road("root", "block")]
      )
    );

    expect(districts(placements)).toEqual({ root: "pages", block: "elements" });
  });

  it("ranks the small fixture's unfiled district into more than one row", () => {
    const unfiled = layoutCity(small).filter((p) => p.district === "unfiled");
    const rows = new Set(unfiled.map((p) => p.position.z));

    expect(unfiled.length).toBe(9);
    expect(rows.size).toBeGreaterThan(1);
  });

  it("packs a district with no allowed-child edge into one grid", () => {
    const placements = layoutCity(
      graphOf([node("b"), node("a"), node("c")], [], [])
    );

    expect(placements.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(new Set(placements.map((p) => p.position.z)).size).toBe(1);
  });

  it("packs the types with no structural edge below the ranked block", () => {
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true, folderId: "f" }),
          node("child", { folderId: "f" }),
          node("loner", { folderId: "f" }),
        ],
        [road("root", "child")],
        [{ id: "f", name: "F", parentId: null }]
      )
    );
    const at = (id: string) => placements.find((p) => p.id === id) as Placement;

    expect(at("loner").position.z).toBeGreaterThan(at("child").position.z);
    expect(at("loner").introDelay).toBeGreaterThan(at("child").introDelay);
  });

  it("folds a rank of 30 onto four rows of at most eight", () => {
    const children = Array.from(
      { length: 30 },
      (_, i) => `child${String(i).padStart(2, "0")}`
    );
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true }),
          ...children.map((alias) => node(alias)),
        ],
        children.map((alias) => road("root", alias))
      )
    );

    const rows = new Map<number, number>();
    for (const p of placements) {
      if (p.id === "root") continue;
      rows.set(p.position.z, (rows.get(p.position.z) ?? 0) + 1);
    }

    expect([...rows.values()].sort((a, b) => b - a)).toEqual([8, 8, 8, 6]);
    expect(overlaps(placements)).toEqual([]);
  });

  it("orders every rank in a district by the column its parents landed in", () => {
    const placements = layoutCity(medium);
    const byId = new Map(placements.map((p) => [p.id, p]));
    const parents = new Map<string, string[]>();
    for (const edge of medium.edges) {
      if (edge.kind !== "allowedChild" || edge.from === edge.to) continue;
      parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
    }
    // introDelay is the rank number times a fixed stagger, so a district plus a delay
    // is the only place the rank survives into the output.
    const ranks = new Map<string, Placement[]>();
    for (const p of placements) {
      const key = `${p.district}:${p.introDelay}`;
      ranks.set(key, [...(ranks.get(key) ?? []), p]);
    }

    let deepest = 0;
    for (const district of new Set(placements.map((p) => p.district))) {
      const ordered = [...ranks.keys()]
        .filter((key) => key.startsWith(`${district}:`))
        .sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
      deepest = Math.max(deepest, ordered.length);
      const placedBefore = new Set<string>();
      for (const key of ordered) {
        const rank = ranks.get(key) as Placement[];
        // Row-major order inside the rank: rows front to back, left to right in each.
        const inOrder = [...rank].sort(
          (a, b) => a.position.z - b.position.z || a.position.x - b.position.x
        );
        const column = (p: Placement) =>
          Math.min(
            Infinity,
            ...(parents.get(p.id) ?? [])
              .filter(
                (id) =>
                  placedBefore.has(id) && byId.get(id)?.district === district
              )
              .map((id) => (byId.get(id) as Placement).position.x)
          );
        const columns = inOrder.map(column);

        expect(columns).toEqual([...columns].sort((a, b) => a - b));
        for (const p of rank) placedBefore.add(p.id);
      }
    }
    expect(deepest).toBeGreaterThan(2);
  });

  it("gives every building in the medium fixture its own spot", () => {
    const placements = layoutCity(medium);
    const spots = placements.map((p) => `${p.position.x},${p.position.z}`);

    expect(new Set(spots).size).toBe(placements.length);
    expect(overlaps(placements)).toEqual([]);
  });

  it("never lays a district out wider than a row of eight", () => {
    // Unfolded, the medium fixture ranks its pages into a district 624 units across,
    // which frames as a diagonal line of buildings a couple of pixels tall. The row
    // limit is what bounds that, and a merged band is the widest a row ever gets,
    // because it holds a street between one rank's members and the next rank's.
    for (const graph of [small, medium, pathological]) {
      const { placements, districts } = cityDistricts(graph);
      for (const district of districts) {
        const mine = placements.filter((p) => p.district === district.id);
        const widest = Math.max(...mine.map((p) => p.footprint));
        expect(district.maxX - district.minX).toBeLessThanOrEqual(
          ROW_LIMIT * widest + (ROW_LIMIT - 1) * STREET
        );
      }
    }
  });

  it("stands consecutive sparse ranks side by side instead of giving each a band", () => {
    // A rank of one or two buildings costs a whole band plus the street under it, so
    // a twelve-deep chain of single types stretched the pathological fixture's Pages
    // folder to 61 by 229 units at eight percent fill.
    for (const graph of [small, medium, pathological]) {
      expect(strandedRanks(graph)).toEqual([]);
    }
  });

  it("keeps the rank a cycle runs back into out of the band", () => {
    // Dagre reverses the ring's back edge to rank it. Folding those three ranks side
    // by side would run that road right to left while the rest ran left to right.
    const three = [
      node("ringA", { allowedAsRoot: true }),
      node("ringB"),
      node("ringC"),
    ];
    const chain = [road("ringA", "ringB"), road("ringB", "ringC")];
    const at = (placements: Placement[], id: string) =>
      placements.find((p) => p.id === id) as Placement;

    const open = layoutCity(graphOf(three, chain));
    expect(new Set(open.map((p) => p.position.z)).size).toBe(1);

    const ring = layoutCity(graphOf(three, [...chain, road("ringC", "ringA")]));
    expect(at(ring, "ringC").position.z).toBeGreaterThan(
      at(ring, "ringA").position.z
    );
  });

  it("puts a chain of single types in one row, a street apart", () => {
    const chain = ["root", ...Array.from({ length: 6 }, (_, i) => `link${i}`)];
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true }),
          ...chain.slice(1).map((alias) => node(alias)),
        ],
        chain.slice(1).map((alias, i) => road(chain[i] as string, alias))
      )
    ).sort((a, b) => a.position.x - b.position.x);

    // Seven ranks of one building, in one band, in the order the chain runs.
    expect(new Set(placements.map((p) => p.position.z)).size).toBe(1);
    expect(placements.map((p) => p.id)).toEqual(chain);
    for (let i = 1; i < placements.length; i++) {
      const near = placements[i - 1] as Placement;
      const far = placements[i] as Placement;
      expect(
        far.position.x - near.position.x - (near.footprint + far.footprint) / 2
      ).toBeCloseTo(STREET);
    }
    expect(overlaps(placements)).toEqual([]);
  });

  it("folds the same way twice", () => {
    expect(layoutCity(medium)).toEqual(layoutCity(medium));
    expect(
      layoutCity(
        graphOf(
          [...medium.nodes].reverse(),
          [...medium.edges].reverse(),
          [...medium.folders].reverse()
        )
      )
    ).toEqual(layoutCity(medium));
  });

  it("ripples the intro outward from the roots", () => {
    const byId = new Map(layoutCity(small).map((p) => [p.id, p]));
    const alias = (name: string) =>
      byId.get(small.nodes.find((n) => n.alias === name)?.id ?? "");

    expect(alias("home")?.introDelay).toBe(0);
    expect(alias("articlePage")?.introDelay).toBeGreaterThan(0);
  });

  it("survives a type that allows itself as a child", () => {
    const graph = graphOf(
      [node("page", { allowedAsRoot: true })],
      [road("page", "page")]
    );

    expect(layoutCity(graph)).toHaveLength(1);
  });

  it("survives a two-node cycle", () => {
    const graph = graphOf(
      [node("a", { allowedAsRoot: true }), node("b")],
      [road("a", "b"), road("b", "a")]
    );

    expect(layoutCity(graph)).toHaveLength(2);
  });

  it("survives a folder that is its own parent", () => {
    const graph = graphOf(
      [node("a", { folderId: "loop" })],
      [],
      [{ id: "loop", name: "Loop", parentId: "loop" }]
    );

    expect(layoutCity(graph)).toHaveLength(1);
  });

  it("drops an edge pointing at a type that no longer exists", () => {
    const graph = graphOf(
      [node("a", { allowedAsRoot: true })],
      [road("a", "ghost")]
    );

    expect(layoutCity(graph)).toHaveLength(1);
  });

  it("sizes a building from its own properties and its groups", () => {
    const group = {
      id: "g",
      alias: "g",
      name: "g",
      type: "Group" as const,
      parentAlias: null,
      fromCompositionId: null,
      properties: [],
    };
    const [wide, capped] = layoutCity(
      graphOf([
        node("a", { ownPropertyCount: 4, groups: [group, group] }),
        node("b", { ownPropertyCount: 40 }),
      ])
    ) as [Placement, Placement];

    expect(wide.footprint).toBe(3);
    expect(wide.floors).toBe(2);
    expect(wide.height).toBeCloseTo(1.2);
    expect(capped.footprint).toBe(5);
    expect(capped.floors).toBe(1);
  });

  it("leaves one and a half footprints between two buildings in a row", () => {
    const placements = layoutCity(
      graphOf(
        [node("root", { allowedAsRoot: true }), node("a"), node("b")],
        [road("root", "a"), road("root", "b")]
      )
    );
    const [a, b] = placements
      .filter((p) => p.id !== "root")
      .sort((one, other) => one.position.x - other.position.x) as [
      Placement,
      Placement,
    ];

    expect(
      b.position.x - a.position.x - (a.footprint + b.footprint) / 2
    ).toBeCloseTo(3);
  });

  it("leaves a street between a district's ranked block and its packed grid", () => {
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true, folderId: "f" }),
          node("child", { folderId: "f" }),
          node("loner", { folderId: "f" }),
        ],
        [road("root", "child")],
        [{ id: "f", name: "F", parentId: null }]
      )
    );
    const at = (id: string) => placements.find((p) => p.id === id) as Placement;
    const gap =
      at("loner").position.z -
      at("child").position.z -
      (at("loner").footprint + at("child").footprint) / 2;

    expect(gap).toBeGreaterThanOrEqual(STREET);
  });

  it("never overlaps two footprints", () => {
    expect(overlaps(layoutCity(small))).toEqual([]);
  });

  it("frames the whole city in its bounds", () => {
    const placements = layoutCity(small);
    const bounds = cityBounds(placements);

    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.depth).toBeGreaterThan(0);
    for (const p of placements) {
      expect(Math.abs(p.position.x - bounds.centre.x)).toBeLessThanOrEqual(
        bounds.width / 2
      );
      expect(Math.abs(p.position.z - bounds.centre.z)).toBeLessThanOrEqual(
        bounds.depth / 2
      );
    }
  });

  it("lays out 300 nodes in under 200 ms without overlapping", () => {
    const nodes: SchemaNode[] = [];
    const edges: SchemaEdge[] = [];
    for (let i = 0; i < 300; i++) {
      const alias = `type${String(i).padStart(3, "0")}`;
      nodes.push(
        node(alias, {
          allowedAsRoot: i < 3,
          isElement: i >= 240 && i < 280,
          ownPropertyCount: i % 17,
        })
      );
    }
    // A wide tree over the first 240, so most of them reach a root, plus a handful of
    // back edges so the graph is not acyclic. Dagre's network-simplex ranker slows
    // sharply as overlapping cycles grow (measured: ~1.6s at one back edge per node,
    // ~30ms at one per twenty), and a real allowed-child graph is never that tangled.
    for (let i = 0; i < 240; i++) {
      for (const child of [i * 3 + 3, i * 3 + 4, i * 3 + 5]) {
        if (child < 240)
          edges.push(
            road(
              `type${String(i).padStart(3, "0")}`,
              `type${String(child).padStart(3, "0")}`
            )
          );
      }
      if (i > 20 && i % 20 === 0)
        edges.push(
          road(
            `type${String(i).padStart(3, "0")}`,
            `type${String(i - 20).padStart(3, "0")}`
          )
        );
    }

    const graph = graphOf(nodes, edges);
    const started = performance.now();
    const placements = layoutCity(graph);
    const elapsed = performance.now() - started;

    expect(placements).toHaveLength(300);
    expect(overlaps(placements)).toEqual([]);
    expect(elapsed).toBeLessThan(200);
    console.log(`300 nodes laid out in ${elapsed.toFixed(1)} ms`);
  });

  // The stress case the plan has promised since M0: 300 types, six folders of very
  // unequal size, two cycles, a 60-child hub, a 12-parent child and 15 orphans.
  // dev/make-pathological.mjs writes it and prints what it planted.
  it("lays the pathological fixture out in under 200 ms, once per node and with room between the districts", () => {
    const started = performance.now();
    const { placements, districts } = cityDistricts(pathological);
    const elapsed = performance.now() - started;

    expect(placements).toHaveLength(300);
    expect(new Set(placements.map((p) => p.id)).size).toBe(300);
    expect(overlaps(placements)).toEqual([]);
    expect(crowded(districts, DISTRICT_GAP)).toEqual([]);
    expect(elapsed).toBeLessThan(200);

    // The Pages folder holds the twelve-deep chain of single types. Before those
    // ranks shared a band it came out 61 by 229, framed at eight percent fill.
    const pages = districts.find((d) => d.name === "Pages") as District;
    const width = pages.maxX - pages.minX;
    const depth = pages.maxZ - pages.minZ;
    expect(Math.max(width, depth) / Math.min(width, depth)).toBeLessThan(2);
    console.log(
      `pathological: 300 nodes laid out in ${elapsed.toFixed(1)} ms, Pages ${width.toFixed(0)} by ${depth.toFixed(0)}`
    );
  });
});
