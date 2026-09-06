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
