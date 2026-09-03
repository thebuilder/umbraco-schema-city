import { describe, expect, it } from "vitest";
import { LAYERS } from "./scene/layers";
import { parseUrl, type UrlState, serialiseUrl } from "./url";

const aliases = ["article", "blogPost", "home"];

describe("parseUrl", () => {
  it("reads an empty query as the city with Structure on", () => {
    expect(parseUrl("", aliases)).toEqual({
      type: null,
      focus: false,
      layers: ["structure"],
    });
  });

  it("reads a type, a focus flag and a layer list", () => {
    expect(parseUrl("?type=article&focus=1&layers=structure,compositions", aliases)).toEqual({
      type: "article",
      focus: true,
      layers: ["structure", "compositions"],
    });
  });

  it("ignores an alias the schema does not have", () => {
    expect(parseUrl("?type=deletedType&focus=1", aliases)).toEqual({
      type: null,
      focus: false,
      layers: ["structure"],
    });
  });

  it("ignores a focus flag with no type to focus on", () => {
    expect(parseUrl("?focus=1", aliases).focus).toBe(false);
  });

  it("drops layer names it does not know", () => {
    expect(parseUrl("?layers=blocks,usage", aliases).layers).toEqual(["blocks"]);
  });

  it("reads an empty layer list as every layer off", () => {
    expect(parseUrl("?layers=", aliases).layers).toEqual([]);
  });

  it("puts the layers in toolbar order however they were written", () => {
    expect(parseUrl("?layers=references,blocks,blocks,structure", aliases).layers).toEqual([
      "structure",
      "blocks",
      "references",
    ]);
  });
});

describe("serialiseUrl", () => {
  const roundTrips = (state: UrlState) =>
    expect(parseUrl(serialiseUrl(state), aliases)).toEqual(state);

  it("round-trips the default state", () => {
    roundTrips({ type: null, focus: false, layers: ["structure"] });
  });

  it("round-trips a focused type with every layer on", () => {
    roundTrips({ type: "blogPost", focus: true, layers: [...LAYERS] });
  });

  it("round-trips a selection with no layers at all", () => {
    roundTrips({ type: "home", focus: false, layers: [] });
  });

  it("writes the documented shape", () => {
    expect(serialiseUrl({ type: "article", focus: true, layers: ["structure", "compositions"] })).toBe(
      "?type=article&focus=1&layers=structure,compositions",
    );
  });

  it("leaves the focus flag out when there is no type", () => {
    expect(serialiseUrl({ type: null, focus: true, layers: [] })).toBe("?layers=");
  });
});
