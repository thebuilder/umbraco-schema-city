import { describe, expect, it } from "vitest";
import mediumFixture from "../../../dev/fixtures/medium.json";
import mediumUsageFixture from "../../../dev/fixtures/medium-usage.json";
import type {
  SchemaGraph,
  SchemaNode,
  TypeUsage,
  UsageReport,
} from "../../model/types";
import { lensScale, usageBadge } from "./lens";

const medium = mediumFixture as unknown as SchemaGraph;
const mediumUsage = mediumUsageFixture as unknown as UsageReport;
const idOf = (alias: string) =>
  medium.nodes.find((node) => node.alias === alias)?.id as string;

const node = (alias: string, isElement = false): SchemaNode => ({
  id: alias,
  alias,
  name: alias,
  icon: "icon-document",
  iconColor: null,
  folderId: null,
  isElement,
  allowedAsRoot: false,
  variesByCulture: false,
  variesBySegment: false,
  description: null,
  groups: [],
  ownPropertyCount: 0,
  composedPropertyCount: 0,
  templates: [],
});

const graph: SchemaGraph = {
  generatedAt: "2026-09-03T00:00:00Z",
  folders: [],
  nodes: [node("home"), node("article"), node("empty"), node("hero", true)],
  edges: [],
};

const use = (extra: Partial<TypeUsage>): TypeUsage => ({
  total: 0,
  published: 0,
  drafts: 0,
  trashed: 0,
  rootInstances: 0,
  cultures: [],
  lastEdited: null,
  ...extra,
});

const usage: UsageReport = {
  generatedAt: "2026-09-03T00:00:00Z",
  byType: {
    home: use({ total: 100, published: 100, cultures: ["en-US", "da-DK"] }),
    article: use({ total: 20, published: 5, cultures: ["en-US"] }),
    empty: use({}),
  },
  references: [
    { fromType: "home", toType: "article", count: 12 },
    { fromType: "article", toType: "article", count: 3 },
  ],
};

describe("lensScale", () => {
  it("says nothing with no lens and nothing with no usage", () => {
    expect(lensScale(graph, usage, "none")).toBeNull();
    expect(lensScale(graph, undefined, "count")).toBeNull();
  });

  it("stretches the content count over the values it found", () => {
    const scale = lensScale(graph, usage, "count");
    expect(scale?.ramp).toBe("sequential");
    expect(scale?.t.get("home")).toBe(1);
    expect(scale?.t.get("article")).toBeCloseTo(0.2);
    expect(scale?.t.get("empty")).toBe(0);
    expect([scale?.minLabel, scale?.maxLabel]).toEqual(["0", "100"]);
  });

  it("leaves Element Types out of every lens about content", () => {
    for (const lens of [
      "count",
      "published",
      "cultures",
      "references",
    ] as const) {
      expect(lensScale(graph, usage, lens)?.t.has("hero")).toBe(false);
    }
  });

  it("puts the published share on a diverging ramp and skips empty types", () => {
    const scale = lensScale(graph, usage, "published");
    expect(scale?.ramp).toBe("diverging");
    expect(scale?.t.get("home")).toBe(1);
    expect(scale?.t.get("article")).toBeCloseTo(0.25);
    expect(scale?.t.has("empty")).toBe(false);
  });

  it("counts cultures", () => {
    const scale = lensScale(graph, usage, "cultures");
    expect(scale?.t.get("home")).toBe(1);
    expect(scale?.t.get("article")).toBeCloseTo(0.5);
    expect(scale?.maxLabel).toBe("2");
  });

  it("adds up the references pointing at a type", () => {
    const scale = lensScale(graph, usage, "references");
    expect(scale?.t.get("article")).toBe(1);
    expect(scale?.t.get("home")).toBe(0);
    expect(scale?.maxLabel).toBe("15");
  });

  it("marks the types with no content and dims everything else", () => {
    const scale = lensScale(graph, usage, "unused");
    expect(scale?.ramp).toBe("binary");
    expect(scale?.t.get("empty")).toBe(1);
    expect(scale?.t.get("home")).toBe(0);
    // An Element Type has no content of its own, so it is never called unused here.
    expect(scale?.t.get("hero")).toBe(0);
  });

  it("flattens a ramp where every type has the same number", () => {
    const flat = lensScale({ ...graph, nodes: [node("home")] }, usage, "count");
    expect(flat?.t.get("home")).toBe(0);
    expect([flat?.minLabel, flat?.maxLabel]).toEqual(["100", "100"]);
  });
});

describe("the lenses on the seeded site's usage report", () => {
  it("puts article, with 162 items, at the bright end of the content count", () => {
    const scale = lensScale(medium, mediumUsage, "count");
    expect(scale?.t.get(idOf("article"))).toBe(1);
    expect(scale?.maxLabel).toBe("162");
  });

  it("lights only the two types that vary by culture", () => {
    const scale = lensScale(medium, mediumUsage, "cultures");
    const lit = [...(scale?.t ?? [])]
      .filter(([, t]) => t === 1)
      .map(([id]) => medium.nodes.find((node) => node.id === id)?.alias)
      .sort();
    expect(lit).toEqual(["blogPost", "campaignPage"]);
  });
});

describe("usageBadge", () => {
  it("prints the total and the published count", () => {
    expect(usageBadge(usage, "article")).toBe("20 · 5 published");
  });

  it("says nothing about a type usage has no row for", () => {
    expect(usageBadge(usage, "hero")).toBeNull();
    expect(usageBadge(undefined, "home")).toBeNull();
  });
});
