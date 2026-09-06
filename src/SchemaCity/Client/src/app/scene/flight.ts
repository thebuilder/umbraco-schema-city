// Keyboard flight: which way the held keys push, how a push eases in and out, and how
// a screen-relative push becomes world motion. Pure: no three.js, no React, no DOM.
// Scene.tsx owns the listeners and applies this in `useFrame`.
//
// Borrowed from fsn's scene.ts, including the ease and the way a turn walks the orbit
// target around a camera that stays put. Both cameras fly through the same axes: the
// isometric one pans the ground along the screen, and Explore flies along its heading,
// so one set of ground vectors covers the pair.

export type Ground = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

type FlightEndpoints = {
  from: { position: Vec3; target: Vec3 };
  to: { position: Vec3; target: Vec3 };
};

/**
 * Rebase an in-flight camera transition after a pan. Moving every endpoint by
 * the same displacement preserves the transition's orientation and progress.
 */
export function translateFlightEndpoints(
  flight: FlightEndpoints,
  delta: Vec3
): void {
  for (const endpoint of [flight.from, flight.to]) {
    endpoint.position.x += delta.x;
    endpoint.position.y += delta.y;
    endpoint.position.z += delta.z;
    endpoint.target.x += delta.x;
    endpoint.target.y += delta.y;
    endpoint.target.z += delta.z;
  }
}

/** The keys the city flies by. Every other key belongs to the app's own handler. */
export const FLIGHT_CODES: ReadonlySet<string> = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyR",
  "KeyF",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/**
 * How far a held key moves the isometric view, in CSS pixels per second. A speed in
 * world units would crawl when zoomed out and bolt when zoomed in, because the ortho
 * zoom is the only thing between a world unit and a pixel. At 900 a key crosses a
 * 1200 pixel viewport in about a second and a third, at every zoom.
 */
const PAN_PIXELS_PER_SECOND = 900;

/** Explore's flying speed, world units per second. A street is 9 units wide. */
export const FLY_SPEED = 24;

/**
 * Shift doubles both. fsn multiplies by 3.5, over a filesystem that can be a hundred
 * times the size of a schema; two crosses this city fast enough.
 */
export const BOOST = 2;

/**
 * The fraction of the gap to the wanted velocity still left after one second, which
 * is fsn's ease. It reads as weight: about 155 ms to cover two thirds of the gap,
 * whatever the frame rate, so a key press ramps up and a release coasts to a stop
 * rather than snapping either way.
 */
const EASE_REMAINING = 0.0016;

/** Keeps a turn off the pole and off the ground, where a clamp has no angle left. */
const POLAR_MARGIN = 0.02;

/**
 * World units per second that move the view `PAN_PIXELS_PER_SECOND` across the screen.
 *
 * ponytail: the zoom is the only term. A world unit along the screen's up direction
 * lies on the ground at the camera's elevation, so at the isometric angle W and S
 * cover about 0.58 of the screen distance D and A do. Dividing the forward component
 * by the sine of the elevation would even them out, at the price of a second speed
 * and a camera angle to pass in.
 */
export function panSpeed(pixelsPerUnit: number): number {
  return PAN_PIXELS_PER_SECOND / Math.max(pixelsPerUnit, 1e-6);
}

/**
 * Frame-rate independent ease toward `desired`, in seconds. Lerping by a constant
 * per frame instead would tie the feel to the frame rate.
 */
export function approach(
  current: number,
  desired: number,
  delta: number
): number {
  return current + (desired - current) * (1 - EASE_REMAINING ** delta);
}

/**
 * The ground directions the screen's up and right lie along, for a camera at `from`
 * looking at `to`. Under either camera "up the screen" is the view direction flattened
 * onto the ground, so W pans the isometric view the way the reader sees it and flies
 * Explore along its heading, with no second rule for the second camera.
 *
 * Looking straight down leaves no heading, so the fallback is north.
 */
export function groundAxes(
  from: Vec3,
  to: Vec3
): { forward: Ground; right: Ground } {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const length = Math.hypot(x, z);
  const forward =
    length < 1e-6 ? { x: 0, z: -1 } : { x: x / length, z: z / length };
  // right = forward × up, which for a ground vector is a quarter turn.
  return { forward, right: { x: -forward.z, z: forward.x } };
}

/**
 * The velocity the held keys ask for, in world units per second.
 *
 * In `pan` the arrows are the WASD keys under another name and there is no vertical,
 * because the isometric camera holds its own height. In `fly` the arrows are turning
 * instead, and R and F rise and descend. A diagonal is normalised, so two keys are
 * not faster than one.
 */
export function desiredVelocity(
  held: ReadonlySet<string>,
  axes: { forward: Ground; right: Ground },
  speed: number,
  mode: "pan" | "fly"
): Vec3 {
  const on = (fly: string, arrow: string) =>
    held.has(fly) || (mode === "pan" && held.has(arrow)) ? 1 : 0;
  const forward = on("KeyW", "ArrowUp") - on("KeyS", "ArrowDown");
  const right = on("KeyD", "ArrowRight") - on("KeyA", "ArrowLeft");
  const up =
    mode === "fly" ? Number(held.has("KeyR")) - Number(held.has("KeyF")) : 0;
  const length = Math.hypot(forward, right, up);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  const scale = speed / length;
  return {
    x: (axes.forward.x * forward + axes.right.x * right) * scale,
    y: up * scale,
    z: (axes.forward.z * forward + axes.right.z * right) * scale,
  };
}

/** How hard the arrows are turning, from -1 to 1. Explore only. */
export function turnRates(held: ReadonlySet<string>): {
  yaw: number;
  pitch: number;
} {
  return {
    yaw: Number(held.has("ArrowLeft")) - Number(held.has("ArrowRight")),
    pitch: Number(held.has("ArrowUp")) - Number(held.has("ArrowDown")),
  };
}

/**
 * Swings the view by walking the orbit target around a camera that stays put, which
 * is the only way a keyboard can change heading while the orbit controls read the
 * pose back off those two points every frame.
 *
 * `offset` is the camera minus its target, so the new target is the camera minus what
 * comes back. The pitch is clamped to the same range the controls allow, which stops
 * the view at the horizon rather than letting it swing under the ground.
 */
export function turnedOffset(
  offset: Vec3,
  yaw: number,
  pitch: number,
  maxPolar: number
): Vec3 {
  const radius = Math.hypot(offset.x, offset.y, offset.z);
  if (radius < 1e-6) return offset;
  const theta = Math.atan2(offset.x, offset.z) + yaw;
  const phi = Math.min(
    Math.max(Math.acos(offset.y / radius) + pitch, POLAR_MARGIN),
    maxPolar - POLAR_MARGIN
  );
  return {
    x: radius * Math.sin(phi) * Math.sin(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.cos(theta),
  };
}
