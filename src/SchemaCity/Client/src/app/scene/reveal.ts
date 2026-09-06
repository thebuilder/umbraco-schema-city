/** The short boot sequence that makes the city read as a computer board. */
export type RevealProgress = {
  wireframe: number;
  districts: number;
  links: number;
};

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
  if (reducedMotion) return { wireframe: 0, districts: 1, links: 1 };
  return {
    // The board is traced first, then the solid districts take its place.
    wireframe: smooth(elapsed / 0.72) * (1 - smooth((elapsed - 0.62) / 0.62)),
    districts: smooth((elapsed - 0.48) / 0.72),
    // Links arrive last, like buses coming online after the board is powered.
    links: smooth((elapsed - 1.02) / 0.62),
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
