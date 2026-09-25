// Keyboard flight: which way the held keys push, how a push eases in and out, and how
// a screen-relative push becomes world motion. Pure: no three.js, no React, no DOM.
// Scene.tsx owns the listeners and applies this in `useFrame`.
//
// Borrowed from fsn's scene.ts, including the ease. W, A, S and D and the arrows fly
// along the ground the way the camera faces, and R and F rise and descend. fsn turns
// with the arrows; here they pan, because dragging already orbits and a turn from the
// overview distance swings the view a long way.

export type Ground = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

type FlightEndpoints = {
  from: { position: Vec3; target: Vec3 };
  to: { position: Vec3; target: Vec3 };
};

/**
 * Rebase an in-flight camera transition after the keys move the camera. Moving every endpoint by
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
 * The slowest the keys fly, world units per second. A street is 9 units wide.
 */
export const FLY_SPEED = 24;

/**
 * How much faster the keys fly per world unit between the camera and its target.
 * A fixed speed would crawl across the whole city from the overview and bolt past a
 * building from street level. At 0.6 the overview crosses the city in two seconds or
 * so, and close in the floor of `FLY_SPEED` takes over.
 */
const FLY_PER_DISTANCE = 0.6;

/**
 * Shift doubles the flying speed. fsn multiplies by 3.5, over a filesystem that can
 * be a hundred times the size of a schema; two crosses this city fast enough.
 */
export const BOOST = 2;

/**
 * The fraction of the gap to the wanted velocity still left after one second, which
 * is fsn's ease. It reads as weight: about 155 ms to cover two thirds of the gap,
 * whatever the frame rate, so a key press ramps up and a release coasts to a stop
 * rather than snapping either way.
 */
const EASE_REMAINING = 0.0016;

/** Flying speed for a camera `distance` from its orbit target. */
export function flySpeed(distance: number): number {
  return Math.max(FLY_SPEED, distance * FLY_PER_DISTANCE);
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
 * looking at `to`. "Up the screen" is the view direction flattened onto the ground,
 * so W flies the way the camera faces however far it is tilted.
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
 * The velocity the held keys ask for, in world units per second. A diagonal is
 * normalised, so two keys are not faster than one.
 */
export function desiredVelocity(
  held: ReadonlySet<string>,
  axes: { forward: Ground; right: Ground },
  speed: number
): Vec3 {
  const on = (code: string) => Number(held.has(code));
  const forward =
    Math.max(on("KeyW"), on("ArrowUp")) - Math.max(on("KeyS"), on("ArrowDown"));
  const right =
    Math.max(on("KeyD"), on("ArrowRight")) -
    Math.max(on("KeyA"), on("ArrowLeft"));
  const up = on("KeyR") - on("KeyF");
  const length = Math.hypot(forward, right, up);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  const scale = speed / length;
  return {
    x: (axes.forward.x * forward + axes.right.x * right) * scale,
    y: up * scale,
    z: (axes.forward.z * forward + axes.right.z * right) * scale,
  };
}
