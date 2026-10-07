// The findings drawer's whole content, derived from the graph and, for the rules
// that need it, the usage report. Pure: no DOM, no React, no three.js.
//
// Every rule is one pass over the nodes with a few edge counts prepared first, so
// the whole set is cheap enough to recompute whenever either input changes.
import { creationTree } from "./creation-tree";
import { dataTypeNames, storedByElementType } from "./data-types";
import { editorLayout } from "./editor-layout";
import { compositionUsers } from "./matrix";
import type {
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
  UsageReport,
} from "./types";

export type FindingKind =
  | "brokenBlock"
  | "orphanedBlocks"
  | "duplicateAlias"
  | "emptyBlock"
  | "cultureMismatch"
  | "unreachableChain"
  | "deadEnd"
  | "unusedElementType"
  | "unusedType"
  | "overloadedTab"
  | "nearDuplicateDataType"
  | "unusedDataType"
  | "noProperties"
  | "complexity"
  | "pureMixin"
  | "noTemplate";

export type FindingSeverity = "problem" | "note";

export type Finding = {
  /**
   * `kind:nodeId`, or `kind:dataTypeId` for a finding about a Data Type alone,
   * stable across runs so a row can be linked to.
   */
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  /**
   * The type the finding is about, and the one a row selects. Absent when the
   * subject is a Data Type no type uses, which has no building to select.
   */
  nodeId?: string;
  /**
   * The Data Types the finding names, each a link to its page. A finding without a
   * nodeId is about the first of them.
   */
  dataTypeIds?: string[];
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

/**
 * Chip and group order in the drawer. A fixed priority rather than a row count, so
 * what is definitely broken always comes first, then what no editor can reach or
 * use, then the notes.
 */
export const FINDING_KINDS: readonly FindingKind[] = [
  "brokenBlock",
  "orphanedBlocks",
  "duplicateAlias",
  "cultureMismatch",
  "unreachableChain",
  "deadEnd",
  "unusedElementType",
  "unusedType",
  "emptyBlock",
  "overloadedTab",
  "nearDuplicateDataType",
  "unusedDataType",
  "noProperties",
  "complexity",
  "pureMixin",
  "noTemplate",
];

export const FINDING_LABEL: Record<FindingKind, string> = {
  brokenBlock: "Broken block",
  orphanedBlocks: "Orphaned blocks",
  duplicateAlias: "Duplicate alias",
  emptyBlock: "Empty block",
  cultureMismatch: "Culture mismatch",
  unreachableChain: "Unreachable chain",
  deadEnd: "Dead end",
  unusedElementType: "Unused Element Type",
  unusedType: "Unused type",
  overloadedTab: "Overloaded tab",
  nearDuplicateDataType: "Near-duplicate Data Type",
  unusedDataType: "Unused Data Type",
  noProperties: "No properties",
  complexity: "Complexity",
  pureMixin: "Pure mixin",
  noTemplate: "No template",
};

/** How many complexity tiers the scores are cut into. Only the top one is a finding. */
const COMPLEXITY_TIERS = 5;

/** More properties than this in one tab makes it an overloaded tab. */
export const TAB_LIMIT = 20;

/** What every finding of a kind means, shown once per group rather than per row. */
export const KIND_EXPLANATION: Record<FindingKind, string> = {
  brokenBlock:
    "A block editor lists an Element Type that no longer exists in the schema.",
  orphanedBlocks:
    "Content still stores blocks of these Element Types, but no block editor configuration lists them any more. Editors cannot add new ones, and the stored ones may not render or edit as expected.",
  duplicateAlias:
    "A property alias arrives from more than one place, the type's own properties or its compositions. The editor that results cannot save both values, and where the editors differ the stored value may not suit one of them.",
  emptyBlock:
    "A block editor offers these Element Types as content blocks, but they have no own and no composed properties, so an editor who adds one has nothing to fill in. A deliberate divider or spacer block looks the same.",
  cultureMismatch:
    "These types do not vary by culture, yet something on them does: a property, or an Element Type one of their block editors lists. Umbraco keeps one value for every culture here, so that variance has no effect.",
  unreachableChain:
    "Allowed under other types, but no type allowed at root leads to any of them, so an editor cannot create content with these types. Content created before the chain was cut can still exist.",
  deadEnd:
    "Not allowed at root, not allowed under any type, not an Element Type, and nothing composes them, so an editor cannot create content with these types.",
  unusedElementType:
    "No block editor configuration lists these Element Types. Once usage has loaded, each row says whether stored block values use them; custom code can still use them either way.",
  unusedType:
    "An editor can create these Document Types, but the usage snapshot counts no content of them. Custom code, migrations and external consumers can still depend on a type.",
  overloadedTab: `One tab, or one group on a type without tabs, holds more than ${TAB_LIMIT} properties. Composed properties count, merged the way the Editor view shows them.`,
  nearDuplicateDataType:
    "Data Types whose names match once case, spaces, hyphens, underscores and a copy number such as (1) are ignored. They can differ in configuration. Each set is one row, on a type that uses the least-used of them, and the related types are every other type that uses any of them. Only own properties count, so a composed property counts on its composition.",
  unusedDataType:
    "No property on a Document, Media or Member Type uses these Data Types, and no collection view does. Custom code and packages can still refer to one by its key.",
  noProperties: "These types have no own and no composed properties.",
  complexity: `In the highest of ${COMPLEXITY_TIERS} complexity tiers in this schema. The score is own and composed properties, plus twice the compositions, plus distinct block targets.`,
  pureMixin:
    "Used only as compositions and never created on their own. Usually intended; listed so the mixins are easy to find.",
  noTemplate:
    "An editor can create these types, but no template is allowed. Check whether they are meant to render on their own.",
};

/**
 * What a developer can do about each kind, shown beside the explanation. A finding
 * is evidence to check, so none of these calls a type safe to delete.
 */
export const KIND_NEXT_STEP: Record<FindingKind, string> = {
  brokenBlock:
    "Remove the missing Element Type from the block editor, or restore it if content still holds those blocks.",
  orphanedBlocks:
    "Add the Element Type back to the block editor that held it, or move or remove the stored blocks before you change the type.",
  duplicateAlias:
    "Rename the property on one source or drop one of the compositions, then check which value editors expect.",
  emptyBlock:
    "Add the properties the block needs, or keep it if it is a deliberate divider or spacer.",
  cultureMismatch:
    "Let the type vary by culture, or make the property or Element Type invariant, whichever editors expect.",
  unreachableChain:
    "Allow the top of the chain under a type a root reaches, or remove the chain if it is left over.",
  deadEnd: "Allow it under a page, or remove it if it is left over.",
  unusedElementType:
    "Check the stored block count and custom code, then add it to a block editor or remove it.",
  unusedType:
    "Check custom code and imports, then remove it or allow it where editors need it.",
  overloadedTab:
    "Split the tab into groups or more tabs, so editors find the fields they need.",
  nearDuplicateDataType:
    "Compare the configurations, then move the properties onto one Data Type if they should match.",
  unusedDataType:
    "Search custom code and packages for its key, then remove it or give a property the Data Type.",
  noProperties:
    "Add properties, or check whether code relies on it as a folder or marker type.",
  complexity:
    "Check whether some properties belong in a composition or a block, so the type stays readable.",
  pureMixin:
    "Nothing, if it is meant as a mixin. With one or two users, consider moving its properties onto them.",
  noTemplate:
    "Allow a template if it should render on its own, or leave it for headless or block-only content.",
};

const SEVERITY: Record<FindingKind, FindingSeverity> = {
  brokenBlock: "problem",
  orphanedBlocks: "problem",
  duplicateAlias: "problem",
  emptyBlock: "note",
  cultureMismatch: "problem",
  unreachableChain: "problem",
  deadEnd: "problem",
  unusedElementType: "problem",
  unusedType: "problem",
  overloadedTab: "note",
  nearDuplicateDataType: "note",
  unusedDataType: "note",
  noProperties: "note",
  complexity: "note",
  pureMixin: "note",
  noTemplate: "note",
};

/** Rules that say nothing without a usage report, and are skipped without one. */
const NEEDS_USAGE: ReadonlySet<FindingKind> = new Set<FindingKind>([
  "unusedType",
]);

/** The drawer's groups: one per kind that has rows, in FINDING_KINDS order. */
export const findingGroups = (findings: Finding[]) =>
  FINDING_KINDS.map((kind) => ({
    kind,
    rows: findings.filter((finding) => finding.kind === kind),
  })).filter((group) => group.rows.length > 0);

/**
 * Per type, the labels of its problem findings joined into one line, for the dot a
 * list row shows and the tooltip that says why.
 */
export function problemLabels(findings: Finding[]): Map<string, string> {
  const labels = new Map<string, string[]>();
  for (const finding of findings)
    if (finding.severity === "problem" && finding.nodeId)
      append(labels, finding.nodeId, FINDING_LABEL[finding.kind]);
  return new Map([...labels].map(([id, kinds]) => [id, kinds.join(", ")]));
}

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
const append = <T>(map: Map<string, T[]>, key: string, value: T) =>
  map.set(key, [...(map.get(key) ?? []), value]);

const propertiesOf = (node: SchemaNode): SchemaProperty[] =>
  (node.groups ?? []).flatMap((group) => group.properties);

/**
 * Every finding the graph supports, sorted by the chip order, which puts problems
 * first, then strongest case first inside a kind, then by the type's name, so two
 * runs on the same input list the same rows in the same order.
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
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges ?? [];

  const parentsOf = new Map<string, string[]>();
  const blockHosts = new Set<string>();
  const inComposition = counter();
  const inBlock = counter();
  const outComposition = counter();
  const blockTargets = new Map<string, Set<string>>();
  // Block edges to types the graph has, by host and by Element Type, from the type
  // that declares the block property.
  const blocksFrom = new Map<string, SchemaEdge[]>();
  const blocksTo = new Map<string, SchemaEdge[]>();
  // Host id to the Element Type keys its block editors name and the graph does not
  // have, with the property alias that names each one.
  const missingBlocks = new Map<
    string,
    { propertyAlias: string; to: string }[]
  >();

  // A composed block property arrives with an edge from every type that uses the
  // composition. Rules about the block editor itself read it once, on the type that
  // declares the property.
  const composedAliases = new Map(
    nodes.map((node) => [
      node.id,
      new Set(
        propertiesOf(node)
          .filter((p) => p.fromCompositionId)
          .map((p) => p.alias)
      ),
    ])
  );
  const declares = (edge: SchemaEdge) =>
    !composedAliases.get(edge.from)?.has(edge.propertyAlias ?? "");

  for (const edge of edges) {
    switch (edge.kind) {
      case "allowedChild":
        append(parentsOf, edge.to, edge.from);
        break;
      case "composition":
        bump(inComposition, edge.to);
        bump(outComposition, edge.from);
        break;
      case "block": {
        blockHosts.add(edge.from);
        if (!byId.has(edge.to)) {
          if (!declares(edge)) break;
          append(missingBlocks, edge.from, {
            propertyAlias: edge.propertyAlias ?? "",
            to: edge.to,
          });
          break;
        }
        bump(inBlock, edge.to);
        if (declares(edge)) {
          append(blocksFrom, edge.from, edge);
          append(blocksTo, edge.to, edge);
        }
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

  // The creation tree already walks down from every root, so the chains it cannot
  // reach come from there. Types with no parent at all are the dead end rule's.
  const users = compositionUsers(graph);
  const unreachable = new Map(
    creationTree(graph)
      .unreachable.filter((row) => row.parents.length > 0)
      .map((row) => [row.id, row.parents])
  );

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
  // Allowed somewhere and reached from a root, so an editor really can create it.
  const reachable = (node: SchemaNode) =>
    creatable(node) && !unreachable.has(node.id);
  // A schema where most creatable types have no template is headless: the missing
  // template is the design, and one note per type would bury everything else. More
  // than half without a template is the cut, simple enough to say in the README.
  const pages = nodes.filter((node) => !node.isElement && reachable(node));
  const headless =
    pages.filter((node) => node.templates.length === 0).length * 2 >
    pages.length;
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]));
  const byName = (a: string, b: string) =>
    (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b) ||
    a.localeCompare(b);
  const twins = dataTypeTwins(nodes, byName);
  const names = (ids: string[]) => list(ids.map((id) => nameOf.get(id) ?? id));
  const dataTypeName = dataTypeNames(graph);
  const dataTypeList = (ids: string[]) =>
    list(ids.map((id) => dataTypeName.get(id) ?? id));
  // Blocks content stores, per Element Type. Empty until a report with block
  // counts arrives, and then the Element Type rules can say what content holds.
  const blocks = usage?.blocks;
  const stored = storedByElementType(usage);
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
    weight = 0,
    dataTypeIds?: string[]
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
      ...(dataTypeIds && dataTypeIds.length > 0 ? { dataTypeIds } : {}),
    });
  };

  for (const node of nodes) {
    const composers = at(inComposition, node.id);
    const canCreate = creatable(node);
    const unused =
      reachable(node) && !node.isElement && usage && totalOf(node.id) === 0;

    // Only a type an editor can create can have content of its own, so "no content"
    // says nothing about the rest. Those are a dead end, an unreachable chain or a
    // pure mixin below.
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

    // An Element Type other Element Types compose is a mixin: its properties reach
    // blocks through them, and an unused composer gets a row of its own.
    if (node.isElement && at(inBlock, node.id) === 0 && composers === 0) {
      const kept = stored.get(node.id);
      if (kept) {
        // Content still holds it, so this is no cleanup candidate but a
        // configuration that dropped an Element Type its blocks still name.
        add(
          "orphanedBlocks",
          node,
          `No block editor lists it, but content stores ${plural(kept.blocks, "block")} of it in ${dataTypeList(kept.dataTypeIds)}${blocks?.partial ? ", or more: the count stopped early" : ""}`,
          undefined,
          kept.blocks,
          kept.dataTypeIds
        );
      } else {
        const hosts =
          blockHosts.size > 0
            ? `No block editor lists it. ${plural(blockHosts.size, "type has", "types have")} a block editor that could`
            : "No block editor lists it, and no type in this schema has a block editor";
        let evidence = "";
        if (blocks)
          evidence = blocks.partial
            ? ". No stored block of it was counted, but the count stopped early"
            : ". Content stores 0 blocks of it";
        add("unusedElementType", node, hosts + evidence);
      }
    }

    // A type nothing composes and nothing can create is a structural dead end, and
    // this one row says so. A type something composes is a mixin doing its job, so
    // it is never a dead end; the pure mixin note below covers it instead.
    if (!(node.isElement || canCreate) && composers === 0) {
      const detail =
        content(node.id) ||
        plural(
          node.ownPropertyCount + node.composedPropertyCount,
          "property",
          "properties"
        );
      add(
        "deadEnd",
        node,
        `Not allowed at root or under any type, and nothing composes it. ${detail}`
      );
    }

    const chain = unreachable.get(node.id);
    if (chain) {
      add(
        "unreachableChain",
        node,
        `Allowed under ${names(chain)}, ${chain.length === 1 ? "which no root can reach" : "none of which a root can reach"}`,
        chain
      );
    }

    const duplicates = duplicateAliases(node);
    if (duplicates.length > 0) {
      const source = (id: string) =>
        id === node.id ? "this type" : (nameOf.get(id) ?? id);
      add(
        "duplicateAlias",
        node,
        duplicates
          .map(({ alias, origins }) => {
            const editors = new Set(origins.map((origin) => origin.editor));
            // Different editors under one alias is the real data risk, so name them.
            return editors.size > 1
              ? `${alias}: ${origins.map((origin) => `${origin.editor} from ${source(origin.id)}`).join(", ")}`
              : `${alias} from ${list(origins.map((origin) => source(origin.id)))}`;
          })
          .join("; "),
        [
          ...new Set(
            duplicates.flatMap((duplicate) =>
              duplicate.origins.map((origin) => origin.id)
            )
          ),
        ].filter((id) => id !== node.id),
        duplicates.length
      );
    }

    const broken = missingBlocks.get(node.id);
    if (broken) {
      const aliases = [
        ...new Set(broken.map((block) => block.propertyAlias)),
      ].join(", ");
      const own = propertiesOf(node);
      const editors = [
        ...new Set(
          broken.flatMap(
            (block) =>
              own.find((p) => p.alias === block.propertyAlias)?.dataTypeId ?? []
          )
        ),
      ];
      // A deleted Element Type can still be in stored values, which is what decides
      // whether restoring it matters.
      const kept = broken.reduce(
        (sum, block) => sum + (stored.get(block.to)?.blocks ?? 0),
        0
      );
      add(
        "brokenBlock",
        node,
        `${aliases || "A block editor"} points at ${broken.length} Element Type${broken.length === 1 ? "" : "s"} that no longer exist${broken.length === 1 ? "s" : ""}${kept > 0 ? `, and content still stores ${plural(kept, "block")} of ${broken.length === 1 ? "it" : "them"}` : ""}`,
        broken.map((block) => block.to),
        broken.length,
        editors
      );
    }

    if (!node.variesByCulture) {
      // A composed property names the composition it came from, which is where its
      // variance is set.
      const varying = propertiesOf(node).filter((p) => p.variesByCulture);
      const properties = varying.map((p) =>
        p.fromCompositionId
          ? `${p.alias} from ${names([p.fromCompositionId])}`
          : p.alias
      );
      const variantBlocks = (blocksFrom.get(node.id) ?? []).filter(
        (edge) => byId.get(edge.to)?.variesByCulture
      );
      const listed = [
        ...new Set(
          variantBlocks.map(
            (edge) =>
              `${edge.propertyAlias ?? "A block editor"} lists ${names([edge.to])}`
          )
        ),
      ];
      const parts = [
        properties.length > 0
          ? `${list(properties)} ${properties.length === 1 ? "varies" : "vary"} by culture`
          : "",
        listed.length > 0
          ? `${list(listed)}, which ${listed.length === 1 ? "varies" : "vary"} by culture`
          : "",
      ].filter(Boolean);
      if (parts.length > 0)
        add(
          "cultureMismatch",
          node,
          parts.join("; "),
          [
            ...new Set([
              ...varying.flatMap((p) =>
                p.fromCompositionId ? [p.fromCompositionId] : []
              ),
              ...variantBlocks.map((edge) => edge.to),
            ]),
          ],
          properties.length + listed.length
        );
    }

    const twin = twins.get(node.id);
    if (twin)
      add(
        "nearDuplicateDataType",
        node,
        twin.summary,
        twin.related,
        twin.properties,
        twin.dataTypeIds
      );

    const overloaded = overloadedTabs(node);
    if (overloaded.length > 0) {
      add(
        "overloadedTab",
        node,
        overloaded
          .map((tab) => `${tab.label} holds ${tab.count} properties`)
          .join("; "),
        undefined,
        overloaded[0]?.count
      );
    }

    // Settings blocks are left out: an empty settings Element Type is a block with
    // no settings, which is ordinary.
    const hosts = node.isElement
      ? (blocksTo.get(node.id) ?? []).filter((edge) => edge.role !== "settings")
      : [];
    const empty = node.ownPropertyCount + node.composedPropertyCount === 0;
    if (empty && hosts.length > 0) {
      const byHost = new Map<string, Set<string>>();
      for (const edge of hosts)
        byHost.set(
          edge.from,
          (byHost.get(edge.from) ?? new Set()).add(
            edge.propertyAlias ?? "a block editor"
          )
        );
      add(
        "emptyBlock",
        node,
        `Listed by ${list([...byHost].map(([host, aliases]) => `${[...aliases].join(", ")} on ${names([host])}`))}`,
        [...byHost.keys()],
        byHost.size
      );
    } else if (empty) {
      // The empty block row above already says this, more specifically.
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
      reachable(node) &&
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
      // Users through inheritance and nested compositions count, the same set the
      // inspector and the Matrix show. A mixin only one or two types use is the one
      // worth folding back in.
      const all = users.get(node.id) ?? [];
      const using = all.map((user) => user.id);
      const indirect = all.filter((user) => user.via).length;
      add(
        "pureMixin",
        node,
        `Composed by ${plural(all.length - indirect, "type")}${indirect > 0 ? `, and ${indirect} more through them` : ""}`,
        using.sort(byName),
        -using.length
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

  found.push(...unusedDataTypes(graph));

  const rank = (finding: Finding) => FINDING_KINDS.indexOf(finding.kind);
  const strengthOf = (finding: Finding) => strength.get(finding.id) ?? 0;
  const subject = (finding: Finding) =>
    finding.nodeId
      ? (nameOf.get(finding.nodeId) ?? "")
      : (dataTypeName.get(finding.dataTypeIds?.[0] ?? "") ?? "");
  return found.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      strengthOf(b) - strengthOf(a) ||
      subject(a).localeCompare(subject(b)) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * Data Types no property uses and nothing else the graph cannot show, such as a
 * Media Type property or a collection view. Only a graph that lists its Data Types
 * can say one is unused: an older one knows only the ones properties name.
 */
function unusedDataTypes(graph: SchemaGraph): Finding[] {
  const used = new Set(
    graph.nodes.flatMap((node) => propertiesOf(node).map((p) => p.dataTypeId))
  );
  return (graph.dataTypes ?? [])
    .filter((dataType) => !used.has(dataType.id) && dataType.otherUses === 0)
    .map((dataType) => ({
      id: `unusedDataType:${dataType.id}`,
      kind: "unusedDataType" as const,
      severity: SEVERITY.unusedDataType,
      summary: [
        `Editor ${dataType.editorAlias}`,
        dataType.targets.length > 0
          ? `offering ${plural(new Set(dataType.targets.map((t) => t.nodeId)).size, "type")}`
          : "",
        dataType.folder ? `in ${dataType.folder}` : "",
      ]
        .filter(Boolean)
        .join(", "),
      dataTypeIds: [dataType.id],
    }));
}

const EMPTY_BRANCH = (parents: number) =>
  parents === 1
    ? ", which has no content either"
    : ", none of which has content";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** The first three, then how many more, so one row stays one or two lines. */
function list(items: string[]): string {
  const shown = items.slice(0, 3);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/**
 * Property aliases the type gets from more than one place, with the compositions
 * they came from. Umbraco lets two compositions contribute the same alias, and the
 * editor that results cannot save both values.
 */
function duplicateAliases(node: SchemaNode) {
  // Alias to origin id to the Data Type, or editor, the property uses there.
  const origins = new Map<string, Map<string, string>>();
  for (const property of propertiesOf(node)) {
    const seen = origins.get(property.alias) ?? new Map<string, string>();
    // Own properties have no composition to name, so they are their own origin.
    seen.set(
      property.fromCompositionId ?? node.id,
      property.dataTypeName ?? property.editorAlias
    );
    origins.set(property.alias, seen);
  }
  return [...origins]
    .filter(([, from]) => from.size > 1)
    .map(([alias, from]) => ({
      alias,
      origins: [...from].map(([id, editor]) => ({ id, editor })),
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

const SEPARATORS = /[\s_-]+/g;

/** Umbraco saves a second Data Type of the same name as "Name (1)". */
const COPY_SUFFIX = /\s*\(\d+\)$/;

/** "SEO Toggle", "seo-toggle", "Seo_Toggle" and "SEO Toggle (1)" all become "seotoggle". */
const normalName = (name: string) =>
  name.toLowerCase().replace(COPY_SUFFIX, "").replace(SEPARATORS, "");

/**
 * Data Types are only in the graph through the properties that use them, so the
 * names compared are the ones some property carries. Returns, per type, its own
 * properties whose Data Type shares a normalised name with another Data Type.
 * Composed properties are left to the composition, so a shared mixin is one row.
 */
type DataTypeUse = { name: string; properties: number; types: Set<string> };

/** Own properties per Data Type, gathered under the normalised Data Type name. */
function dataTypeSets(nodes: SchemaNode[]) {
  const sets = new Map<string, Map<string, DataTypeUse>>();
  for (const node of nodes)
    for (const property of propertiesOf(node)) {
      if (property.fromCompositionId || !property.dataTypeName) continue;
      const key = normalName(property.dataTypeName);
      const set = sets.get(key) ?? new Map<string, DataTypeUse>();
      const use = set.get(property.dataTypeId) ?? {
        name: property.dataTypeName,
        properties: 0,
        types: new Set<string>(),
      };
      use.properties++;
      use.types.add(node.id);
      set.set(property.dataTypeId, use);
      sets.set(key, set);
    }
  return [...sets.values()].filter((set) => set.size > 1);
}

/**
 * Sets of Data Types whose names match once normalised, keyed by the type that
 * carries the set's row. That is a type using the least-used Data Type of the set,
 * since the odd one out is usually the one to fold into the others. One row per set
 * rather than per type, because a twin that most of the schema uses would otherwise
 * put a row on nearly every type and bury the rest of the drawer. A type that
 * anchors two sets gets one row covering both.
 */
function dataTypeTwins(
  nodes: SchemaNode[],
  byName: (a: string, b: string) => number
) {
  const rows = new Map<
    string,
    {
      summary: string;
      related: string[];
      properties: number;
      dataTypeIds: string[];
    }
  >();
  for (const set of dataTypeSets(nodes)) {
    // Two Data Types with one name and the same counts tie, so the id decides,
    // never the order the nodes arrived in.
    const uses = [...set].sort(
      ([idA, a], [idB, b]) =>
        a.properties - b.properties ||
        a.types.size - b.types.size ||
        a.name.localeCompare(b.name) ||
        idA.localeCompare(idB)
    );
    const names = uses.map(([, use]) => use.name);
    const label = ([id, use]: [string, DataTypeUse]) =>
      names.indexOf(use.name) === names.lastIndexOf(use.name)
        ? use.name
        : `${use.name} (${id.slice(0, 8)})`;
    const anchor = [...(uses[0]?.[1].types ?? [])].sort(byName)[0] ?? "";
    const others = uses.flatMap(([, use]) => [...use.types]);
    // A type that anchors two sets adds the second to the first one's row.
    const before = rows.get(anchor) ?? {
      summary: "",
      related: [],
      properties: 0,
      dataTypeIds: [],
    };
    rows.set(anchor, {
      summary: [
        before.summary,
        uses
          .map(
            (use) =>
              `${label(use)}: ${plural(use[1].properties, "property", "properties")} on ${plural(use[1].types.size, "type")}`
          )
          .join(", "),
      ]
        .filter(Boolean)
        .join("; "),
      related: [...new Set([...before.related, ...others])]
        .filter((id) => id !== anchor)
        .sort(byName),
      properties:
        before.properties +
        uses.reduce((sum, [, use]) => sum + use.properties, 0),
      dataTypeIds: [...before.dataTypeIds, ...uses.map(([id]) => id)],
    });
  }
  return rows;
}

/**
 * Tabs over the limit, fullest first. A type without tabs is one unnamed tab in
 * the editor layout, and there each group is what the editor scrolls through.
 */
function overloadedTabs(node: SchemaNode) {
  const tabs = editorLayout(node);
  const [only] = tabs;
  const boxes =
    tabs.length === 1 && only?.key === ""
      ? only.panels.map((panel) => ({
          // The backend's synthetic "No group" would read "No group group".
          label:
            panel.name === null || panel.key.endsWith("/no-group")
              ? "Ungrouped"
              : `${panel.name} group`,
          count: panel.properties.length,
        }))
      : tabs.map((tab) => ({ label: `${tab.name} tab`, count: tab.count }));
  return boxes
    .filter((box) => box.count > TAB_LIMIT)
    .sort((a, b) => b.count - a.count);
}
