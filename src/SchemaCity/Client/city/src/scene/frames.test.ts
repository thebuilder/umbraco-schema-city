import { expect, test } from "vitest";
import { stepFor } from "./frames";

test("an animation starting after a still spell takes one frame's step, not the spell", () => {
  expect(stepFor(4.2, false)).toBeCloseTo(1 / 60);
  expect(stepFor(1 / 120, false)).toBe(1 / 120);
  expect(stepFor(0.05, true)).toBe(0.05);
});
