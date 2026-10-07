// A comparison read as causes and their side effects. One edit on one type, such
// as a composition losing a property, shows up on every type that composes it, and
// a flat list of changed types buries the edit under its echoes. Here each type's
// own edits make a cause, and the lines other types only have because of it are
// nested under it as side effects. Every line of the comparison stays reachable.
import { dayOf } from "./dates";
import { csv } from "./findings-export";
import type { ChangeDetail, SchemaChange, SchemaComparison } from "./snapshots";

export type ChangeEffect = {
  change: SchemaChange;
  details: ChangeDetail[];
  /** The type has edits of its own too, so it is listed as a cause as well. */
  alsoCause: boolean;
};

export type ChangeCause = {
  /** The type's current id, or its baseline id when it was removed. */
  key: string;
  change: SchemaChange;
  /** The type's own edits. */
  details: ChangeDetail[];
  effects: ChangeEffect[];
  /** The other causes this type is also a side effect of. */
  effectOf: SchemaChange[];
};

export type ChangeKind = "added" | "removed" | "changed" | "side effect";

export type ChangeGroups = {
  causes: ChangeCause[];
  /** How many types changed only because another type did. */
  sideEffects: number;
  /** Every changed type's kind, by current id, or by baseline id once removed. */
  kinds: Map<string, ChangeKind>;
};

const changeKey = (change: SchemaChange) =>
  change.currentId ?? change.baselineId ?? change.alias;

const ORDER = { added: 0, removed: 1, changed: 2 } as const;
const byName = (a: SchemaChange, b: SchemaChange) =>
  ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name);

export function groupChanges(comparison: SchemaComparison): ChangeGroups {
  const changes = [
    ...comparison.added,
    ...comparison.removed,
    ...comparison.changed,
  ];
  const byId = new Map<string, SchemaChange>();
  for (const change of changes)
    for (const id of [change.baselineId, change.currentId])
      if (id) byId.set(id, change);

  // The other changed type a line follows from. A line pointing at a type only
  // follows it when that type was added or removed: a parent losing a deleted
  // child type is the deletion's doing, a block target swapped on a type that
  // merely changed is not.
  const explainer = (change: SchemaChange, detail: ChangeDetail) => {
    const via = byId.get(detail.via ?? "");
    if (via && via !== change) return via;
    const to = byId.get(detail.to ?? "");
    return to && to !== change && to.status !== "changed" ? to : undefined;
  };
  const own = new Map(
    changes.map((change) => [
      change,
      change.details.filter((detail) => !explainer(change, detail)),
    ])
  );
  // The causes behind a type, walking through types that are side effects
  // themselves. A loop of side effects with no cause in it finds none.
  const rootsOf = (
    change: SchemaChange,
    seen = new Set<SchemaChange>()
  ): SchemaChange[] => {
    if ((own.get(change)?.length ?? 0) > 0) return [change];
    if (seen.has(change)) return [];
    seen.add(change);
    return [
      ...new Set(
        change.details.flatMap((detail) => {
          const by = explainer(change, detail);
          return by ? rootsOf(by, seen) : [];
        })
      ),
    ];
  };

  // Worked out before any line moves, so the order the types come in decides nothing.
  const placed = changes.flatMap((change) =>
    change.details.flatMap((detail) => {
      const by = explainer(change, detail);
      return by
        ? [
            {
              change,
              detail,
              roots: rootsOf(by).filter((root) => root !== change),
            },
          ]
        : [];
    })
  );
  const effects = new Map<SchemaChange, Map<SchemaChange, ChangeDetail[]>>();
  for (const { change, detail, roots } of placed) {
    // Nothing explains it after all, so it counts as the type's own edit.
    if (roots.length === 0) own.get(change)?.push(detail);
    for (const root of roots) {
      const under =
        effects.get(root) ?? new Map<SchemaChange, ChangeDetail[]>();
      effects.set(root, under);
      under.set(change, [...(under.get(change) ?? []), detail]);
    }
  }

  const isCause = (change: SchemaChange) => (own.get(change)?.length ?? 0) > 0;
  const causes = changes
    .filter(isCause)
    .sort(byName)
    .map((change) => ({
      key: changeKey(change),
      change,
      details: change.details.filter((detail) =>
        own.get(change)?.includes(detail)
      ),
      effects: [...(effects.get(change) ?? [])]
        .map(([effect, details]) => ({
          change: effect,
          details,
          alsoCause: isCause(effect),
        }))
        .sort((a, b) => byName(a.change, b.change)),
      effectOf: [...effects]
        .filter(([, under]) => under.has(change))
        .map(([root]) => root)
        .sort(byName),
    }));
  return {
    causes,
    sideEffects: changes.length - causes.length,
    kinds: new Map(
      changes.map((change) => [
        changeKey(change),
        isCause(change) ? change.status : "side effect",
      ])
    ),
  };
}

const counted = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "4 causes, 16 side effects", the line both the drawer and the exports open with. */
export const changeSummary = (groups: ChangeGroups) =>
  `${counted(groups.causes.length, "cause")}, ${counted(groups.sideEffects, "side effect")}`;

const SEPARATOR = /[\s,;]+/;

/**
 * The causes a pasted plan names, as aliases split by spaces, commas or lines.
 * Aliases are compared without case, as Umbraco does.
 */
export function plannedFromAliases(
  groups: ChangeGroups,
  text: string
): string[] {
  const wanted = new Set(
    text
      .split(SEPARATOR)
      .filter(Boolean)
      .map((alias) => alias.toLowerCase())
  );
  return groups.causes
    .filter((cause) => wanted.has(cause.change.alias.toLowerCase()))
    .map((cause) => cause.key);
}

/** Where each side of the comparison came from, as "example.com, 2026-10-07". */
export type ComparedSides = { baseline: string; current: string };

export const sideLabel = (
  host: string | undefined,
  date: string | null | undefined
) => [host, dayOf(date)].filter(Boolean).join(", ") || "unknown";

const alsoEffect = (cause: ChangeCause) =>
  cause.effectOf.length > 0
    ? `, also a side effect of ${cause.effectOf.map((root) => root.name).join(" and ")}`
    : "";

/** "2 edits, 2 side effects, also a side effect of Press Release", under a cause. */
export const causeLine = (cause: ChangeCause) =>
  `${counted(cause.details.length, "edit")}, ${
    cause.effects.length > 0
      ? counted(cause.effects.length, "side effect")
      : "no side effects"
  }${alsoEffect(cause)}`;

const STATUS_WORD = { added: "added", removed: "removed", changed: "changed" };

/**
 * The comparison as a Markdown list a ticket can take as is: planned causes ticked,
 * each cause's own edits under it, and its side effects nested below those.
 */
export function changesMarkdown(
  groups: ChangeGroups,
  planned: ReadonlySet<string>,
  sides: ComparedSides
): string {
  const unplanned = groups.causes.filter(
    (cause) => !planned.has(cause.key)
  ).length;
  const lines = [
    "## Schema changes",
    "",
    `- Baseline: ${sides.baseline}`,
    `- Current: ${sides.current}`,
    `- ${changeSummary(groups)}, ${unplanned} unplanned`,
    "",
  ];
  for (const cause of groups.causes) {
    const { change } = cause;
    const mark = planned.has(cause.key) ? "x" : " ";
    lines.push(
      `- [${mark}] **${change.name}** (\`${change.alias}\`), ${STATUS_WORD[change.status]}, ${planned.has(cause.key) ? "planned" : "unplanned"}${alsoEffect(cause)}`
    );
    for (const detail of cause.details) lines.push(`  - ${detail.text}`);
    if (cause.effects.length > 0)
      lines.push(
        `  - ${counted(cause.effects.length, "side effect")}:`,
        ...cause.effects.map(
          (effect) =>
            `    - ${effect.change.name} (\`${effect.change.alias}\`)${effect.alsoCause ? ", also a cause" : ""}: ${effect.details.map((detail) => detail.text).join("; ")}`
        )
      );
  }
  return `${lines.join("\n")}\n`;
}

const HEADER = [
  "Cause",
  "Role",
  "Change",
  "Type",
  "Alias",
  "Detail",
  "Planned",
  "Baseline",
  "Current",
];

/**
 * One row per line of the comparison: the cause it belongs to, numbered as the
 * drawer lists them, whether the row is the cause's own edit or a side effect, and
 * whether the cause was planned. The two snapshots repeat on every row, as in the
 * findings export, so an import never takes a preamble for data.
 */
export function changesCsv(
  groups: ChangeGroups,
  planned: ReadonlySet<string>,
  sides: ComparedSides
): string {
  const rows = groups.causes.flatMap((cause, index) => {
    const row = (role: string, change: SchemaChange, detail: ChangeDetail) => [
      `C${index + 1}`,
      role,
      groups.kinds.get(changeKey(change)) ?? change.status,
      change.name,
      change.alias,
      detail.text,
      planned.has(cause.key) ? "yes" : "no",
      sides.baseline,
      sides.current,
    ];
    return [
      ...cause.details.map((detail) => row("cause", cause.change, detail)),
      ...cause.effects.flatMap((effect) =>
        effect.details.map((detail) =>
          row("side effect", effect.change, detail)
        )
      ),
    ];
  });
  return `${[HEADER, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`;
}
