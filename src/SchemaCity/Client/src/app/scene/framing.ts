// How far back the camera stands to frame a box. Pure: no three.js, no React.

type Vec3 = { x: number; y: number; z: number };

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};

/**
 * The distance from the target, along `direction` (from the target toward the
 * camera), at which every one of `corners` lands inside `fill` of the viewport the
 * inspector leaves uncovered. The corners are given relative to the target.
 *
 * Each corner is solved for on its own: a corner `p` sits `D - p . direction` in
 * front of a camera `D` away, and it is on screen once that depth covers its offset
 * across the view at the field of view's slope. The nearest corners of a small city
 * are much closer to the camera than its centre, so fitting the projected outline at
 * one scale, the way an orthographic camera could, cuts them off.
 */
export function framingDistance(
  corners: readonly Vec3[],
  direction: Vec3,
  viewport: { width: number; height: number },
  coveredWidth: number,
  fill: number,
  fov: number
): number {
  const back = unit(direction);
  const right = unit(cross({ x: 0, y: 1, z: 0 }, back));
  const up = cross(back, right);
  const slopeY = Math.tan((fov * Math.PI) / 360) * fill;
  const slopeX =
    (slopeY * Math.max(1, viewport.width - coveredWidth)) /
    Math.max(1, viewport.height);
  let distance = 0;
  for (const corner of corners) {
    const toward = dot(corner, back);
    distance = Math.max(
      distance,
      toward + Math.abs(dot(corner, right)) / slopeX,
      toward + Math.abs(dot(corner, up)) / slopeY
    );
  }
  return distance;
}
