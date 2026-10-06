// What the inspector says about one type, worked out from the graph and the usage
// report. Pure: no DOM, no React, no three.js.
import type { Neighbourhood } from "./neighbourhood";
import type { SchemaNode, TypeUsage, UsageReport } from "./types";

export type Role = "page" | "composition" | "element";

/**
 * The same rule as `roleOf` in scene/buildings.ts, read from the neighbourhood: a
 * composition is composed by something and can never be created, so the badge and
 * the building always agree.
 */
export function roleOf(node: SchemaNode, around: Neighbourhood): Role {
  if (node.isElement) return "element";
  return around.composedBy.length > 0 &&
    around.allowedParents.length === 0 &&
    !node.allowedAsRoot
    ? "composition"
    : "page";
}

export type ThroughUsage = {
  total: number;
  published: number;
  drafts: number;
  trashed: number;
  /** Types that compose this one and have content of their own. */
  withContent: number;
  /** Types that compose this one. */
  of: number;
};

/**
 * Content that carries a composition's properties, summed over the types that
 * compose it.
 *
 * ponytail: one level only. A composition composed into another composition counts
 * that one's own content, which is none; walk composedBy transitively if nested
 * mixins turn up in real schemas.
 */
export function throughUsage(
  around: Neighbourhood,
  report: UsageReport
): ThroughUsage {
  const sum: ThroughUsage = {
    total: 0,
    published: 0,
    drafts: 0,
    trashed: 0,
    withContent: 0,
    of: around.composedBy.length,
  };
  for (const id of around.composedBy) {
    const usage = report.byType[id];
    if (!usage || usage.total === 0) continue;
    sum.total += usage.total;
    sum.published += usage.published;
    sum.drafts += usage.drafts;
    sum.trashed += usage.trashed;
    sum.withContent += 1;
  }
  return sum;
}

const items = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "item" : "items"}`;

/** The one line under the type's name about how much content it has. */
export function usageLine(
  node: SchemaNode,
  around: Neighbourhood,
  report: UsageReport | undefined,
  usage: TypeUsage | undefined
): string {
  if (!report) return "Content usage has not loaded yet";
  const total = usage?.total ?? 0;
  if (total > 0)
    return `${total.toLocaleString()} content ${total === 1 ? "item" : "items"}, ${(usage?.published ?? 0).toLocaleString()} published`;
  // Block values are stored inside the content that hosts them, so an Element
  // Type is never counted as a content item of its own.
  if (node.isElement)
    return "Element Types live inside block values, not as content items";
  if (around.composedBy.length === 0) return "No content items yet";
  const through = throughUsage(around, report);
  const users = `${through.of} ${through.of === 1 ? "type" : "types"} that use it`;
  return through.total === 0
    ? `No content of its own, and none through the ${users}`
    : `No content of its own. ${items(through.total)} through ${through.withContent} of the ${users}`;
}

export type Chip = { id: string; name: string | null; count?: number };

/**
 * Most content first, then by name, so the types that matter most lead a long
 * list. A key no node claims has no name and goes last; a block editor can still
 * name a deleted Element Type.
 */
export function chips(
  ids: string[],
  nodesById: Map<string, SchemaNode>,
  countOf: (id: string) => number | undefined
): Chip[] {
  return ids
    .map((id) => ({
      id,
      name: nodesById.get(id)?.name ?? null,
      count: countOf(id),
    }))
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        (b.count ?? -1) - (a.count ?? -1) ||
        (a.name ?? a.id).localeCompare(b.name ?? b.id)
    );
}

/** Which of the city's link layers a kind is drawn in, and so its colour. */
export type Trace = "structure" | "compositions" | "blocks" | "references";

type FlatKind =
  | "allowedParents"
  | "allowedChildren"
  | "inherits"
  | "compositions"
  | "inheritedBy"
  | "composedBy"
  | "blockHosts"
  | "referencesIn";
type FieldKind = "blockTargets" | "referencesOut";

export type Field = {
  propertyAlias: string;
  /** The property's Data Type, or its editor alias when the Data Type is gone. */
  dataType: string | null;
  ids: string[];
};

export type ConnectionGroup = {
  kind: FlatKind | FieldKind;
  label: string;
  trace: Trace;
  /** Distinct types in the group. */
  count: number;
} & ({ ids: string[] } | { fields: Field[] });

const LABEL: Record<FlatKind | FieldKind, string> = {
  allowedParents: "Allowed under",
  allowedChildren: "Can create",
  inherits: "Inherits",
  compositions: "Compositions",
  inheritedBy: "Inherited by",
  composedBy: "Used as a composition by",
  blockTargets: "Block targets",
  blockHosts: "Used in blocks by",
  referencesOut: "Picker references",
  referencesIn: "Picked by",
};

const TRACE: Record<FlatKind | FieldKind, Trace> = {
  allowedParents: "structure",
  allowedChildren: "structure",
  inherits: "compositions",
  compositions: "compositions",
  inheritedBy: "compositions",
  composedBy: "compositions",
  blockTargets: "blocks",
  blockHosts: "blocks",
  referencesOut: "references",
  referencesIn: "references",
};

/** The order the groups are listed in, structure first as in the layer menu. */
const ORDER: (FlatKind | FieldKind)[] = [
  "allowedParents",
  "allowedChildren",
  "inherits",
  "compositions",
  "inheritedBy",
  "composedBy",
  "blockTargets",
  "blockHosts",
  "referencesOut",
  "referencesIn",
];

/**
 * The type's configured connections, one group per kind that has any. Umbraco
 * records a parent type as a composition too, so the parent is listed under
 * Inherits only, and a child under Inherited by only.
 */
export function connectionGroups(
  node: SchemaNode,
  around: Neighbourhood
): ConnectionGroup[] {
  const without = (ids: string[], drop: string[]) =>
    ids.filter((id) => !drop.includes(id));
  const flat: Record<FlatKind, string[]> = {
    allowedParents: around.allowedParents,
    allowedChildren: around.allowedChildren,
    inherits: around.inherits,
    compositions: without(around.compositions, around.inherits),
    inheritedBy: around.inheritedBy,
    composedBy: without(around.composedBy, around.inheritedBy),
    blockHosts: around.blockHosts,
    referencesIn: around.referencesIn,
  };
  const dataTypeOf = new Map(
    node.groups.flatMap((group) =>
      group.properties.map(
        (property) =>
          [
            property.alias,
            property.dataTypeName ?? property.editorAlias,
          ] as const
      )
    )
  );
  const fields = (targets: Neighbourhood["blockTargets"]): Field[] =>
    targets.map((group) => ({
      propertyAlias: group.propertyAlias,
      dataType: dataTypeOf.get(group.propertyAlias) ?? null,
      // The same Element Type as block content and as settings is one chip.
      ids: [...new Set(group.ids)],
    }));
  const byField: Record<FieldKind, Field[]> = {
    blockTargets: fields(around.blockTargets),
    referencesOut: fields(around.referencesOut),
  };

  const groups: ConnectionGroup[] = [];
  for (const kind of ORDER) {
    const base = { kind, label: LABEL[kind], trace: TRACE[kind] };
    if (kind === "blockTargets" || kind === "referencesOut") {
      const list = byField[kind];
      const count = new Set(list.flatMap((field) => field.ids)).size;
      if (count > 0) groups.push({ ...base, count, fields: list });
    } else if (flat[kind].length > 0)
      groups.push({ ...base, count: flat[kind].length, ids: flat[kind] });
  }
  return groups;
}

/**
 * The kinds worth saying are empty, as the noun each one reads as in "No parents,
 * children or picker references". Inheritance is rare enough that its absence is
 * not news, so it is never named.
 */
const EMPTY_NOUN: Partial<Record<FlatKind | FieldKind, string>> = {
  allowedParents: "parents",
  allowedChildren: "children",
  compositions: "compositions",
  composedBy: "types that compose it",
  blockTargets: "block targets",
  blockHosts: "block editors that use it",
  referencesOut: "picker references",
  referencesIn: "pickers that allow it",
};

/** One sentence naming the relation kinds this type has none of, or null. */
export function emptyKindsLine(
  node: SchemaNode,
  groups: ConnectionGroup[]
): string | null {
  const present = new Set(groups.map((group) => group.kind));
  // An Element Type is never created in the tree and a page is never a block, so
  // naming those as missing would only state what the type is.
  const skip: (FlatKind | FieldKind)[] = node.isElement
    ? ["allowedParents", "allowedChildren"]
    : ["blockHosts"];
  const nouns = ORDER.filter(
    (kind) => !(present.has(kind) || skip.includes(kind))
  ).flatMap((kind) => EMPTY_NOUN[kind] ?? []);
  if (nouns.length === 0) return null;
  const last = nouns.pop();
  return `No ${nouns.length > 0 ? `${nouns.join(", ")} or ${last}` : last}.`;
}

export type Observed = { out: Chip[]; in: Chip[] };

/**
 * References counted between content items in the usage snapshot, by the type on
 * the other end, most references first. These are what content does, not what the
 * pickers allow, so the inspector keeps them apart from the configured groups.
 */
export function observedReferences(
  nodeId: string,
  report: UsageReport,
  nodesById: Map<string, SchemaNode>
): Observed {
  const tally = (pick: "fromType" | "toType", match: "fromType" | "toType") => {
    const counts = new Map<string, number>();
    for (const reference of report.references)
      if (reference[match] === nodeId)
        counts.set(
          reference[pick],
          (counts.get(reference[pick]) ?? 0) + reference.count
        );
    return chips([...counts.keys()], nodesById, (id) => counts.get(id));
  };
  return { out: tally("toType", "fromType"), in: tally("fromType", "toType") };
}
