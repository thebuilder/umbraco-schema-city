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

/** The parts of a keydown the flight reads, so the decision can be tested without a DOM. */
type KeyPress = {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  composedPath: () => readonly unknown[];
};

const MODIFIERS: ReadonlySet<string> = new Set([
  "Shift",
  "Meta",
  "Control",
  "Alt",
]);

/**
 * What a keydown does to the flight: "fly" holds the key, "release" lets go of
 * every held key and "modifier" changes nothing held.
 *
 * The city flies only when the key was pressed on the scene's own `host` or on the
 * page with nothing focused. The listener is on the window, and a whitelist is the
 * only safe answer there: an arrow in the inspector's scrolling tab, on a button, in
 * a list or anywhere else in the backoffice belongs to that element. The path's
 * first entry is where the key really started, even across a shadow boundary.
 *
 * Anything else stops the flight rather than leaving keys held. While a command key
 * is down macOS withholds the keyup of everything else, so a key let go inside a
 * shortcut would fly on forever, and a field taking the keyboard mid-flight should
 * stop the camera rather than let it coast.
 */
export function keydownAction(
  event: KeyPress,
  host: unknown
): "fly" | "release" | "modifier" {
  // A modifier on its own lets go of nothing. Shift is the boost, held down mid-flight
  // to go faster, and a Cmd or Ctrl chord releases everything when the modifier
  // itself comes back up.
  if (MODIFIERS.has(event.key)) return "modifier";
  if (
    !FLIGHT_CODES.has(event.code) ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.defaultPrevented
  )
    return "release";
  const [from] = event.composedPath();
  if (from === host) return "fly";
  const tag = (from as { tagName?: unknown } | undefined)?.tagName;
  return tag === "BODY" || tag === "HTML" ? "fly" : "release";
}

/** How low the camera may fly, in world units above the ground. */
const MIN_EYE = 1;

/**
 * The vertical part of one frame's flight, `rise`, cut short so neither the camera
 * at height `eye` nor the point it orbits at height `target` goes under the ground,
 * and the orbit point goes no higher than `ceiling`.
 *
 * R moves the camera and its orbit point together. Without a ceiling, holding it
 * carried both up until the city was gone in the fog, and orbiting from there
 * swung the camera around a point in the empty sky.
 */
export function verticalStep(
  rise: number,
  eye: number,
  target: number,
  ceiling: number
): number {
  const floor = Math.max(Math.min(0, MIN_EYE - eye), Math.min(0, -target));
  return Math.min(Math.max(rise, floor), Math.max(0, ceiling - target));
}

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
