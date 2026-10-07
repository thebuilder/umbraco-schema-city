import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildingColours,
  lensColours,
  type PaintState,
  paintPart,
} from "./building-paint";
import { CHANGE_STEP, type LensScale } from "./lens";

const colours = buildingColours({
  phosphor: "#00ff80",
  dim: "#306050",
  signal: "#ff2060",
  amber: "#ffb000",
  azure: "#40a0ff",
  background: "#000000",
  separator: "#102018",
});

const state = (extra: Partial<PaintState> = {}): PaintState => ({
  selected: null,
  hovered: null,
  neighbours: null,
  lens: new Map(),
  lensOn: false,
  district: new Map([
    ["page", "structure"],
    ["card", "elements"],
  ]),
  flatten: new Map(),
  ...extra,
});

const hex = (kind: Parameters<typeof paintPart>[0], id: string, s = state()) =>
  paintPart(kind, id, colours, s, new THREE.Color()).getHexString();

describe("paintPart", () => {
  it("colours a page by its district, a shell azure and an element amber", () => {
    expect(hex("own", "page")).toBe(colours.phosphor.getHexString());
    expect(hex("composed", "page")).toBe(colours.azure.getHexString());
    expect(hex("element", "card")).toBe(colours.amber.getHexString());
    // A page in a composition or mixed district goes phosphor-dim.
    expect(hex("own", "elsewhere")).toBe(colours.dim.getHexString());
  });

  it("turns the body signal on selection and leaves the base and pins alone", () => {
    const selected = state({ selected: "page" });

    expect(hex("own", "page", selected)).toBe(colours.signal.getHexString());
    expect(hex("plaza", "page", selected)).toBe(colours.signal.getHexString());
    expect(hex("plinth", "page", selected)).toBe(
      hex("plinth", "page", state())
    );
    expect(hex("pin", "page", selected)).toBe(colours.dim.getHexString());
  });

  it("puts the lens on slabs, sends Element Types dim, and never paints plazas", () => {
    const scale: LensScale = {
      ramp: "sequential",
      t: new Map([["page", 1]]),
      minLabel: "0",
      maxLabel: "1",
    };
    const lensed = state({
      lens: lensColours(scale, colours),
      lensOn: true,
    });

    expect(hex("own", "page", lensed)).toBe(colours.azure.getHexString());
    expect(hex("composed", "page", lensed)).toBe(colours.azure.getHexString());
    expect(hex("element", "card", lensed)).toBe(colours.dim.getHexString());
    expect(hex("plaza", "page", lensed)).toBe(colours.dim.getHexString());
  });

  it("brightens the hovered building and fades the ones outside the lit set", () => {
    const plain = paintPart("own", "page", colours, state(), new THREE.Color());
    const hovered = paintPart(
      "own",
      "page",
      colours,
      state({ hovered: "page" }),
      new THREE.Color()
    );
    const faded = paintPart(
      "own",
      "page",
      colours,
      state({ neighbours: new Set(["other"]) }),
      new THREE.Color()
    );
    const flat = paintPart(
      "own",
      "page",
      colours,
      state({
        neighbours: new Set(["other"]),
        flatten: new Map([["page", 1]]),
      }),
      new THREE.Color()
    );

    expect(hovered.g).toBeGreaterThan(plain.g);
    expect(faded.g).toBeCloseTo(plain.g * 0.2);
    expect(flat.g).toBeLessThan(faded.g);
  });
});

describe("change layer", () => {
  it("paints a cause louder than its side effect, and both louder than the rest", () => {
    const scale: LensScale = {
      ramp: "change",
      t: new Map([
        ["added", CHANGE_STEP.added],
        ["cause", CHANGE_STEP.changed],
        ["echo", CHANGE_STEP["side effect"]],
        ["same", 0],
      ]),
      minLabel: "unchanged",
      maxLabel: "added",
    };
    const lit = lensColours(scale, colours);
    const brightness = (id: string) => {
      const colour = lit.get(id) as THREE.Color;
      return colour.r + colour.g + colour.b;
    };
    expect(lit.get("added")?.getHexString()).toBe(colours.azure.getHexString());
    expect(lit.get("cause")?.getHexString()).toBe(colours.amber.getHexString());
    expect(brightness("echo")).toBeLessThan(brightness("cause") / 2);
    expect(brightness("same")).toBeLessThan(brightness("echo"));
  });
});
