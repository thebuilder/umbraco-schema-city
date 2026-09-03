// The command palette's matching, over type name, type alias and every property
// alias the type carries, own and composed. Pure: no DOM, no React.
import type { SchemaNode } from "./types";

export type SearchHit = {
  node: SchemaNode;
  /** The property alias that matched, when the type's own name and alias did not. */
  propertyAlias: string | null;
};

/**
 * ponytail: case-insensitive substring, not a subsequence scorer. "seoTitle"
 * finds every type with that field, which is what the palette is for. Swap in a
 * real fuzzy ranker here if typo tolerance ever comes up.
 */
function tier(haystack: string, query: string): number {
  const lower = haystack.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  if (lower.includes(query)) return 2;
  return Number.POSITIVE_INFINITY;
}

/** A property match always ranks below any match on the type itself. */
const PROPERTY_PENALTY = 3;

export function searchNodes(nodes: SchemaNode[], query: string, limit = 50): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const scored: { hit: SearchHit; score: number }[] = [];

  for (const node of nodes) {
    let score = Math.min(tier(node.alias, needle), tier(node.name, needle));
    let propertyAlias: string | null = null;

    // An exact alias hit already wins, so the properties are only worth walking
    // when the type itself matched worse than that.
    if (score > 0) {
      for (const group of node.groups ?? []) {
        for (const property of group.properties ?? []) {
          const candidate = tier(property.alias, needle) + PROPERTY_PENALTY;
          if (candidate < score) {
            score = candidate;
            propertyAlias = property.alias;
          }
        }
      }
    }

    if (score !== Number.POSITIVE_INFINITY) scored.push({ hit: { node, propertyAlias }, score });
  }

  scored.sort((a, b) => a.score - b.score || a.hit.node.name.localeCompare(b.hit.node.name));
  return scored.slice(0, limit).map((entry) => entry.hit);
}
