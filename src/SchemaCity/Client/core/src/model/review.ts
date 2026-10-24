// Review decisions: a team's record that a finding is intentional, tied to the
// fingerprint of what the finding is about so a later schema change reopens it.
// Pure: the stores that load and save them live with the wrappers.
import {
  FINDING_LABEL,
  type Finding,
  type FindingSeverity,
  problemLabels,
} from "./findings";
import type { SchemaGraph } from "./types";

/** One decision, as the decisions endpoint returns it. Mirrors ReviewDecision in Models/. */
export type Decision = {
  findingId: string;
  status: "intentional";
  reason: string;
  decidedBy: string;
  decidedByKey: string;
  decidedAt: string;
  /** The subject's fingerprint when the decision was made. */
  fingerprint: string;
};

/**
 * Where decisions are kept: the decisions endpoint in the backoffice, memory in the
 * harness. Every call rejects with an Error whose message says what failed.
 */
export type DecisionStore = {
  load: () => Promise<Decision[]>;
  save: (
    findingId: string,
    reason: string,
    fingerprint: string
  ) => Promise<Decision>;
  remove: (findingId: string) => Promise<void>;
};

/**
 * What a failed decision call says. No status means the server did not answer; a
 * 401 or 403 means the user lacks Settings access, which the endpoints require.
 * Otherwise the server's own problem title, which says what to do.
 */
export function failureMessage(doing: string, status?: number, title?: string) {
  if (status === undefined)
    return `${doing} failed: the server did not answer.`;
  if (status === 401 || status === 403)
    return `${doing} failed: you need access to the Settings section to review findings.`;
  return `${doing} failed: ${title ?? `the server answered ${status}.`}`;
}

/** The longest reason the server accepts. */
export const MAX_REASON = 500;

/** A finding's decision, and whether its subject has changed since. */
export type Review = { decision: Decision; reopened: boolean };

/**
 * The fingerprint of what a finding is about: its type, or for a finding about a
 * Data Type alone, that Data Type. Empty for a graph without fingerprints, such as
 * a fixture, where a decision then never reopens.
 */
export function subjectFingerprints(graph: SchemaGraph) {
  const prints = new Map<string, string>();
  for (const node of graph.nodes) prints.set(node.id, node.fingerprint ?? "");
  for (const dataType of graph.dataTypes ?? [])
    prints.set(dataType.id, dataType.fingerprint ?? "");
  return (finding: Finding) =>
    prints.get(finding.nodeId ?? finding.dataTypeIds?.[0] ?? "") ?? "";
}

/**
 * Each current finding's review, by finding id. A decision about a finding that is
 * gone is left out; a decision whose subject has a new fingerprint is reopened.
 */
export function reviewsOf(
  findings: Finding[],
  decisions: Decision[],
  graph: SchemaGraph
): Map<string, Review> {
  const fingerprintOf = subjectFingerprints(graph);
  const byId = new Map(
    decisions.map((decision) => [decision.findingId, decision])
  );
  const reviews = new Map<string, Review>();
  for (const finding of findings) {
    const decision = byId.get(finding.id);
    if (decision)
      reviews.set(finding.id, {
        decision,
        reopened: decision.fingerprint !== fingerprintOf(finding),
      });
  }
  return reviews;
}

/** Decided and still current. A reopened finding counts as open. */
export const isReviewed = (review: Review | undefined) =>
  review !== undefined && !review.reopened;

/** A finding's review, as the Reviews context looks it up. */
export type ReviewOf = (finding: Finding) => Review | undefined;

/**
 * Findings in two piles, each in its original order: the open ones, reopened
 * included, and the reviewed ones. Without decisions every finding is open.
 */
export function splitReviewed(findings: Finding[], reviewOf?: ReviewOf) {
  const open: Finding[] = [];
  const reviewed: Finding[] = [];
  for (const finding of findings)
    (isReviewed(reviewOf?.(finding)) ? reviewed : open).push(finding);
  return { open, reviewed };
}

/**
 * The dot beside a name: its colour, whether it is the quiet reviewed one, and the
 * title and spoken label that say why.
 */
export type FindingMark = {
  severity: FindingSeverity;
  reviewed: boolean;
  title: string;
};

const labelsOf = (findings: Finding[]) =>
  [...new Set(findings.map((finding) => FINDING_LABEL[finding.kind]))].join(
    ", "
  );

/**
 * The dot for one subject's findings, or undefined for none. Open findings decide
 * it, so a reviewed problem never turns a dot pink. Only reviewed findings left
 * gives the quiet dot, whose words say they are reviewed, so the reason a row is
 * marked is never only its colour.
 */
export function findingMark(
  findings: Finding[],
  reviewOf?: ReviewOf
): FindingMark | undefined {
  const { open, reviewed } = splitReviewed(findings, reviewOf);
  if (open.length > 0)
    return {
      severity: open.some((finding) => finding.severity === "problem")
        ? "problem"
        : "note",
      reviewed: false,
      title: labelsOf(open),
    };
  if (reviewed.length === 0) return undefined;
  return {
    severity: "note",
    reviewed: true,
    title: `Reviewed: ${labelsOf(reviewed)}`,
  };
}

/**
 * The List's and Tree's dot per type, which only problems earn. A type whose every
 * problem is reviewed keeps a quiet dot, so it still reads as looked at, not clean.
 */
export function problemMarks(
  findings: Finding[],
  reviewOf?: ReviewOf
): Map<string, FindingMark> {
  const { open, reviewed } = splitReviewed(findings, reviewOf);
  const marks = new Map<string, FindingMark>();
  for (const [id, title] of problemLabels(reviewed))
    marks.set(id, {
      severity: "note",
      reviewed: true,
      title: `Reviewed: ${title}`,
    });
  for (const [id, title] of problemLabels(open))
    marks.set(id, { severity: "problem", reviewed: false, title });
  return marks;
}

/**
 * What the inspector's Overview tab counts: open checks only, with the open
 * problems that earn its "!", and the reviewed ones said apart.
 */
export function checkCounts(findings: Finding[], reviewOf?: ReviewOf) {
  const { open, reviewed } = splitReviewed(findings, reviewOf);
  return {
    open: open.length,
    problems: open.filter((finding) => finding.severity === "problem").length,
    reviewed: reviewed.length,
  };
}
