import { expect, test } from "vitest";
import {
  approach,
  desiredVelocity,
  FLY_SPEED,
  flySpeed,
  groundAxes,
  translateFlightEndpoints,
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

test("the arrows pan the same way as W, A, S and D", () => {
  const axes = groundAxes(ISO.from, ISO.to);
  expect(desiredVelocity(held("ArrowUp", "ArrowLeft"), axes, 10)).toEqual(
    desiredVelocity(held("KeyW", "KeyA"), axes, 10)
  );
  // An arrow and its letter held together are one push, not two.
  expect(desiredVelocity(held("ArrowUp", "KeyW"), axes, 10)).toEqual(
    desiredVelocity(held("KeyW"), axes, 10)
  );
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
