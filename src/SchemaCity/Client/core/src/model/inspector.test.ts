import { describe, expect, it } from "vitest";
import {
  chips,
  connectionGroups,
  contentCountOf,
  directUsageRows,
  emptyKindsLine,
  observedReferences,
  roleOf,
  usageLine,
  usageState,
} from "./inspector";
import { neighbourhoods } from "./neighbourhood";
import type { SchemaEdge, SchemaNode, TypeUsage, UsageReport } from "./types";

const node = (alias: string, extra: Partial<SchemaNode> = {}): SchemaNode => ({
  id: alias,
  alias,
  name: alias,
  icon: "icon-document",
  iconColor: null,
  folderId: null,
  isElement: false,
  allowedAsRoot: false,
  variesByCulture: false,
  variesBySegment: false,
  description: null,
  groups: [],
  ownPropertyCount: 0,
  composedPropertyCount: 0,
  templates: [],
  ...extra,
});

const around = (nodes: SchemaNode[], edges: SchemaEdge[], id: string) => {
  const found = neighbourhoods({
    generatedAt: "",
    folders: [],
    nodes,
    edges,
  }).get(id);
  if (!found) throw new Error(id);
  return found;
};

const used = (total: number, published = total): TypeUsage => ({
  total,
  published,
  drafts: total - published,
  trashed: 0,
  rootInstances: 0,
  cultures: [],
  lastEdited: null,
});

const report = (
  byType: Record<string, TypeUsage>,
  references: UsageReport["references"] = []
): UsageReport => ({ generatedAt: "", byType, references });

const seo = [node("seo"), node("a"), node("b"), node("c")];
const seoEdges: SchemaEdge[] = ["a", "b", "c"].map((from) => ({
  kind: "composition",
  from,
  to: "seo",
}));

const line = (...args: Parameters<typeof usageState>) =>
  usageLine(usageState(...args));

describe("usageLine", () => {
  const lone = node("x");
  const plain = around([lone], [], "x");
  const seoNode = seo[0] as SchemaNode;

  it("says when the usage report has not arrived", () => {
    expect(line(lone, plain, undefined, undefined)).toBe(
      "Content usage has not loaded yet"
    );
  });

  it("counts a type's own content", () => {
    expect(line(lone, plain, report({}), used(162, 152))).toBe(
      "162 content items, 152 published"
    );
    expect(line(lone, plain, report({}), used(1))).toBe(
      "1 content item, 1 published"
    );
    expect(
      line(lone, plain, report({}), { ...used(162, 152), trashed: 5 })
    ).toBe("162 content items, 152 published, including 5 trashed");
  });

  it("says a type with no content has none", () => {
    expect(line(lone, plain, report({}), undefined)).toBe(
      "No content items yet"
    );
  });

  it("does not count an Element Type as content", () => {
    const block = node("block", { isElement: true });
    expect(
      line(block, around([block], [], "block"), report({}), undefined)
    ).toBe("Element Types live inside block values, not as content items");
  });

  it("sums a composition's content over the types that use it", () => {
    const usage = report({ a: used(160), b: used(28, 18), c: used(0) });
    expect(line(seoNode, around(seo, seoEdges, "seo"), usage, undefined)).toBe(
      "No content of its own. 188 items through 2 of the 3 types that use it"
    );
    expect(
      line(seoNode, around(seo, seoEdges, "seo"), report({}), undefined)
    ).toBe("No content of its own, and none through the 3 types that use it");
  });
});

describe("usageLine through inheritance", () => {
  it("counts a type that inherits a composition's user", () => {
    const nodes = [node("seo"), node("article"), node("press")];
    const edges: SchemaEdge[] = [
      { kind: "composition", from: "article", to: "seo" },
      { kind: "inherits", from: "press", to: "article" },
      { kind: "composition", from: "press", to: "article" },
    ];
    expect(
      line(
        nodes[0] as SchemaNode,
        around(nodes, edges, "seo"),
        report({ article: used(10), press: used(5) }),
        undefined
      )
    ).toBe(
      "No content of its own. 15 items through 2 of the 2 types that use it"
    );
  });
});

describe("directUsageRows", () => {
  it("prints the date half of the last edit and none for no cultures", () => {
    expect(
      directUsageRows({
        ...used(3, 2),
        cultures: [],
        lastEdited: "2026-09-03T10:00:00Z",
      })
    ).toContainEqual(["Last edited", "2026-09-03"]);
    expect(directUsageRows(used(3))).toContainEqual(["Cultures", "none"]);
    expect(directUsageRows(used(3))).toContainEqual(["Last edited", "never"]);
    expect(
      directUsageRows({ ...used(3), lastEdited: "1970-01-01T00:00:00" })
    ).toContainEqual(["Last edited", "unknown"]);
  });
});

describe("roleOf", () => {
  it("calls a composed type that cannot be created a composition", () => {
    expect(roleOf(seo[0] as SchemaNode, around(seo, seoEdges, "seo"))).toBe(
      "composition"
    );
  });

  it("keeps a composed type that is allowed somewhere a page", () => {
    const nodes = [node("article"), node("press"), node("news")];
    const edges: SchemaEdge[] = [
      { kind: "composition", from: "press", to: "article" },
      { kind: "allowedChild", from: "news", to: "article" },
    ];
    expect(
      roleOf(nodes[0] as SchemaNode, around(nodes, edges, "article"))
    ).toBe("page");
  });

  it("calls an element an element", () => {
    const block = node("block", { isElement: true });
    expect(roleOf(block, around([block], [], "block"))).toBe("element");
  });
});

describe("chips", () => {
  it("sorts by content count, then name, with missing types last", () => {
    const nodesById = new Map(
      ["beta", "alpha", "gamma"].map((alias) => [alias, node(alias)])
    );
    const counts: Record<string, number> = { gamma: 5 };
    expect(
      chips(["gone", "beta", "alpha", "gamma"], nodesById, (id) => counts[id])
    ).toEqual([
      { id: "gamma", name: "gamma", count: 5 },
      { id: "alpha", name: "alpha", count: undefined },
      { id: "beta", name: "beta", count: undefined },
      { id: "gone", name: null, count: undefined },
    ]);
  });
});

describe("contentCountOf", () => {
  const nodesById = new Map([
    ["page", node("page")],
    ["block", node("block", { isElement: true })],
  ]);

  it("counts nothing before the report arrives and nothing for Element Types", () => {
    expect(contentCountOf(undefined, nodesById, [])("page")).toBeUndefined();
    const count = contentCountOf(report({ block: used(0) }), nodesById, []);
    expect(count("page")).toBe(0);
    expect(count("block")).toBeUndefined();
  });

  it("counts a composition only when it can also be created", () => {
    const types = new Map([
      ["seo", node("seo")],
      ["article", node("article")],
      ["home", node("home")],
      ["rooted", node("rooted", { allowedAsRoot: true })],
    ]);
    const edges: SchemaEdge[] = [
      { kind: "composition", from: "home", to: "seo" },
      { kind: "composition", from: "home", to: "article" },
      { kind: "allowedChild", from: "home", to: "article" },
      { kind: "composition", from: "home", to: "rooted" },
    ];
    const count = contentCountOf(report({ article: used(4) }), types, edges);
    expect(count("seo")).toBeUndefined();
    expect(count("article")).toBe(4);
    expect(count("rooted")).toBe(0);
    expect(count("home")).toBe(0);
  });
});

describe("connectionGroups", () => {
  const press = node("press", {
    groups: [
      {
        id: "g",
        alias: "content",
        name: "Content",
        type: "Group",
        parentAlias: null,
        fromCompositionId: null,
        properties: [
          {
            alias: "body",
            name: "Body",
            dataTypeId: "d",
            dataTypeName: "Body Blocks",
            editorAlias: "Umbraco.BlockList",
            editorUiAlias: null,
            mandatory: false,
            variesByCulture: false,
            fromCompositionId: null,
            targets: [],
          },
          {
            alias: "links",
            name: "Links",
            dataTypeId: "d2",
            dataTypeName: null,
            editorAlias: "Umbraco.MultiNodeTreePicker",
            editorUiAlias: null,
            mandatory: false,
            variesByCulture: false,
            fromCompositionId: null,
            targets: [],
          },
        ],
      },
    ],
  });
  const nodes = [press, node("article"), node("seo"), node("news")];
  const edges: SchemaEdge[] = [
    { kind: "inherits", from: "press", to: "article" },
    { kind: "composition", from: "press", to: "article" },
    { kind: "composition", from: "press", to: "seo" },
    { kind: "allowedChild", from: "news", to: "press" },
    { kind: "block", from: "press", to: "quote", propertyAlias: "body" },
    { kind: "block", from: "press", to: "image", propertyAlias: "body" },
    { kind: "reference", from: "press", to: "news", propertyAlias: "links" },
  ];
  const groups = connectionGroups(press, around(nodes, edges, "press"));

  it("lists a composition's indirect users with the type they come through", () => {
    const seoGroups = connectionGroups(
      node("seo"),
      around(
        [...nodes, node("home")],
        [
          ...edges.filter((edge) => edge.to !== "seo"),
          { kind: "composition", from: "article", to: "seo" },
        ],
        "seo"
      )
    );
    const composedBy = seoGroups.find((group) => group.kind === "composedBy");
    expect(composedBy).toMatchObject({ count: 2, ids: ["article", "press"] });
    const byId = new Map([...nodes].map((n) => [n.id, n]));
    expect(
      chips(
        ["article", "press"],
        byId,
        () => undefined,
        composedBy && "via" in composedBy ? composedBy.via : undefined
      )
    ).toEqual([
      { id: "article", name: "article", count: undefined },
      { id: "press", name: "press", count: undefined, through: "article" },
    ]);
  });

  it("lists the parent under Inherits only", () => {
    const find = (kind: string) => groups.find((group) => group.kind === kind);
    expect(find("inherits")).toMatchObject({ ids: ["article"] });
    expect(find("compositions")).toMatchObject({ ids: ["seo"] });
  });

  it("groups block and picker targets by property with the Data Type", () => {
    expect(groups.find((group) => group.kind === "blockTargets")).toMatchObject(
      {
        count: 2,
        fields: [
          {
            propertyAlias: "body",
            dataType: "Body Blocks",
            ids: ["image", "quote"],
          },
        ],
      }
    );
    expect(
      groups.find((group) => group.kind === "referencesOut")
    ).toMatchObject({
      fields: [{ dataType: "Umbraco.MultiNodeTreePicker" }],
    });
  });

  it("orders groups structure first", () => {
    expect(groups.map((group) => group.kind)).toEqual([
      "allowedParents",
      "inherits",
      "compositions",
      "blockTargets",
      "referencesOut",
    ]);
  });

  it("names the kinds the type has none of", () => {
    expect(emptyKindsLine(press, groups)).toBe(
      "No allowed children, types that compose it or pickers that allow it."
    );
    const lone = node("lone", { isElement: true });
    expect(emptyKindsLine(lone, [])).toBe(
      "No compositions, types that compose it, block targets, block editors that use it, picker references or pickers that allow it."
    );
  });
});

describe("observedReferences", () => {
  it("sums references by the type on the other end, most first", () => {
    const nodesById = new Map(
      ["home", "news", "post"].map((alias) => [alias, node(alias)])
    );
    const usage = report({}, [
      { fromType: "home", toType: "news", count: 2 },
      { fromType: "home", toType: "post", count: 7 },
      { fromType: "post", toType: "home", count: 3 },
    ]);
    expect(observedReferences("home", usage, nodesById)).toEqual({
      out: [
        { id: "post", name: "post", count: 7 },
        { id: "news", name: "news", count: 2 },
      ],
      in: [{ id: "post", name: "post", count: 3 }],
    });
  });
});
