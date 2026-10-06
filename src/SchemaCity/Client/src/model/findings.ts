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
  /**
   * What is particular to this row: which types can create it, how many compose
   * it, which aliases clash. What the kind means is in KIND_EXPLANATION, said once.
   */
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

/** How many complexity tiers the scores are cut into. Only the top one is a finding. */
const COMPLEXITY_TIERS = 5;

/** What every finding of a kind means, shown once per group rather than per row. */
export const KIND_EXPLANATION: Record<FindingKind, string> = {
  unusedType:
    "An editor can create these Document Types, but the usage snapshot counts no content of them. Custom code, migrations and external consumers can still depend on a type.",
  unusedElementType:
    "No block editor configuration lists these Element Types. Stored block values and custom code can still use them.",
  deadEnd:
    "Not allowed at root, not allowed under any type, not an Element Type, and nothing composes them, so an editor cannot create content with these types.",
  duplicateAlias:
    "A property alias arrives from more than one composition. The editor that results cannot save both values.",
  brokenBlock:
    "A block editor lists an Element Type that no longer exists in the schema.",
  noProperties: "These types have no own and no composed properties.",
  noTemplate:
    "An editor can create these types, but no template is allowed. Check whether they are meant to render on their own.",
  pureMixin:
    "Used only as compositions and never created on their own. Usually intended; listed so the mixins are easy to find.",
  complexity: `In the highest of ${COMPLEXITY_TIERS} complexity tiers in this schema. The score is own and composed properties, plus twice the compositions, plus distinct block targets.`,
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

  const parentsOf = new Map<string, string[]>();
  const blockHosts = new Set<string>();
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
        parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
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
        blockHosts.add(edge.from);
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
  const creatable = (node: SchemaNode) =>
    node.allowedAsRoot || parentsOf.has(node.id);
  // A schema where most creatable types have no template is headless: the missing
  // template is the design, and one note per type would bury everything else. More
  // than half without a template is the cut, simple enough to say in the README.
  const pages = nodes.filter((node) => !node.isElement && creatable(node));
  const headless =
    pages.filter((node) => node.templates.length === 0).length * 2 >
    pages.length;
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]));
  const names = (ids: string[]) => {
    const shown = ids.slice(0, 3).map((id) => nameOf.get(id) ?? id);
    const rest = ids.length - shown.length;
    return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
  };
  // Without a report the row has nothing usage-based to add, so it says nothing.
  const content = (id: string) => {
    if (!usage) return "";
    const total = totalOf(id);
    return total === 0
      ? "No content in the usage snapshot"
      : `${plural(total, "content item")} in the usage snapshot`;
  };

  const found: Finding[] = [];
  // Inside a kind, rows run strongest case first by this number, then by name. Each
  // rule sets it where it has a reason to; the rest stay at 0 and sort by name.
  const strength = new Map<string, number>();
  const add = (
    kind: FindingKind,
    node: SchemaNode,
    summary: string,
    related?: string[],
    weight = 0
  ) => {
    if (!usage && NEEDS_USAGE.has(kind)) return;
    strength.set(`${kind}:${node.id}`, weight);
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
    const composers = at(inComposition, node.id);
    const canCreate = creatable(node);
    const unused =
      canCreate && !node.isElement && usage && totalOf(node.id) === 0;

    // Only a type an editor can create can have content of its own, so "no content"
    // says nothing about the rest. Those are a dead end or a pure mixin below.
    if (unused) {
      const parents = parentsOf.get(node.id) ?? [];
      // Every place it could be created is itself empty, so the whole branch is
      // unused rather than this one type being passed over. Strongest first.
      const emptyBranch =
        !node.allowedAsRoot && parents.every((id) => totalOf(id) === 0);
      const where = [
        node.allowedAsRoot ? "at root" : "",
        parents.length > 0 ? `under ${names(parents)}` : "",
      ]
        .filter(Boolean)
        .join(" and ");
      add(
        "unusedType",
        node,
        `Allowed ${where}${emptyBranch ? EMPTY_BRANCH(parents.length) : ""}`,
        parents,
        emptyBranch ? 1 : 0
      );
    }

    if (node.isElement && at(inBlock, node.id) === 0) {
      add(
        "unusedElementType",
        node,
        blockHosts.size > 0
          ? `Could be listed by the block editors on ${plural(blockHosts.size, "type")}`
          : "No type in this schema has a block editor"
      );
    }

    // A type nothing composes and nothing can create is a structural dead end, and
    // this one row says so. A type something composes is a mixin doing its job, so
    // it is never a dead end; the pure mixin note below covers it instead.
    if (!(node.isElement || canCreate) && composers === 0) {
      add(
        "deadEnd",
        node,
        content(node.id) ||
          plural(
            node.ownPropertyCount + node.composedPropertyCount,
            "property",
            "properties"
          )
      );
    }

    const duplicates = duplicateAliases(node);
    if (duplicates.length > 0) {
      add(
        "duplicateAlias",
        node,
        duplicates
          .map(({ alias, origins }) => `${alias} from ${names(origins)}`)
          .join("; "),
        duplicates.flatMap((duplicate) => duplicate.origins),
        duplicates.length
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
        broken.map((block) => block.to),
        broken.length
      );
    }

    if (node.ownPropertyCount + node.composedPropertyCount === 0) {
      add(
        "noProperties",
        node,
        content(node.id) || "No own and no composed properties"
      );
    }

    // Only about a type an editor can actually create, since a composition renders
    // through its users, and not about one the unused row already covers.
    if (
      !(headless || unused) &&
      canCreate &&
      !node.isElement &&
      node.templates.length === 0
    ) {
      // Content that has no template to render through is the case to read first.
      add(
        "noTemplate",
        node,
        content(node.id) || "No template allowed",
        undefined,
        totalOf(node.id)
      );
    }

    if (composers > 0 && !canCreate && at(inBlock, node.id) === 0) {
      // A mixin only one or two types compose is the one worth folding back in.
      add(
        "pureMixin",
        node,
        `Composed by ${plural(composers, "type")}`,
        composedBy.get(node.id),
        -composers
      );
    }

    const score = scores.get(node.id) ?? 0;
    if (topScore > 0 && score >= topTier) {
      add(
        "complexity",
        node,
        `Score ${score}: ${node.ownPropertyCount} own and ${node.composedPropertyCount} composed properties, ${plural(at(outComposition, node.id), "composition")}, ${plural(blockTargets.get(node.id)?.size ?? 0, "block target")}`,
        undefined,
        score
      );
    }
  }

  const rank = (finding: Finding) => FINDING_KINDS.indexOf(finding.kind);
  const strengthOf = (finding: Finding) => strength.get(finding.id) ?? 0;
  return found.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "problem" ? -1 : 1) ||
      rank(a) - rank(b) ||
      strengthOf(b) - strengthOf(a) ||
      (nameOf.get(a.nodeId) ?? "").localeCompare(nameOf.get(b.nodeId) ?? "") ||
      a.nodeId.localeCompare(b.nodeId)
  );
}

const EMPTY_BRANCH = (parents: number) =>
  parents === 1
    ? ", which has no content either"
    : ", none of which has content";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

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
