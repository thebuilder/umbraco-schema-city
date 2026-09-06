import type { FloorCell } from "./buildings";

/** The short boot sequence that makes the city read as a computer board. */
export type RevealProgress = {
  trace: number;
  wireframe: number;
  districts: number;
  links: number;
};

export type OutlineBox = {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
};

/** One merged outer box per building, so stacked floors do not redraw each edge. */
export function buildBuildingOutlinePositions(
  cells: readonly FloorCell[]
): Float32Array {
  const bounds = new Map<
    string,
    {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      minZ: number;
      maxZ: number;
    }
  >();
  for (const cell of cells) {
    const current = bounds.get(cell.buildingId);
    const next = {
      minX: cell.cx - cell.sx / 2,
      maxX: cell.cx + cell.sx / 2,
      minY: cell.cy - cell.sy / 2,
      maxY: cell.cy + cell.sy / 2,
      minZ: cell.cz - cell.sz / 2,
      maxZ: cell.cz + cell.sz / 2,
    };
    if (current) {
      current.minX = Math.min(current.minX, next.minX);
      current.maxX = Math.max(current.maxX, next.maxX);
      current.minY = Math.min(current.minY, next.minY);
      current.maxY = Math.max(current.maxY, next.maxY);
      current.minZ = Math.min(current.minZ, next.minZ);
      current.maxZ = Math.max(current.maxZ, next.maxZ);
    } else bounds.set(cell.buildingId, next);
  }
  return buildOutlinePositions(
    [...bounds.values()].map((box) => ({
      x: (box.minX + box.maxX) / 2,
      y: box.minY,
      z: (box.minZ + box.maxZ) / 2,
      width: box.maxX - box.minX,
      height: box.maxY - box.minY,
      depth: box.maxZ - box.minZ,
    }))
  );
}

/** Boards only need their top rim; drawing their underside doubles the outline. */
export function buildBoardOutlinePositions(
  boxes: readonly OutlineBox[]
): Float32Array {
  const positions: number[] = [];
  for (const box of boxes) {
    const x0 = box.x - box.width / 2;
    const x1 = box.x + box.width / 2;
    const y = box.y + box.height;
    const z0 = box.z - box.depth / 2;
    const z1 = box.z + box.depth / 2;
    positions.push(
      x0,
      y,
      z0,
      x1,
      y,
      z0,
      x1,
      y,
      z0,
      x1,
      y,
      z1,
      x1,
      y,
      z1,
      x0,
      y,
      z1,
      x0,
      y,
      z1,
      x0,
      y,
      z0
    );
  }
  return new Float32Array(positions);
}

/** Copy an outline into a destination buffer with a length-based progressive stroke. */
export function traceOutlinePositions(
  source: Float32Array,
  target: Float32Array,
  progress: number
): number {
  const segmentCount = Math.floor(source.length / 6);
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped === 0) return 0;
  if (clamped === 1) {
    target.set(source);
    return segmentCount * 2;
  }
  let total = 0;
  for (let segment = 0; segment < segmentCount; segment++) {
    const offset = segment * 6;
    const dx = source[offset + 3] - source[offset];
    const dy = source[offset + 4] - source[offset + 1];
    const dz = source[offset + 5] - source[offset + 2];
    const length = Math.hypot(dx, dy, dz);
    total += length;
  }
  const distance = total * clamped;
  let travelled = 0;
  let vertices = 0;
  for (let segment = 0; segment < segmentCount; segment++) {
    const offset = segment * 6;
    const length = Math.hypot(
      source[offset + 3] - source[offset],
      source[offset + 4] - source[offset + 1],
      source[offset + 5] - source[offset + 2]
    );
    if (travelled >= distance) break;
    target[offset] = source[offset];
    target[offset + 1] = source[offset + 1];
    target[offset + 2] = source[offset + 2];
    const amount = Math.min(1, (distance - travelled) / (length || 1));
    target[offset + 3] =
      source[offset] + (source[offset + 3] - source[offset]) * amount;
    target[offset + 4] =
      source[offset + 1] + (source[offset + 4] - source[offset + 1]) * amount;
    target[offset + 5] =
      source[offset + 2] + (source[offset + 5] - source[offset + 2]) * amount;
    travelled += length;
    vertices = (segment + 1) * 2;
    if (amount < 1) break;
  }
  return vertices;
}

/** Merged line segments for box outlines; unlike wireframe materials, this has no diagonals. */
export function buildOutlinePositions(
  boxes: readonly OutlineBox[]
): Float32Array {
  const positions: number[] = [];
  for (const box of boxes) {
    const x0 = box.x - box.width / 2;
    const x1 = box.x + box.width / 2;
    const y0 = box.y;
    const y1 = box.y + box.height;
    const z0 = box.z - box.depth / 2;
    const z1 = box.z + box.depth / 2;
    const edges = [
      [
        [x0, y0, z0],
        [x1, y0, z0],
      ],
      [
        [x1, y0, z0],
        [x1, y0, z1],
      ],
      [
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [
        [x0, y0, z1],
        [x0, y0, z0],
      ],
      [
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      [
        [x1, y1, z0],
        [x1, y1, z1],
      ],
      [
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [
        [x0, y0, z0],
        [x0, y1, z0],
      ],
      [
        [x1, y0, z0],
        [x1, y1, z0],
      ],
      [
        [x1, y0, z1],
        [x1, y1, z1],
      ],
      [
        [x0, y0, z1],
        [x0, y1, z1],
      ],
    ];
    for (const [from, to] of edges) positions.push(...from, ...to);
  }
  return new Float32Array(positions);
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export function buildingRiseAt(elapsed: number, reducedMotion = false): number {
  if (reducedMotion) return 1;
  return 0.08 + 0.92 * smooth((elapsed - 0.2) / 1.1);
}

/** Scale each 12-edge box around its own ground plane after tracing. */
export function growBuildingOutline(
  positions: Float32Array,
  rise: number,
  vertexCount = positions.length / 3
): void {
  const clamped = Math.max(0, Math.min(1, rise));
  for (let box = 0; box * 24 < vertexCount; box++) {
    const baseOffset = box * 72 + 1;
    const base = positions[baseOffset] as number;
    const end = Math.min(vertexCount, (box + 1) * 24);
    for (let vertex = box * 24; vertex < end; vertex++) {
      const yOffset = vertex * 3 + 1;
      positions[yOffset] =
        base + ((positions[yOffset] as number) - base) * clamped;
    }
  }
}

/**
 * Return the boot phase at a renderer clock time. Keeping this pure makes the
 * timing testable and lets every Three component share the same clock without
 * adding React renders to the frame loop.
 */
export function revealAt(
  elapsed: number,
  reducedMotion = false
): RevealProgress {
  if (reducedMotion) return { trace: 1, wireframe: 0, districts: 1, links: 1 };
  return {
    // The board is traced first, then the solid districts take its place.
    trace: smooth(elapsed / 0.7),
    wireframe: smooth(elapsed / 0.18) * (1 - smooth((elapsed - 0.95) / 0.45)),
    districts: smooth((elapsed - 0.75) / 0.65),
    // Links arrive last, like buses coming online after the board is powered.
    links: smooth((elapsed - 1.35) / 0.45),
  };
}

export function transitionToward(
  current: number,
  target: number,
  delta: number,
  rate = 12
): number {
  return current + (target - current) * Math.min(1, delta * rate);
}
