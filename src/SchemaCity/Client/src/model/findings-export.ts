import { dayOf } from "./dates";
import {
  FINDING_LABEL,
  type Finding,
  type FindingKind,
  KIND_EXPLANATION,
  KIND_NEXT_STEP,
} from "./findings";
import type { SchemaGraph, UsageReport } from "./types";

const FORMULA = /^\s*[=+\-@]/;
const QUOTED = /[",\n\r]/;
const QUOTE = /"/g;

const csv = (value: string | number) => {
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
];

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

  const rows = findings.map((finding) => {
    const node = nodes.get(finding.nodeId);
    const counts = usage?.byType[finding.nodeId];
    return [
      FINDING_LABEL[finding.kind],
      finding.kind,
      finding.severity,
      node?.name ?? "deleted type",
      node?.alias ?? "",
      finding.nodeId,
      folderPath(node?.folderId ?? null),
      counts?.total ?? "",
      counts?.published ?? "",
      counts?.drafts ?? "",
      counts?.trashed ?? "",
      dayOf(counts?.lastEdited) ?? "",
      `/umbraco/section/settings/workspace/document-type/edit/${finding.nodeId}`,
      finding.summary,
      KIND_EXPLANATION[finding.kind],
      KIND_NEXT_STEP[finding.kind],
      related(finding),
      branchRoot.get(finding.nodeId) ?? "",
      filter,
      schemaDate,
      usageDate,
    ];
  });
  return `${[HEADER, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`;
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
    findings
      .filter((finding) => finding.kind === "unusedType")
      .map((finding) => finding.nodeId)
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

  const roots = new Map<string, string>();
  for (const id of unused) {
    const seen = new Set([id]);
    const tops: string[] = [];
    for (let frontier = [id]; frontier.length > 0; ) {
      const next: string[] = [];
      for (const at of frontier) {
        const up = parents.get(at) ?? [];
        if (up.length === 0) tops.push(at);
        for (const parent of up)
          if (!seen.has(parent)) {
            seen.add(parent);
            next.push(parent);
          }
      }
      frontier = next;
    }
    // A ring of unused types has no top; any member of it stands for the branch.
    const names = (tops.length > 0 ? tops : [...seen]).map(
      (top) => nameOf.get(top) ?? top
    );
    roots.set(id, names.sort((a, b) => a.localeCompare(b))[0] ?? "");
  }
  return roots;
}
