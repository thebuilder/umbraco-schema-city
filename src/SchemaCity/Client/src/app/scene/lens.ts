// The usage lens: what each building's number is and where that number sits on
// the lens's ramp. Pure: no three.js, no React, no DOM. Scene.tsx turns the ramp
// position into a colour from the theme tokens, and the toolbar legend prints the
// two ends from the same numbers.
//
// A node the lens says nothing about is absent from the map and keeps the colour
// it has, which is how Element Types stay amber under every lens that is about
// content instances.
import type { SchemaGraph, UsageReport } from "../../model/types";

export type Lens =
  | "none"
  | "count"
  | "published"
  | "cultures"
  | "references"
  | "unused";

/** Toolbar order, and the only names the URL accepts. */
export const LENSES: readonly Lens[] = [
  "none",
  "count",
  "published",
  "cultures",
  "references",
  "unused",
];

export const LENS_LABEL: Record<Lens, string> = {
  none: "None",
  count: "Content count",
  published: "Published share",
  cultures: "Cultures",
  references: "Incoming references",
  unused: "Unused",
};

/**
 * Amber to azure both ways, never phosphor against signal: green against pink is
 * the worst pair for colour-vision deficiency, and both of those colours already
 * mean something else in this city.
 */
export type Ramp = "sequential" | "diverging" | "binary";

export type LensScale = {
  ramp: Ramp;
  /** Node id to its place on the ramp, 0 to 1. Absent means the lens is silent. */
  t: Map<string, number>;
  minLabel: string;
  maxLabel: string;
};

/**
 * The scale for one lens, or null when the lens is off or has nothing to say. The
 * three counting lenses stretch their ramp over the values they actually found, so
 * a schema where every type has thousands of items still shows a difference.
 */
export function lensScale(
  graph: SchemaGraph,
  usage: UsageReport | undefined,
  lens: Lens,
): LensScale | null {
  if (!usage || lens === "none") return null;

  if (lens === "unused") {
    // Binary, and the only lens that speaks about Element Types, which have no
    // content of their own and so are never the ones being called unused here.
    const t = new Map(
      graph.nodes.map((node) => [
        node.id,
        !node.isElement && (usage.byType[node.id]?.total ?? 0) === 0 ? 1 : 0,
      ]),
    );
    return { ramp: "binary", t, minLabel: "in use", maxLabel: "no content" };
  }

  if (lens === "published") {
    // Diverging around half. A type with no content has no share to show, so it
    // stays out of the ramp rather than sitting at one end of it.
    const t = new Map<string, number>();
    for (const node of graph.nodes) {
      const found = usage.byType[node.id];
      if (node.isElement || !found || found.total === 0) continue;
      t.set(node.id, found.published / found.total);
    }
    return { ramp: "diverging", t, minLabel: "0% published", maxLabel: "100% published" };
  }

  const incoming = new Map<string, number>();
  if (lens === "references") {
    for (const reference of usage.references) {
      incoming.set(reference.toType, (incoming.get(reference.toType) ?? 0) + reference.count);
    }
  }
  const valueOf = (id: string) => {
    const found = usage.byType[id];
    if (lens === "count") return found?.total ?? 0;
    if (lens === "cultures") return found?.cultures.length ?? 0;
    return incoming.get(id) ?? 0;
  };

  const values = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.isElement) continue;
    values.set(node.id, valueOf(node.id));
  }
  if (values.size === 0) return null;

  const min = Math.min(...values.values());
  const max = Math.max(...values.values());
  const span = max - min;
  const t = new Map<string, number>();
  for (const [id, value] of values) t.set(id, span === 0 ? 0 : (value - min) / span);

  return {
    ramp: "sequential",
    t,
    minLabel: min.toLocaleString(),
    maxLabel: max.toLocaleString(),
  };
}

/** The badge over the selected building's roof, or null when usage has no row for it. */
export function usageBadge(usage: UsageReport | undefined, id: string): string | null {
  const found = usage?.byType[id];
  if (!found) return null;
  return `${found.total.toLocaleString()} · ${found.published.toLocaleString()} published`;
}
