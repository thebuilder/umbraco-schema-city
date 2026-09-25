import { expect, test } from "vitest";
import {
  approach,
  desiredVelocity,
  FLY_SPEED,
  flySpeed,
  groundAxes,
  groundedTarget,
  translateFlightEndpoints,
  turnedOffset,
  turnRates,
} from "./flight";

/** The default framing's pose: standing south-east of the city, looking at it. */
const ISO = { from: { x: 10, y: 10, z: 10 }, to: { x: 0, y: 0, z: 0 } };

const held = (...codes: string[]) => new Set(codes);

test("W flies the way the camera faces, whichever way it is turned", () => {
  for (const angle of [0, Math.PI / 4, Math.PI, -2.2]) {
    const from = { x: Math.sin(angle) * 10, y: 10, z: Math.cos(angle) * 10 };
    const axes = groundAxes(from, { x: 0, y: 0, z: 0 });
    const velocity = desiredVelocity(held("KeyW"), axes, 10);
    // Up the screen along the ground is the view direction flattened, so the camera
    // moving that way closes on the point it was looking at.
    const closing = { x: from.x + velocity.x, z: from.z + velocity.z };
    expect(Math.hypot(closing.x, closing.z)).toBeLessThan(
      Math.hypot(from.x, from.z)
    );
    expect(velocity.y).toBe(0);
  }
});

test("D flies right of the screen and A the other way", () => {
  const axes = groundAxes(ISO.from, ISO.to);
  const right = desiredVelocity(held("KeyD"), axes, 10);
  const left = desiredVelocity(held("KeyA"), axes, 10);
  expect(right.x).toBeCloseTo(-left.x);
  expect(right.z).toBeCloseTo(-left.z);
  // Screen-right is a quarter turn clockwise from screen-up, which for this camera
  // looking north-west is the north-east direction on the ground.
  expect(right.x).toBeCloseTo(10 / Math.SQRT2);
  expect(right.z).toBeCloseTo(-10 / Math.SQRT2);
});

test("the arrows move nothing, because they turn instead", () => {
  const axes = groundAxes(ISO.from, ISO.to);
  expect(desiredVelocity(held("ArrowUp", "ArrowLeft"), axes, 10)).toEqual({
    x: 0,
    y: 0,
    z: 0,
  });
});

test("a diagonal is no faster than one key, and holding both ways stands still", () => {
  const axes = groundAxes(ISO.from, ISO.to);
  const diagonal = desiredVelocity(held("KeyW", "KeyD"), axes, FLY_SPEED);
  expect(Math.hypot(diagonal.x, diagonal.y, diagonal.z)).toBeCloseTo(FLY_SPEED);
  expect(desiredVelocity(held("KeyW", "KeyS"), axes, FLY_SPEED)).toEqual({
    x: 0,
    y: 0,
    z: 0,
  });
});

test("R rises and F descends", () => {
  const axes = groundAxes(ISO.from, ISO.to);
  expect(desiredVelocity(held("KeyR"), axes, 10).y).toBeCloseTo(10);
  expect(desiredVelocity(held("KeyF"), axes, 10).y).toBeCloseTo(-10);
});

test("flying speeds up with distance and never drops below the floor", () => {
  expect(flySpeed(0)).toBe(FLY_SPEED);
  expect(flySpeed(400)).toBeGreaterThan(flySpeed(200));
  // Twice as far out is twice as fast, so a key covers about the same share of the
  // screen from the overview as from halfway in.
  expect(flySpeed(400) / flySpeed(200)).toBeCloseTo(2);
});

test("velocity eases in and out at the same rate whatever the frame rate", () => {
  const step = (frames: number, delta: number) => {
    let velocity = 0;
    for (let frame = 0; frame < frames; frame++)
      velocity = approach(velocity, 20, delta);
    return velocity;
  };
  // Half a second of flight at 60 fps and at 20 fps.
  expect(step(30, 1 / 60)).toBeCloseTo(step(10, 1 / 20), 3);
  // And it is most of the way there by then, rather than still ramping up.
  expect(step(30, 1 / 60)).toBeGreaterThan(19);
  expect(approach(20, 0, 1 / 60)).toBeLessThan(20);
});

test("the arrows turn left, right, up and down", () => {
  expect(turnRates(held("ArrowLeft"))).toEqual({ yaw: 1, pitch: 0 });
  expect(turnRates(held("ArrowRight", "ArrowDown"))).toEqual({
    yaw: -1,
    pitch: -1,
  });
  expect(turnRates(held("KeyW"))).toEqual({ yaw: 0, pitch: 0 });
});

test("a turn keeps the camera where it is and holds its distance", () => {
  const offset = { x: 0, y: 6, z: 10 };
  const turned = turnedOffset(offset, 0.3, 0.1, Math.PI / 2);
  expect(Math.hypot(turned.x, turned.y, turned.z)).toBeCloseTo(
    Math.hypot(0, 6, 10)
  );
  // Yawing left swings the target to the left of the view, which is the offset
  // rotating the other way about the camera.
  expect(turned.x).toBeGreaterThan(0);
});

test("panning rebases an in-flight transition without changing its orientation", () => {
  const flight = {
    from: {
      position: { x: 0, y: 10, z: 10 },
      target: { x: 0, y: 0, z: 0 },
    },
    to: {
      position: { x: 2, y: 8, z: 6 },
      target: { x: 2, y: 0, z: 1 },
    },
  };
  const pan = { x: 3, y: 0, z: -4 };
  const before = (t: number) => ({
    position: {
      x:
        flight.from.position.x +
        (flight.to.position.x - flight.from.position.x) * t,
      y:
        flight.from.position.y +
        (flight.to.position.y - flight.from.position.y) * t,
      z:
        flight.from.position.z +
        (flight.to.position.z - flight.from.position.z) * t,
    },
    target: {
      x: flight.from.target.x + (flight.to.target.x - flight.from.target.x) * t,
      y: flight.from.target.y + (flight.to.target.y - flight.from.target.y) * t,
      z: flight.from.target.z + (flight.to.target.z - flight.from.target.z) * t,
    },
  });
  const poseBefore = before(0.3);
  const finalBefore = before(1);
  translateFlightEndpoints(flight, pan);
  const poseAfter = before(0.3);
  const finalAfter = before(1);

  for (const [after, prior] of [
    [poseAfter, poseBefore],
    [finalAfter, finalBefore],
  ]) {
    expect(after.position.x - prior.position.x).toBeCloseTo(pan.x);
    expect(after.position.y - prior.position.y).toBeCloseTo(pan.y);
    expect(after.position.z - prior.position.z).toBeCloseTo(pan.z);
    expect(after.target.x - prior.target.x).toBeCloseTo(pan.x);
    expect(after.target.y - prior.target.y).toBeCloseTo(pan.y);
    expect(after.target.z - prior.target.z).toBeCloseTo(pan.z);
    expect(after.position.x - after.target.x).toBeCloseTo(
      prior.position.x - prior.target.x
    );
    expect(after.position.y - after.target.y).toBeCloseTo(
      prior.position.y - prior.target.y
    );
    expect(after.position.z - after.target.z).toBeCloseTo(
      prior.position.z - prior.target.z
    );
  }
});

test("pitch stops at the horizon and short of straight down", () => {
  const radius = Math.hypot(0, 6, 10);
  // Looking up, which the controls stop at a polar angle of 90 degrees: past it the
  // view would swing under the ground. The offset ends level with the camera.
  const up = turnedOffset({ x: 0, y: 6, z: 10 }, 0, 4, Math.PI / 2);
  expect(up.y).toBeGreaterThan(0);
  expect(up.y / radius).toBeLessThan(0.03);
  // Looking down stops a hair short of the pole, where an azimuth has nothing left
  // to rotate.
  const down = turnedOffset({ x: 0, y: 6, z: 10 }, 0, -4, Math.PI / 2);
  expect(down.y).toBeCloseTo(radius, 1);
  expect(down.z).toBeGreaterThan(0);
});

test("tilting down never leaves the orbit target under the ground", () => {
  const camera = { x: 0, y: 10, z: 10 };
  // Looking down through the ground to a point ten units under it.
  expect(groundedTarget(camera, { x: 0, y: -10, z: -10 })).toEqual({
    x: 0,
    y: 0,
    z: 0,
  });
  // A target already on or over the ground stays where it is.
  const above = { x: 3, y: 2, z: 1 };
  expect(groundedTarget(camera, above)).toBe(above);
});
