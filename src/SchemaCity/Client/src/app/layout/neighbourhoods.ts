// Packs neighbourhoods onto one board. Pure: no three.js, no React, no DOM.
//
// A neighbourhood is a parent with its allowed children below it, or a table of
// types with no parent among them, such as the Element Types one block editor
// offers. Inside one the buildings stand a gap apart; between two of them runs a
// wider lane, and between two shelves of them a street, so the structure traces
// stay inside their neighbourhood and the streets carry what leaves it.

/** One building to place: its id and the side of its footprint. */
export type Item = { id: string; size: number };

/**
 * A neighbourhood before it is placed. `head` stands alone on the first row, centred
 * over the rest. Each family is a child followed by its own children, laid side by
 * side in one row, so a child's road to its children runs a few units along the
 * street under them. A cluster with no head is a table of families of one.
 */
export type Cluster = { head: Item | null; families: Item[][] };

export type Spacing = {
  /** Ground between two buildings of one family, side by side. */
  gap: number;
  /** Ground between two families in one row. */
  familyGap: number;
  /** Ground between two rows, which holds the printed names as well. */
  rowGap: number;
  /** Ground between two neighbourhoods side by side. */
  laneGap: number;
  /** Ground between two shelves of neighbourhoods. */
  street: number;
  /** The most buildings one row of a neighbourhood holds. */
  rowLimit: number;
};

/** Where one building stands, and the row it stands in, counted down the board. */
export type Spot = { x: number; z: number; row: number };

/**
 * How much wider than deep a neighbourhood's rows aim to be, because the default
 * camera looks along the board's diagonal and a deep cluster frames as a tower.
 */
const CLUSTER_ASPECT = 1.4;

/** A cluster laid out in its own frame: x centred on 0, rows counted from 0. */
type Laid = {
  width: number;
  /** Per row, the buildings in it and their x. */
  rows: { item: Item; x: number }[][];
};

/**
 * Families fill rows of about the square root of the cluster's buildings, never
 * past `rowLimit` and never splitting a family, each row centred under the head.
 */
function layCluster(cluster: Cluster, spacing: Spacing): Laid {
  const cells = cluster.families.reduce(
    (sum, family) => sum + family.length,
    0
  );
  const longest = Math.max(
    0,
    ...cluster.families.map((family) => family.length)
  );
  const capacity = Math.max(
    longest,
    Math.min(spacing.rowLimit, Math.ceil(Math.sqrt(cells * CLUSTER_ASPECT)))
  );

  const rows: Item[][][] = [];
  let held = Number.POSITIVE_INFINITY;
  for (const family of cluster.families) {
    if (held + family.length > capacity) {
      rows.push([family]);
      held = family.length;
    } else {
      (rows[rows.length - 1] as Item[][]).push(family);
      held += family.length;
    }
  }

  const laid = rows.map((row) => {
    const width =
      row.reduce(
        (sum, family) =>
          sum +
          family.reduce((inner, item) => inner + item.size, 0) +
          spacing.gap * (family.length - 1),
        0
      ) +
      spacing.familyGap * (row.length - 1);
    const placed: { item: Item; x: number }[] = [];
    let left = -width / 2;
    for (const family of row) {
      for (const item of family) {
        placed.push({ item, x: left + item.size / 2 });
        left += item.size + spacing.gap;
      }
      left += spacing.familyGap - spacing.gap;
    }
    return { width, placed };
  });

  const head = cluster.head ? [[{ item: cluster.head, x: 0 }]] : [];
  return {
    width: Math.max(cluster.head?.size ?? 0, ...laid.map((row) => row.width)),
    rows: [...head, ...laid.map((row) => row.placed)],
  };
}

/** A column of a shelf: the clusters stacked in it, west edge first. */
type Stack = { left: number; width: number; next: number };
type Shelf = {
  stacks: Stack[];
  /** Each cluster with the stack it stands in and the shelf row it starts on. */
  held: { laid: Laid; stack: Stack; row: number }[];
  rows: number;
  used: number;
};

/**
 * Clusters onto shelves no wider than `limit`, first fit: under a cluster already on
 * the open shelf when it fits that cluster's width and the shelf's rows, else to the
 * east of the shelf, else on a new shelf.
 */
function shelve(laid: readonly Laid[], limit: number, spacing: Spacing) {
  const shelves: Shelf[] = [];
  for (const one of laid) {
    const shelf = shelves[shelves.length - 1];
    const under = shelf?.stacks.find(
      (open) =>
        one.width <= open.width + 1e-9 &&
        open.next + one.rows.length <= shelf.rows
    );
    if (shelf && under) {
      shelf.held.push({ laid: one, stack: under, row: under.next });
      under.next += one.rows.length;
      continue;
    }
    const wider = (shelf?.used ?? 0) + spacing.laneGap + one.width;
    if (shelf && wider <= limit + 1e-9) {
      const stack = {
        left: wider - one.width,
        width: one.width,
        next: one.rows.length,
      };
      shelf.stacks.push(stack);
      shelf.held.push({ laid: one, stack, row: 0 });
      shelf.rows = Math.max(shelf.rows, one.rows.length);
      shelf.used = wider;
      continue;
    }
    const stack = { left: 0, width: one.width, next: one.rows.length };
    shelves.push({
      stacks: [stack],
      held: [{ laid: one, stack, row: 0 }],
      rows: one.rows.length,
      used: one.width,
    });
  }
  return shelves;
}

/**
 * Where each shelf's rows fall, top to bottom, and the board's size. A row boundary
 * where a cluster starts under another is a lane wider than the rest.
 */
function measureShelves(shelves: readonly Shelf[], spacing: Spacing) {
  let top = 0;
  const laidOut = shelves.map((shelf) => {
    const depths = new Array<number>(shelf.rows).fill(0);
    const starts = new Set<number>();
    for (const { laid: one, row } of shelf.held) {
      if (row > 0) starts.add(row);
      one.rows.forEach((members, r) => {
        for (const { item } of members)
          depths[row + r] = Math.max(depths[row + r] as number, item.size);
      });
    }
    const tops: number[] = [];
    let z = top;
    depths.forEach((depth, r) => {
      if (starts.has(r)) z += spacing.laneGap - spacing.gap;
      tops.push(z);
      z += depth + spacing.rowGap;
    });
    top = z - spacing.rowGap + spacing.street;
    return { shelf, depths, tops };
  });
  return {
    laidOut,
    width: Math.max(...shelves.map((shelf) => shelf.used)),
    depth: top - spacing.street,
  };
}

/** The board aspect, width over depth, the shelf width is chosen toward. */
const TARGET_ASPECT = 1.6;
/** How many shelf widths are tried between the widest cluster and one long shelf. */
const TRIES = 16;

/**
 * Places every cluster on one board, centred on x = 0 with the first shelf's top
 * at z = 0. Clusters fill shelves west to east in the order given, which keeps a
 * parent's neighbourhood beside the neighbourhoods of its children. A cluster that
 * fits under one already on the shelf, inside the rows the shelf has, stands there
 * instead, so a short neighbourhood beside a tall one does not leave the ground
 * under it empty.
 *
 * The shelf width is whichever of a few between the widest cluster and a single
 * shelf gives the smallest board, counting a board far from a landscape aspect as
 * larger than it is, because the default camera frames it with empty ground around.
 *
 * Every cluster on a shelf shares the shelf's rows: row `r` is as deep as the deepest
 * building any cluster stands in its row `r`. The roads read rows and streets off the
 * buildings, so rows that lined up only inside each cluster would merge into one
 * band across the shelf and leave no street for a trace to run along. Where a
 * cluster starts under another, that row boundary is a lane wider, so the two read
 * as two neighbourhoods.
 *
 * ponytail: first fit in tree order, tried at sixteen widths. A packer that sorted
 * by height would fill the board tighter and scatter each family across it, which
 * costs the short traces this layout is for.
 */
export function layoutNeighbourhoods(
  clusters: readonly Cluster[],
  spacing: Spacing
): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  const laid = clusters
    .filter((cluster) => cluster.head || cluster.families.length > 0)
    .map((cluster) => layCluster(cluster, spacing));
  if (laid.length === 0) return spots;

  const narrowest = Math.max(...laid.map((one) => one.width));
  const widest =
    laid.reduce((sum, one) => sum + one.width, 0) +
    spacing.laneGap * (laid.length - 1);
  let best: ReturnType<typeof measureShelves> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= TRIES; i++) {
    const limit = narrowest + ((widest - narrowest) * i) / TRIES;
    const board = measureShelves(shelve(laid, limit, spacing), spacing);
    const aspect = board.width / Math.max(board.depth, 1e-9);
    const score =
      board.width *
      board.depth *
      (1 + Math.abs(Math.log(aspect / TARGET_ASPECT)) / 2);
    if (score < bestScore - 1e-9) {
      best = board;
      bestScore = score;
    }
  }

  let rowBase = 0;
  for (const { shelf, depths, tops } of (
    best as ReturnType<typeof measureShelves>
  ).laidOut) {
    for (const { laid: one, stack, row } of shelf.held) {
      const centre = stack.left + stack.width / 2 - shelf.used / 2;
      one.rows.forEach((members, r) => {
        for (const { item, x } of members)
          spots.set(item.id, {
            x: centre + x,
            z: (tops[row + r] as number) + (depths[row + r] as number) / 2,
            row: rowBase + row + r,
          });
      });
    }
    rowBase += shelf.rows;
  }
  return spots;
}
