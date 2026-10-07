import { describe, expect, it } from "vitest";
import {
  type Cluster,
  type Item,
  layoutNeighbourhoods,
  type Spacing,
  type Spot,
} from "./neighbourhoods";

const SPACING: Spacing = {
  gap: 1.5,
  familyGap: 2.5,
  rowGap: 2.5,
  laneGap: 4,
  street: 6,
  rowLimit: 8,
};

const item = (id: string, size = 4): Item => ({ id, size });
const family = (...ids: string[]) => ids.map((id) => item(id));

/** Every pair of squares that share ground. */
function overlaps(spots: Map<string, Spot>, sizes: Map<string, number>) {
  const found: string[] = [];
  const all = [...spots];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [a, sa] = all[i] as [string, Spot];
      const [b, sb] = all[j] as [string, Spot];
      const reach = ((sizes.get(a) ?? 0) + (sizes.get(b) ?? 0)) / 2;
      if (
        Math.abs(sa.x - sb.x) < reach - 1e-9 &&
        Math.abs(sa.z - sb.z) < reach - 1e-9
      )
        found.push(`${a} over ${b}`);
    }
  return found;
}

const sizesOf = (clusters: Cluster[]) =>
  new Map(
    clusters.flatMap((cluster) =>
      [cluster.head, ...cluster.families.flat()].flatMap((one) =>
        one ? [[one.id, one.size] as const] : []
      )
    )
  );

/** A parent of `n` single children, and `count` such parents. */
const parents = (count: number, n: number): Cluster[] =>
  Array.from({ length: count }, (_, p) => ({
    head: item(`p${p}`, 3.2 + (p % 3)),
    families: Array.from({ length: n }, (_, c) =>
      family(`p${p}c${c}`, ...(c % 2 === 0 ? [`p${p}c${c}g`] : []))
    ),
  }));

describe("layoutNeighbourhoods", () => {
  it("places nothing for no clusters", () => {
    expect(layoutNeighbourhoods([], SPACING).size).toBe(0);
  });

  it("stands the head on its own row above its families, centred over them", () => {
    const spots = layoutNeighbourhoods(
      [{ head: item("p"), families: [family("a"), family("b")] }],
      SPACING
    );
    const p = spots.get("p") as Spot;
    const a = spots.get("a") as Spot;
    const b = spots.get("b") as Spot;

    expect(a.z).toBe(b.z);
    expect(a.z - p.z).toBeCloseTo(4 + SPACING.rowGap);
    expect((a.x + b.x) / 2).toBeCloseTo(p.x);
  });

  it("keeps a family in one row, a gap apart, and two families a wider gap apart", () => {
    const spots = layoutNeighbourhoods(
      [{ head: null, families: [family("a", "a1"), family("b")] }],
      SPACING
    );
    const x = (id: string) => (spots.get(id) as Spot).x;

    expect(x("a1") - x("a") - 4).toBeCloseTo(SPACING.gap);
    expect(x("b") - x("a1") - 4).toBeCloseTo(SPACING.familyGap);
  });

  it("never shares ground, however the clusters fold and stack", () => {
    const clusters = [...parents(9, 7), ...parents(3, 1), ...parents(2, 20)];
    const spots = layoutNeighbourhoods(clusters, SPACING);

    expect(spots.size).toBe(sizesOf(clusters).size);
    expect(overlaps(spots, sizesOf(clusters))).toEqual([]);
  });

  it("lines every row up across a shelf, so the streets between rows run through", () => {
    const clusters = parents(6, 5);
    const spots = layoutNeighbourhoods(clusters, SPACING);
    const sizes = sizesOf(clusters);
    // Buildings on one row share its band of z; a band never straddles another.
    const bands = new Map<number, [number, number]>();
    for (const [id, spot] of spots) {
      const half = (sizes.get(id) as number) / 2;
      const band = bands.get(spot.row) ?? [spot.z - half, spot.z + half];
      bands.set(spot.row, [
        Math.min(band[0], spot.z - half),
        Math.max(band[1], spot.z + half),
      ]);
    }
    const sorted = [...bands.values()].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) {
      const [, aboveEnd] = sorted[i - 1] as [number, number];
      const [belowStart] = sorted[i] as [number, number];
      expect(belowStart - aboveEnd).toBeGreaterThanOrEqual(
        SPACING.rowGap - 1e-9
      );
    }
  });

  it("leaves a lane between two neighbourhoods side by side", () => {
    const spots = layoutNeighbourhoods(
      [
        { head: item("p"), families: [family("a")] },
        { head: item("q"), families: [family("b")] },
      ],
      SPACING
    );
    const p = spots.get("p") as Spot;
    const q = spots.get("q") as Spot;

    expect(p.z).toBe(q.z);
    expect(Math.abs(q.x - p.x) - 4).toBeGreaterThanOrEqual(SPACING.laneGap);
  });

  it("aims for a board wider than it is deep", () => {
    const clusters = parents(12, 4);
    const spots = [...layoutNeighbourhoods(clusters, SPACING).values()];
    const width =
      Math.max(...spots.map((s) => s.x)) - Math.min(...spots.map((s) => s.x));
    const depth =
      Math.max(...spots.map((s) => s.z)) - Math.min(...spots.map((s) => s.z));

    expect(width).toBeGreaterThan(depth);
  });

  it("lays the same clusters out the same way twice", () => {
    const clusters = parents(7, 3);

    expect(layoutNeighbourhoods(clusters, SPACING)).toEqual(
      layoutNeighbourhoods(clusters, SPACING)
    );
  });
});
