import { describe, expect, it } from "vitest";
import { revealAt, transitionToward } from "./reveal";

describe("revealAt", () => {
  it("boots from a wireframe into districts and links", () => {
    expect(revealAt(0)).toEqual({ wireframe: 0, districts: 0, links: 0 });
    const middle = revealAt(0.8);
    expect(middle.wireframe).toBeGreaterThan(0);
    expect(middle.districts).toBeGreaterThan(0);
    expect(middle.links).toBe(0);
    expect(revealAt(2).links).toBe(1);
  });

  it("skips the boot animation when motion is reduced", () => {
    expect(revealAt(0, true)).toEqual({ wireframe: 0, districts: 1, links: 1 });
    expect(transitionToward(0, 1, 1)).toBe(1);
  });
});
