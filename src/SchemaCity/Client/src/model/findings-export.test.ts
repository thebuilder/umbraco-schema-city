import { describe, expect, it } from "vitest";
import { findingsCsv } from "./findings-export";
import type { SchemaGraph } from "./types";

const graph: SchemaGraph = {
  generatedAt: "2026-09-06T10:00:00Z",
  folders: [],
  nodes: [
    {
      id: "page",
      alias: "page",
      name: "Page, root",
      icon: "icon-document",
      iconColor: null,
      folderId: null,
      isElement: false,
      allowedAsRoot: true,
      variesByCulture: false,
      variesBySegment: false,
      description: null,
      groups: [],
      ownPropertyCount: 0,
      composedPropertyCount: 0,
      templates: [],
    },
  ],
  edges: [],
};

describe("findingsCsv", () => {
  it("escapes cell punctuation and preserves missing related keys", () => {
    const output = findingsCsv(
      [
        {
          id: "brokenBlock:page",
          kind: "brokenBlock",
          severity: "problem",
          nodeId: "page",
          summary: "Blocks, settings\nneed review",
          related: ["deleted-key"],
        },
      ],
      graph
    );

    expect(output).toContain(
      '"Page, root",page,problem,brokenBlock,"Blocks, settings\nneed review",missing:deleted-key'
    );
    expect(output).toContain(
      "Usage snapshot,unavailable; usage-dependent findings omitted"
    );
  });

  it("includes the usage snapshot when supplied", () => {
    const usage = {
      generatedAt: "2026-09-06T10:02:00Z",
      byType: {},
      references: [],
    };
    expect(findingsCsv([], graph, usage)).toContain(
      "Usage snapshot,2026-09-06T10:02:00Z"
    );
  });

  it.each(["", "\t", "  ", "\r\n"])(
    "neutralizes formulas after leading whitespace %j",
    (prefix) => {
      const formulaGraph = {
        ...graph,
        nodes: [{ ...graph.nodes[0], name: `${prefix}=HYPERLINK("x")` }],
      };
      expect(
        findingsCsv(
          [
            {
              id: "empty:page",
              kind: "noProperties",
              severity: "problem",
              nodeId: "page",
              summary: "check",
            },
          ],
          formulaGraph
        )
      ).toContain(`"'${prefix}=HYPERLINK(""x"")"`);
    }
  );
});
