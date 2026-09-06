import type { Finding } from "./findings";
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
 * A portable snapshot of the findings currently visible to the developer. The
 * usage line is deliberately explicit because graph-only findings can be exported
 * while the slower usage request is still unavailable.
 */
export function findingsCsv(
  findings: Finding[],
  graph: SchemaGraph,
  usage?: UsageReport
): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const related = (finding: Finding) =>
    [...new Set(finding.related ?? [])]
      .map((id) => nodes.get(id)?.alias ?? `missing:${id}`)
      .join(" | ");
  const lines = [
    ["Schema City findings", "snapshot"].map(csv).join(","),
    ["Schema generated at", graph.generatedAt].map(csv).join(","),
    [
      "Usage snapshot",
      usage?.generatedAt ?? "unavailable; usage-dependent findings omitted",
    ]
      .map(csv)
      .join(","),
    "",
    ["Type", "Alias", "Severity", "Finding", "Summary", "Related"]
      .map(csv)
      .join(","),
    ...findings.map((finding) => {
      const node = nodes.get(finding.nodeId);
      return [
        node?.name ?? "deleted type",
        node?.alias ?? finding.nodeId,
        finding.severity,
        finding.kind,
        finding.summary,
        related(finding),
      ]
        .map(csv)
        .join(",");
    }),
  ];
  return `${lines.join("\n")}\n`;
}
