import { describe, expect, it } from "vitest";
import { LAYERS } from "./scene/layers";
import { parseUrl, serialiseUrl, type UrlState, urlToWrite } from "./url";

const aliases = ["article", "blogPost", "home"];

describe("parseUrl", () => {
  it("reads an empty query as the city with Structure on", () => {
    expect(parseUrl("", aliases)).toEqual({
      type: null,
      focus: false,
      layers: ["structure"],
      lens: "none",
      view: "city",
      group: "structure",
      dataType: null,
    });
  });

  it("reads a type, a focus flag and a layer list", () => {
    expect(
      parseUrl("?type=article&focus=1&layers=structure,compositions", aliases)
    ).toEqual({
      type: "article",
      focus: true,
      layers: ["structure", "compositions"],
      lens: "none",
      view: "city",
      group: "structure",
      dataType: null,
    });
  });

  it("ignores an alias the schema does not have", () => {
    expect(parseUrl("?type=deletedType&focus=1", aliases)).toEqual({
      type: null,
      focus: false,
      layers: ["structure"],
      lens: "none",
      view: "city",
      group: "structure",
      dataType: null,
    });
  });

  it("ignores a focus flag with no type to focus on", () => {
    expect(parseUrl("?focus=1", aliases).focus).toBe(false);
  });

  it("drops layer names it does not know", () => {
    expect(parseUrl("?layers=blocks,usage", aliases).layers).toEqual([
      "blocks",
    ]);
  });

  it("reads a lens name, and reads one it does not know as no lens", () => {
    expect(parseUrl("?lens=published", aliases).lens).toBe("published");
    expect(parseUrl("?lens=temperature", aliases).lens).toBe("none");
  });

  it("reads an empty layer list as every layer off", () => {
    expect(parseUrl("?layers=", aliases).layers).toEqual([]);
  });

  it("puts the layers in toolbar order however they were written", () => {
    expect(
      parseUrl("?layers=references,blocks,blocks,structure", aliases).layers
    ).toEqual(["structure", "blocks", "references"]);
  });
});

describe("serialiseUrl", () => {
  const roundTrips = (state: UrlState) =>
    // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs inside every it() below.
    expect(parseUrl(serialiseUrl(state), aliases)).toEqual(state);

  it("round-trips the default state", () => {
    roundTrips({
      type: null,
      focus: false,
      layers: ["structure"],
      lens: "none",
      view: "city",
      group: "structure",
      dataType: null,
    });
  });

  it("round-trips a focused type with every layer on", () => {
    roundTrips({
      type: "blogPost",
      focus: true,
      layers: [...LAYERS],
      lens: "cultures",
      view: "city",
      group: "structure",
      dataType: null,
    });
  });

  it("round-trips a selection with no layers at all", () => {
    roundTrips({
      type: "home",
      focus: false,
      layers: [],
      lens: "unused",
      view: "city",
      group: "structure",
      dataType: null,
    });
  });

  it("writes the documented shape", () => {
    expect(
      serialiseUrl({
        type: "article",
        focus: true,
        layers: ["structure", "compositions"],
        lens: "count",
        view: "city",
        group: "structure",
        dataType: null,
      })
    ).toBe("?type=article&focus=1&layers=structure,compositions&lens=count");
  });

  it("leaves the focus flag out when there is no type", () => {
    expect(
      serialiseUrl({
        type: null,
        focus: true,
        layers: [],
        lens: "none",
        view: "city",
        group: "structure",
        dataType: null,
      })
    ).toBe("?layers=");
  });
});

describe("urlToWrite", () => {
  const workspace = "/umbraco/section/settings/workspace/schema-city";
  const editor =
    "/umbraco/section/settings/workspace/document-type/edit/a-guid";
  const state: UrlState = {
    type: "elementForm",
    focus: false,
    layers: ["structure"],
    lens: "none",
    view: "city",
    group: "structure",
    dataType: null,
  };

  it("writes the query onto the route the app was mounted under", () => {
    expect(urlToWrite(state, workspace, workspace)).toBe(
      `${workspace}?type=elementForm&layers=structure`
    );
  });

  it("writes nothing once Open in editor has pushed the editor route", () => {
    expect(urlToWrite(state, workspace, editor)).toBeNull();
  });
});

describe("the grouping", () => {
  it("reads folders, reads anything else as structure, and writes only folders", () => {
    expect(parseUrl("?group=folders", aliases).group).toBe("folders");
    expect(parseUrl("?group=rings", aliases).group).toBe("structure");
    expect(parseUrl("", aliases).group).toBe("structure");
    expect(
      serialiseUrl({
        type: null,
        focus: false,
        layers: ["structure"],
        lens: "none",
        view: "city",
        group: "folders",
        dataType: null,
      })
    ).toBe("?layers=structure&group=folders");
  });
});

describe("the view", () => {
  it("reads and writes the list view, and leaves the city out", () => {
    expect(parseUrl("?view=list", aliases).view).toBe("list");
    expect(parseUrl("?view=tree", aliases).view).toBe("tree");
    expect(parseUrl("?view=matrix", aliases).view).toBe("matrix");
    expect(parseUrl("?view=editor", aliases).view).toBe("editor");
    // The old camera modes are angles on the city, so their links open the city.
    expect(parseUrl("?view=top", aliases).view).toBe("city");
    expect(parseUrl("?view=explore", aliases).view).toBe("city");
    expect(parseUrl("?view=orbit", aliases).view).toBe("city");
    expect(
      serialiseUrl({
        type: null,
        focus: false,
        layers: ["structure"],
        lens: "none",
        view: "list",
        group: "structure",
        dataType: null,
      })
    ).toBe("?layers=structure&view=list");
  });

  it("carries the chosen Data Type, but only while the Data Types view is on", () => {
    const at = parseUrl("?view=datatypes&dataType=a-key", aliases);
    expect([at.view, at.dataType]).toEqual(["datatypes", "a-key"]);
    expect(serialiseUrl({ ...at, view: "datatypes" })).toBe(
      "?layers=structure&view=datatypes&dataType=a-key"
    );
    expect(serialiseUrl({ ...at, view: "list" })).toBe(
      "?layers=structure&view=list"
    );
  });
});
