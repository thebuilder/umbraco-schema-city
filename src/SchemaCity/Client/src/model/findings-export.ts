import { dataTypeIndex } from "./data-types";
import { dayOf } from "./dates";
import {
  FINDING_LABEL,
  type Finding,
  type FindingKind,
  KIND_EXPLANATION,
  KIND_NEXT_STEP,
} from "./findings";
import type { SchemaGraph, TypeUsage, UsageReport } from "./types";

const FORMULA = /^\s*[=+\-@]/;
const QUOTED = /[",\n\r]/;
const QUOTE = /"/g;

export const csv = (value: string | number) => {
  // Prefix formula-like cells so an exported alias or name cannot be evaluated
  // when a developer opens the report in a spreadsheet application.
  const text = String(value);
  const safe = FORMULA.test(text) ? `'${text}` : text;
  return QUOTED.test(safe) ? `"${safe.replace(QUOTE, '""')}"` : safe;
};

/**
 * One header row and one row per finding, so Excel and Jira imports read it as is.
 * The snapshot dates and the filter repeat on every row rather than sitting in a
 * preamble an import would take for data. New columns go on the end, so a sheet
 * built on this order still lines up.
 */
const HEADER = [
  "Kind",
  "Kind code",
  "Severity",
  "Type",
  "Alias",
  "Type key",
  "Folder",
  "Total",
  "Published",
  "Drafts",
  "Trashed",
  "Last edited",
  "Backoffice path",
  "Detail",
  "Explanation",
  "What to do",
  "Related",
  "Unused branch root",
  "Filter",
  "Schema snapshot",
  "Usage snapshot",
  "Data Types",
  "Data Type keys",
];

export const DOCUMENT_TYPE_PATH =
  "/umbraco/section/settings/workspace/document-type/edit/";
const DATA_TYPE_PATH = "/umbraco/section/settings/workspace/data-type/edit/";

/**
 * The findings currently visible to the developer, as CSV. `kinds` is the drawer's
 * filter, empty for every kind. Usage columns stay empty while the usage report is
 * unavailable, and the usage snapshot column says so.
 */
export function findingsCsv(
  findings: Finding[],
  graph: SchemaGraph,
  usage?: UsageReport,
  kinds: FindingKind[] = []
): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const folders = new Map(graph.folders.map((folder) => [folder.id, folder]));
  const folderPath = (id: string | null): string => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (
      let folder = id ? folders.get(id) : undefined;
      folder && !seen.has(folder.id);
      folder = folder.parentId ? folders.get(folder.parentId) : undefined
    ) {
      seen.add(folder.id);
      names.unshift(folder.name);
    }
    return names.join("/");
  };
  const related = (finding: Finding) =>
    [...new Set(finding.related ?? [])]
      .map(
        (id) =>
          nodes.get(id)?.name ??
          `${finding.kind === "brokenBlock" ? "Missing Element Type" : "Missing type"} ${id}`
      )
      .join(" | ");
  const branchRoot = unusedBranchRoots(findings, graph);
  const filter =
    kinds.length === 0
      ? "All kinds"
      : kinds.map((kind) => FINDING_LABEL[kind]).join(" | ");
  const schemaDate = dayOf(graph.generatedAt) ?? "";
  const usageDate = usage ? (dayOf(usage.generatedAt) ?? "") : "unavailable";

  const dataTypes = new Map(
    dataTypeIndex(graph).map((dataType) => [dataType.id, dataType])
  );
  const dataTypeCells = (ids: string[] = []) => [
    ids
      .map((id) => dataTypes.get(id)?.name ?? `Missing Data Type ${id}`)
      .join(" | "),
    ids.join(" | "),
  ];
  // A finding about a Data Type alone has no type, so its type columns stay blank
  // and the path opens the Data Type instead.
  const subjectCells = (finding: Finding) => {
    const id = finding.nodeId;
    if (!id) {
      const dataTypeId = finding.dataTypeIds?.[0] ?? "";
      return [
        "",
        "",
        "",
        dataTypes.get(dataTypeId)?.folder ?? "",
        ...usageCells(undefined),
        `${DATA_TYPE_PATH}${dataTypeId}`,
      ];
    }
    const node = nodes.get(id);
    return [
      ...(node
        ? [node.name, node.alias, id, folderPath(node.folderId)]
        : ["deleted type", "", id, ""]),
      ...usageCells(usage?.byType[id]),
      `${DOCUMENT_TYPE_PATH}${id}`,
    ];
  };

  const rows = findings.map((finding) => [
    FINDING_LABEL[finding.kind],
    finding.kind,
    finding.severity,
    ...subjectCells(finding),
    finding.summary,
    KIND_EXPLANATION[finding.kind],
    KIND_NEXT_STEP[finding.kind],
    related(finding),
    (finding.kind === "unusedType" && branchRoot.get(finding.nodeId ?? "")) ||
      "",
    filter,
    schemaDate,
    usageDate,
    ...dataTypeCells(finding.dataTypeIds),
  ]);
  return `${[HEADER, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`;
}

/** Total, published, drafts, trashed and last edited, or blanks without usage. */
const usageCells = (counts: TypeUsage | undefined) =>
  counts
    ? [
        counts.total,
        counts.published,
        counts.drafts,
        counts.trashed,
        dayOf(counts.lastEdited) ?? "",
      ]
    : ["", "", "", "", ""];

/**
 * The unused ancestors at the top of one unused type's branch, walking up the
 * allowed-parent edges between unused types, cycle safe. A ring of unused types has
 * no top, so every member of it stands for the branch.
 */
function branchTops(id: string, parents: Map<string, string[]>): string[] {
  const seen = new Set([id]);
  const tops: string[] = [];
  for (let frontier = [id]; frontier.length > 0; ) {
    const next: string[] = [];
    for (const at of frontier) {
      const up = parents.get(at) ?? [];
      if (up.length === 0) tops.push(at);
      next.push(...up.filter((parent) => !seen.has(parent)));
      for (const parent of up) seen.add(parent);
    }
    frontier = next;
  }
  return tops.length > 0 ? tops : [...seen];
}

/**
 * For each unused type, the name of its topmost ancestor that is unused too, so a
 * team can file one ticket per unused branch. Walks up the allowed-parent edges,
 * cycle safe. A type with no unused parent is its own root. Several tops, from
 * several unused parents, give the first by name.
 */
function unusedBranchRoots(
  findings: Finding[],
  graph: SchemaGraph
): Map<string, string> {
  const unused = new Set(
    findings.flatMap((finding) =>
      finding.kind === "unusedType" && finding.nodeId ? [finding.nodeId] : []
    )
  );
  const nameOf = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const parents = new Map<string, string[]>();
  for (const edge of graph.edges ?? [])
    if (
      edge.kind === "allowedChild" &&
      edge.from !== edge.to &&
      unused.has(edge.from)
    )
      parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);

  return new Map(
    [...unused].map((id) => [
      id,
      branchTops(id, parents)
        .map((top) => nameOf.get(top) ?? top)
        .sort((a, b) => a.localeCompare(b))[0] ?? "",
    ])
  );
}
