// Where the camera stands to frame the city. Pure: no three.js, no React.

import type { Vec3 } from "./flight";
import { CAMERA_FOV } from "./stage";

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
 * The default view looks down the isometric diagonal, from the south-east at about
 * 35 degrees, so the city opens on the overview it always has, now with depth.
 */
const FRAMING_DIRECTION = unit({ x: 1, y: 1, z: 1 });

/**
 * How far back the camera stands along `direction` (from the target toward the
 * camera), and how far the target moves along screen-right, for every one of
 * `corners` to land inside `fill` of the viewport the inspector leaves uncovered.
 * The corners are given relative to the unmoved target.
 *
 * The uncovered part is the left `width - coveredWidth` pixels, so the window is
 * lopsided around the middle of the canvas. The camera is solved for against that
 * window directly. Fitting a centred window and then sliding the target by the
 * panel's half width only moves the target's own depth by that many pixels: the
 * near corners slide further, off the left edge, and the far ones leave a gap by the
 * panel.
 *
 * A corner at `x` across and `z` toward the camera sits `D - z` deep and lands at
 * slope `(x - shift) / (D - z)`, which has to fall between the window's left and
 * right slopes. Each corner bounds the shift from both sides, the two bounds close
 * as `D` grows, and the nearest `D` at which they meet is the horizontal fit. The
 * height fit is each corner's own, around the target, and the distance is the
 * larger of the two, kept inside `range`. The shift then centres the corners in
 * the window.
 */
function framing(
  corners: readonly Vec3[],
  direction: Vec3,
  viewport: { width: number; height: number },
  coveredWidth: number,
  fill: number,
  fov: number,
  range = { min: 0, max: Number.POSITIVE_INFINITY }
): { distance: number; shift: number } {
  const back = unit(direction);
  const right = unit(cross({ x: 0, y: 1, z: 0 }, back));
  const up = cross(back, right);
  const halfTan = Math.tan((fov * Math.PI) / 360);
  const slopeY = halfTan * fill;
  // Screen pixels per unit of slope, and the window's edges as slopes.
  const focal = viewport.height / 2 / halfTan;
  const centre = -coveredWidth / 2;
  const half = (Math.max(1, viewport.width - coveredWidth) / 2) * fill;
  const left = (centre - half) / focal;
  const rightEdge = (centre + half) / focal;

  let tall = 0;
  let leftmost = Number.POSITIVE_INFINITY;
  let rightmost = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const across = dot(corner, right);
    const toward = dot(corner, back);
    tall = Math.max(tall, toward + Math.abs(dot(corner, up)) / slopeY);
    leftmost = Math.min(leftmost, across + left * toward);
    rightmost = Math.max(rightmost, across + rightEdge * toward);
  }
  const wide = (rightmost - leftmost) / (rightEdge - left);
  // Inside the orbit range, or the controls clamp the distance the moment a flight
  // hands them the camera, which reads as the camera overshooting and snapping back.
  // Past the far end some of the city is cut off, which is the lesser problem.
  const distance = Math.min(range.max, Math.max(range.min, tall, wide));
  // The shift has to be at least `rightmost - rightEdge * D` and at most
  // `leftmost - left * D`; at the horizontal fit the two are equal. When the height
  // set the distance there is room either side, and the shift that leaves equal room
  // on both is found by halving: a larger shift moves every corner left, so the gap
  // on the left shrinks as the one on the right grows.
  let low = rightmost - rightEdge * distance;
  let high = leftmost - left * distance;
  for (let step = 0; step < 40 && high - low > 1e-6; step++) {
    const shift = (low + high) / 2;
    let least = Number.POSITIVE_INFINITY;
    let most = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      const slope =
        (dot(corner, right) - shift) / (distance - dot(corner, back));
      least = Math.min(least, slope);
      most = Math.max(most, slope);
    }
    if (least - left > rightEdge - most) low = shift;
    else high = shift;
  }
  return { distance, shift: (low + high) / 2 };
}

/** What a framing shows: the ground it has to fit, and the point it centres on. */
export type Framed = {
  centre: { x: number; z: number };
  grounds: readonly {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }[];
};

/** The orbit controls' dolly range, which every framing stays inside. */
export const MIN_DISTANCE = 3;
export const maxDistanceFor = (span: number) => span * 6;

/**
 * Where the camera stands to frame `bounds` from the default direction: every corner
 * of every piece of ground, at the ground and at the height of the tallest building,
 * inside `fill` of the canvas left of the `covered` pixels the inspector takes, and
 * no further out than the controls let the camera go for a city `span` across.
 *
 * A panel over more than half the canvas leaves a strip too narrow to frame a city
 * in, and fitting one there sends the camera out of the dolly range. The panel is
 * left out then, and the city framed across the whole canvas, partly under it.
 */
export function viewOf(
  bounds: Framed,
  size: { width: number; height: number },
  covered: number,
  fill: number,
  buildingHeight: number,
  span: number
): { position: Vec3; target: Vec3 } {
  const corners = bounds.grounds.flatMap((ground) =>
    [ground.minX, ground.maxX].flatMap((x) =>
      [ground.minZ, ground.maxZ].flatMap((z) =>
        [0, buildingHeight].map((y) => ({
          x: x - bounds.centre.x,
          y: y - buildingHeight / 2,
          z: z - bounds.centre.z,
        }))
      )
    )
  );
  const { distance, shift } = framing(
    corners,
    FRAMING_DIRECTION,
    size,
    covered > size.width / 2 ? 0 : covered,
    fill,
    CAMERA_FOV,
    { min: MIN_DISTANCE, max: maxDistanceFor(span) }
  );
  const right = unit(cross({ x: 0, y: 1, z: 0 }, FRAMING_DIRECTION));
  const target = {
    x: bounds.centre.x + right.x * shift,
    y: buildingHeight / 2,
    z: bounds.centre.z + right.z * shift,
  };
  return {
    position: {
      x: target.x + FRAMING_DIRECTION.x * distance,
      y: target.y + FRAMING_DIRECTION.y * distance,
      z: target.z + FRAMING_DIRECTION.z * distance,
    },
    target,
  };
}

/** Share of the uncovered width a revealed building is kept from either edge. */
const REVEAL_MARGIN = 0.15;

/**
 * How far the camera and its target slide sideways for `point` to stand beside the
 * panel rather than under it, as a world displacement; zero when it already does.
 * Selecting a type from search opens the panel over wherever its building happens
 * to be, and a first-time reader picked Home that way and never saw it.
 *
 * The slide is along the camera's own right, which is level for an orbit camera, so
 * the point keeps its depth and the pixels it has to move turn into world units at
 * that depth exactly. Only sideways: the panel covers a side, and a slide up or
 * down would lift the orbit point off the ground. A point behind the camera is left
 * alone, since no slide brings it on screen.
 */
export function revealShift(
  point: Vec3,
  view: { position: Vec3; target: Vec3 },
  size: { width: number; height: number },
  covered: number,
  fov: number
): Vec3 {
  const back = unit({
    x: view.position.x - view.target.x,
    y: view.position.y - view.target.y,
    z: view.position.z - view.target.z,
  });
  const right = unit(cross({ x: 0, y: 1, z: 0 }, back));
  const offset = {
    x: point.x - view.position.x,
    y: point.y - view.position.y,
    z: point.z - view.position.z,
  };
  const depth = -dot(offset, back);
  if (depth <= 0) return { x: 0, y: 0, z: 0 };
  const focal = size.height / 2 / Math.tan((fov * Math.PI) / 360);
  const at = size.width / 2 + (dot(offset, right) / depth) * focal;
  const uncovered = Math.max(0, size.width - covered);
  const lowest = uncovered * REVEAL_MARGIN;
  const highest = uncovered * (1 - REVEAL_MARGIN);
  const pixels = at > highest ? at - highest : at < lowest ? at - lowest : 0;
  if (pixels === 0) return { x: 0, y: 0, z: 0 };
  const amount = (pixels * depth) / focal;
  return { x: right.x * amount, y: 0, z: right.z * amount };
}
