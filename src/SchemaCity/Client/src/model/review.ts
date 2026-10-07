// Review decisions: a team's record that a finding is intentional, tied to the
// fingerprint of what the finding is about so a later schema change reopens it.
// Pure: the stores that load and save them live with the wrappers.
import type { Finding } from "./findings";
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
