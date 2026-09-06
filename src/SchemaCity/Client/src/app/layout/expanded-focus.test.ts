import { describe, expect, it } from "vitest";
import type { Placement } from "./city";
import { expandFocusLayout } from "./expanded-focus";

const placement = (
  id: string,
  x: number,
  z: number,
  footprint = 2
): Placement => ({
  id,
  position: { x, z },
  footprint,
  height: 1,
  floors: 1,
  district: "pages",
  districtKind: "structure",
  introDelay: 0,
});

describe("expandFocusLayout", () => {
  it("keeps direct coordinates and places new nodes in a clear southern band", () => {
    const city = [
      placement("focus", 0, 0),
      placement("unrelated", 40, 40),
      placement("direct", 8, 0),
      placement("extra-a", 80, 80),
      placement("extra-b", 90, 90),
    ];
    const direct = city.map((item) => item);
    const expanded = expandFocusLayout(
      city,
      direct,
      new Set(["focus", "direct"]),
      new Set(["focus", "direct", "extra-a", "extra-b"])
    );
    expect(expanded).toHaveLength(city.length);
    expect(expanded[0]).toEqual(direct[0]);
    expect(expanded[1]).toEqual(direct[1]);
    expect(expanded[2]).toEqual(direct[2]);
    expect(expanded[3]?.position.z).toBeGreaterThan(11);
    expect(expanded[4]?.position.z).toBeGreaterThan(11);
    expect(expanded[3]?.position).not.toEqual(expanded[4]?.position);
  });

  it("keeps an earlier expanded band fixed when a later step is added", () => {
    const city = [
      placement("focus", 0, 0),
      placement("first", 80, 80),
      placement("second", 90, 90),
    ];
    const direct = city.map((item) => item);
    const first = expandFocusLayout(
      city,
      direct,
      new Set(["focus"]),
      new Set(["focus", "first"])
    );
    const second = expandFocusLayout(
      city,
      first,
      new Set(["focus"]),
      new Set(["focus", "first", "second"])
    );
    expect(second.find((item) => item.id === "first")?.position).toEqual(
      first.find((item) => item.id === "first")?.position
    );
    expect(
      second.find((item) => item.id === "second")?.position.z
    ).toBeGreaterThan(
      first.find((item) => item.id === "first")?.position.z ?? 0
    );
  });

  it("is deterministic and ignores ids absent from the city", () => {
    const city = [
      placement("focus", 0, 0),
      placement("b", 10, 0),
      placement("a", 20, 0),
    ];
    const direct = [placement("focus", 0, 0)];
    const ids = new Set(["a", "b", "missing"]);
    const first = expandFocusLayout(city, direct, new Set(["focus"]), ids);
    const second = expandFocusLayout(city, direct, new Set(["focus"]), ids);
    expect(first).toEqual(second);
  });
});
