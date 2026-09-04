// The findings drawer's whole content, derived from the graph and, for the rules
// that need it, the usage report. Pure: no DOM, no React, no three.js.
//
// Every rule is one pass over the nodes with a few edge counts prepared first, so
// the whole set is cheap enough to recompute whenever either input changes.
import type { SchemaGraph, SchemaNode, UsageReport } from "./types";

export type FindingKind =
  | "unusedType"
  | "unusedElementType"
  | "deadEnd"
  | "duplicateAlias"
  | "brokenBlock"
  | "noProperties"
  | "noTemplate"
  | "pureMixin"
  | "complexity";

export type FindingSeverity = "problem" | "note";

export type Finding = {
  /** `kind:nodeId`, stable across runs so a row can be linked to. */
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  /** The type the finding is about, and the one a row selects. */
  nodeId: string;
  summary: string;
  /**
   * The other types the finding names. A broken block reference puts the missing
   * Element Type key here, which by definition resolves to no node.
   */
  related?: string[];
};

/** Chip order in the drawer, problems first. */
export const FINDING_KINDS: readonly FindingKind[] = [
  "unusedType",
  "unusedElementType",
  "deadEnd",
  "duplicateAlias",
  "brokenBlock",
  "noProperties",
  "noTemplate",
  "pureMixin",
  "complexity",
];

export const FINDING_LABEL: Record<FindingKind, string> = {
  unusedType: "Unused type",
  unusedElementType: "Unused Element Type",
  deadEnd: "Dead end",
  duplicateAlias: "Duplicate alias",
  brokenBlock: "Broken block",
  noProperties: "No properties",
  noTemplate: "No template",
  pureMixin: "Pure mixin",
  complexity: "Complexity",
};

const SEVERITY: Record<FindingKind, FindingSeverity> = {
  unusedType: "problem",
  unusedElementType: "problem",
  deadEnd: "problem",
  duplicateAlias: "problem",
  brokenBlock: "problem",
  noProperties: "problem",
  noTemplate: "note",
  pureMixin: "note",
  complexity: "note",
};

/** Rules that say nothing without a usage report, and are skipped without one. */
const NEEDS_USAGE: ReadonlySet<FindingKind> = new Set<FindingKind>([
  "unusedType",
]);

/** How many complexity tiers the scores are cut into. Only the top one is a finding. */
const COMPLEXITY_TIERS = 5;

/** `own + composed properties + 2 * compositions + distinct block targets`. */
function complexityScore(
  node: SchemaNode,
  compositions: number,
  blockTargets: number
): number {
  return (
    node.ownPropertyCount +
    node.composedPropertyCount +
    2 * compositions +
    blockTargets
  );
}

const counter = () => new Map<string, number>();
const bump = (map: Map<string, number>, key: string) =>
  map.set(key, (map.get(key) ?? 0) + 1);
const at = (map: Map<string, number>, key: string) => map.get(key) ?? 0;

/**
 * Every finding the graph supports, sorted problems first, then by the chip order,
 * then by the type's alias, so two runs on the same input list the same rows in the
 * same order.
 *
 * Without `usage` the rules that ask how much content exists are left out rather
 * than guessed at. `findFindings(graph)` is the set the city can show while the
 * usage endpoint is still in flight.
 */
export function findFindings(
  graph: SchemaGraph,
  usage?: UsageReport
): Finding[] {
  const { nodes } = graph;
  const known = new Set(nodes.map((node) => node.id));
  const edges = graph.edges ?? [];

  const inChild = counter();
  const inComposition = counter();
  const inBlock = counter();
  const outComposition = counter();
  const blockTargets = new Map<string, Set<string>>();
  const composedBy = new Map<string, string[]>();
  // Host id to the Element Type keys its block editors name and the graph does not
  // have, with the property alias that names each one.
  const missingBlocks = new Map<
    string,
    { propertyAlias: string; to: string }[]
  >();

  for (const edge of edges) {
    switch (edge.kind) {
      case "allowedChild":
        bump(inChild, edge.to);
        break;
      case "composition":
        bump(inComposition, edge.to);
        bump(outComposition, edge.from);
        composedBy.set(edge.to, [
          ...(composedBy.get(edge.to) ?? []),
          edge.from,
        ]);
        break;
      case "block": {
        if (!known.has(edge.to)) {
          const found = missingBlocks.get(edge.from) ?? [];
          found.push({ propertyAlias: edge.propertyAlias ?? "", to: edge.to });
          missingBlocks.set(edge.from, found);
          break;
        }
        bump(inBlock, edge.to);
        // Two properties pointing at the same Element Type are one target, the same
        // way the scene draws them as one line.
        const targets = blockTargets.get(edge.from) ?? new Set<string>();
        targets.add(edge.to);
        blockTargets.set(edge.from, targets);
        break;
      }
      default:
        break;
    }
  }

  const scores = new Map(
    nodes.map((node) => [
      node.id,
      complexityScore(
        node,
        at(outComposition, node.id),
        blockTargets.get(node.id)?.size ?? 0
      ),
    ])
  );
  const topScore = Math.max(0, ...scores.values());
  // Tiers are cut from the graph's own busiest type, because "complex" only means
  // anything next to the rest of this schema.
  const topTier = (topScore * (COMPLEXITY_TIERS - 1)) / COMPLEXITY_TIERS;

  const totalOf = (id: string) => usage?.byType[id]?.total ?? 0;
  const anyTemplates = nodes.some((node) => node.templates.length > 0);
  const found: Finding[] = [];
  const add = (
    kind: FindingKind,
    node: SchemaNode,
    summary: string,
    related?: string[]
  ) => {
    if (!usage && NEEDS_USAGE.has(kind)) return;
    found.push({
      id: `${kind}:${node.id}`,
      kind,
      severity: SEVERITY[kind],
      nodeId: node.id,
      summary,
      ...(related && related.length > 0 ? { related } : {}),
    });
  };

  for (const node of nodes) {
    const children = at(inChild, node.id);
    const composers = at(inComposition, node.id);
    const creatable = node.allowedAsRoot || children > 0;

    if (!node.isElement && usage && totalOf(node.id) === 0) {
      add("unusedType", node, "No content of this type exists");
    }

    if (node.isElement && at(inBlock, node.id) === 0) {
      add("unusedElementType", node, "No block editor uses this Element Type");
    }

    // A type nothing composes and nothing can create is a structural dead end, and
    // this one row says so. A type something composes is a mixin doing its job, so
    // it is never a dead end; the pure mixin note below covers it instead.
    if (!(node.isElement || creatable) && composers === 0) {
      add(
        "deadEnd",
        node,
        "No root, no allowed parent, not an element, and nothing composes it"
      );
    }

    const duplicates = duplicateAliases(node);
    if (duplicates.length > 0) {
      add(
        "duplicateAlias",
        node,
        `${duplicates.map((duplicate) => duplicate.alias).join(", ")} arrives from more than one place, which breaks editing`,
        duplicates.flatMap((duplicate) => duplicate.origins)
      );
    }

    const broken = missingBlocks.get(node.id);
    if (broken) {
      const aliases = [
        ...new Set(broken.map((block) => block.propertyAlias)),
      ].join(", ");
      add(
        "brokenBlock",
        node,
        `${aliases || "A block editor"} points at ${broken.length} Element Type${broken.length === 1 ? "" : "s"} that no longer exist${broken.length === 1 ? "s" : ""}`,
        broken.map((block) => block.to)
      );
    }

    if (node.ownPropertyCount + node.composedPropertyCount === 0) {
      add("noProperties", node, "No own and no composed properties");
    }

    // Only worth saying on a schema that uses templates at all, and only about a
    // type an editor can actually create. A headless site has no templates
    // anywhere, and a composition renders through its users, not on its own.
    if (
      anyTemplates &&
      creatable &&
      !node.isElement &&
      node.templates.length === 0
    ) {
      add("noTemplate", node, "No template is allowed, so it renders nothing");
    }

    if (composers > 0 && !creatable && at(inBlock, node.id) === 0) {
      add(
        "pureMixin",
        node,
        `Composed by ${composers} type${composers === 1 ? "" : "s"}, and never created on its own`,
        composedBy.get(node.id)
      );
    }

    const score = scores.get(node.id) ?? 0;
    if (topScore > 0 && score >= topTier) {
      add(
        "complexity",
        node,
        `Complexity ${score}, the top tier of ${COMPLEXITY_TIERS} in this schema`
      );
    }
  }

  const aliasOf = new Map(nodes.map((node) => [node.id, node.alias]));
  const rank = (finding: Finding) => FINDING_KINDS.indexOf(finding.kind);
  return found.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "problem" ? -1 : 1) ||
      rank(a) - rank(b) ||
      (aliasOf.get(a.nodeId) ?? "").localeCompare(aliasOf.get(b.nodeId) ?? "")
  );
}

/**
 * Property aliases the type gets from more than one place, with the compositions
 * they came from. Umbraco lets two compositions contribute the same alias, and the
 * editor that results cannot save both values.
 */
function duplicateAliases(node: SchemaNode) {
  const origins = new Map<string, Set<string>>();
  for (const group of node.groups ?? []) {
    for (const property of group.properties) {
      const seen = origins.get(property.alias) ?? new Set<string>();
      // Own properties have no composition to name, so they are their own origin.
      seen.add(property.fromCompositionId ?? node.id);
      origins.set(property.alias, seen);
    }
  }
  return [...origins]
    .filter(([, from]) => from.size > 1)
    .map(([alias, from]) => ({ alias, origins: [...from] }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
