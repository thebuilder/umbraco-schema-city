import { describe, expect, it } from "vitest";
import smallFixture from "../../../dev/fixtures/small.json";
import type { SchemaEdge, SchemaGraph, SchemaNode } from "../../model/types";
import { cityBounds, layoutCity, type Placement } from "./city";

const small = smallFixture as unknown as SchemaGraph;

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

const road = (from: string, to: string): SchemaEdge => ({
  kind: "allowedChild",
  from,
  to,
});

const districts = (placements: Placement[]) =>
  Object.fromEntries(placements.map((p) => [p.id, p.district]));

/** Every pair of squares, checked as axis-aligned boxes on the ground. */
function overlaps(placements: Placement[]) {
  const found: string[] = [];
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i] as Placement;
      const b = placements[j] as Placement;
      const gapX = Math.abs(a.position.x - b.position.x) - (a.footprint + b.footprint) / 2;
      const gapZ = Math.abs(a.position.z - b.position.z) - (a.footprint + b.footprint) / 2;
      // A shared edge is not an overlap, so only a negative gap on both axes counts.
      if (gapX < -1e-9 && gapZ < -1e-9) found.push(`${a.id} over ${b.id}`);
    }
  }
  return found;
}

describe("layoutCity", () => {
  it("returns an empty array for a graph with no nodes", () => {
    expect(layoutCity(graphOf([]))).toEqual([]);
  });

  it("gives the same output for the same input twice", () => {
    expect(layoutCity(small)).toEqual(layoutCity(small));
  });

  it("ignores the order the nodes arrived in", () => {
    const shuffled = graphOf([...small.nodes].reverse(), [...small.edges].reverse());
    expect(layoutCity(shuffled)).toEqual(layoutCity(small));
  });

  it("places every node exactly once", () => {
    const placements = layoutCity(small);
    expect(placements.map((p) => p.id).sort()).toEqual(
      small.nodes.map((n) => n.id).sort(),
    );
  });

  it("sorts the districts by reachability from a root", () => {
    const placements = layoutCity(
      graphOf(
        [
          node("root", { allowedAsRoot: true }),
          node("child"),
          node("orphan"),
          node("block", { isElement: true }),
        ],
        [road("root", "child")],
      ),
    );

    expect(districts(placements)).toEqual({
      root: "structure",
      child: "structure",
      orphan: "detached",
      block: "element",
    });
  });

  it("keeps an element type out of the structure district even when a root allows it", () => {
    const placements = layoutCity(
      graphOf(
        [node("root", { allowedAsRoot: true }), node("block", { isElement: true })],
        [road("root", "block")],
      ),
    );

    expect(districts(placements)).toEqual({ root: "structure", block: "element" });
  });

  it("ranks the small fixture into more than one row", () => {
    const structure = layoutCity(small).filter((p) => p.district === "structure");
    const rows = new Set(structure.map((p) => p.position.z));

    expect(structure.length).toBe(6);
    expect(rows.size).toBeGreaterThan(1);
  });

  it("ripples the intro outward from the roots", () => {
    const byId = new Map(layoutCity(small).map((p) => [p.id, p]));
    const alias = (name: string) =>
      byId.get(small.nodes.find((n) => n.alias === name)?.id ?? "");

    expect(alias("home")?.introDelay).toBe(0);
    expect(alias("articlePage")?.introDelay).toBeGreaterThan(0);
  });

  it("survives a type that allows itself as a child", () => {
    const graph = graphOf([node("page", { allowedAsRoot: true })], [road("page", "page")]);

    expect(layoutCity(graph)).toHaveLength(1);
  });

  it("survives a two-node cycle", () => {
    const graph = graphOf(
      [node("a", { allowedAsRoot: true }), node("b")],
      [road("a", "b"), road("b", "a")],
    );

    expect(layoutCity(graph)).toHaveLength(2);
  });

  it("drops an edge pointing at a type that no longer exists", () => {
    const graph = graphOf([node("a", { allowedAsRoot: true })], [road("a", "ghost")]);

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
      ]),
    ) as [Placement, Placement];

    expect(wide.footprint).toBe(3);
    expect(wide.floors).toBe(2);
    expect(wide.height).toBeCloseTo(1.2);
    expect(capped.footprint).toBe(5);
    expect(capped.floors).toBe(1);
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
        bounds.width / 2,
      );
      expect(Math.abs(p.position.z - bounds.centre.z)).toBeLessThanOrEqual(
        bounds.depth / 2,
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
        }),
      );
    }
    // A wide tree over the first 240, so most of them reach a root, plus a handful of
    // back edges so the graph is not acyclic. Dagre's network-simplex ranker slows
    // sharply as overlapping cycles grow (measured: ~1.6s at one back edge per node,
    // ~30ms at one per twenty), and a real allowed-child graph is never that tangled.
    for (let i = 0; i < 240; i++) {
      for (const child of [i * 3 + 3, i * 3 + 4, i * 3 + 5]) {
        if (child < 240) edges.push(road(`type${String(i).padStart(3, "0")}`, `type${String(child).padStart(3, "0")}`));
      }
      if (i > 20 && i % 20 === 0) edges.push(road(`type${String(i).padStart(3, "0")}`, `type${String(i - 20).padStart(3, "0")}`));
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
});
