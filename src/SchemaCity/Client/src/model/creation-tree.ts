// What an editor can create where: the allowed-child rules walked down from every
// type allowed at root, and the Document Types no root reaches. Pure: no DOM, no React.
import type { SchemaGraph, SchemaNode } from "./types";

export type CreationTree = {
  /** Types allowed at root, by name. */
  roots: string[];
  /** Allowed children per type, by name, known types only. */
  children: ReadonlyMap<string, string[]>;
  /** The same rules read upwards: the types each type is allowed under. */
  parents: ReadonlyMap<string, string[]>;
  /**
   * Document Types no root can reach, by name, with the types they are allowed
   * under. A parent that is itself unreachable is how a rootless chain shows.
   */
  unreachable: { id: string; parents: string[] }[];
  /** Unreachable types left out of that list, and why. */
  excluded: { elements: number; compositions: number };
};

export function creationTree(graph: SchemaGraph): CreationTree {
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const byName = (a: string, b: string) =>
    (names.get(a) ?? "").localeCompare(names.get(b) ?? "");
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const edge of graph.edges ?? [])
    if (
      edge.kind === "allowedChild" &&
      names.has(edge.from) &&
      names.has(edge.to)
    ) {
      link(children, edge.from, edge.to);
      link(parents, edge.to, edge.from);
    }
  for (const list of [...children.values(), ...parents.values()])
    list.sort(byName);
  const composed = new Set(
    (graph.edges ?? [])
      .filter((edge) => edge.kind === "composition")
      .map((edge) => edge.to)
  );

  const roots = graph.nodes
    .filter((node) => node.allowedAsRoot)
    .map((node) => node.id)
    .sort(byName);
  const reached = closure(roots, children);

  const unreachable: CreationTree["unreachable"] = [];
  const excluded = { elements: 0, compositions: 0 };
  for (const node of [...graph.nodes].sort((a, b) => byName(a.id, b.id))) {
    if (reached.has(node.id)) continue;
    const reason = exclusion(node, composed, parents);
    if (reason) excluded[reason]++;
    else unreachable.push({ id: node.id, parents: parents.get(node.id) ?? [] });
  }

  return { roots, children, parents, unreachable, excluded };
}

/**
 * An Element Type is never created in the content tree, and a composition nothing
 * can create is a mixin: both are unreachable by design, not by mistake.
 */
function exclusion(
  node: SchemaNode,
  composed: ReadonlySet<string>,
  parents: ReadonlyMap<string, string[]>
): keyof CreationTree["excluded"] | null {
  if (node.isElement) return "elements";
  if (composed.has(node.id) && !parents.has(node.id)) return "compositions";
  return null;
}

function link(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}

export type TreeRow = {
  /** The path from the root, so a type under two parents is two rows. */
  key: string;
  id: string;
  depth: number;
  /** Already in its own ancestry, so it is drawn once and not expanded. */
  recursive: boolean;
  expandable: boolean;
  /** Its children follow it in the list. */
  open: boolean;
};

/**
 * ponytail: a schema whose paths fan out and join again multiplies rows with every
 * level, so a full expansion stops here rather than hanging the page.
 */
export const ROW_LIMIT = 2000;

/**
 * The visible rows, depth first. Without `match`, a row shows its children when its
 * key is in `expanded`. With `match`, every path that ends in a matching type is
 * shown open, and nothing else.
 */
export function treeRows(
  tree: CreationTree,
  expanded: ReadonlySet<string>,
  match?: ReadonlySet<string>
): { rows: TreeRow[]; truncated: boolean } {
  // Types with a matching type at or below them. A repeat is only worth a row
  // when it is itself a match; its subtree is drawn where it first appears.
  const leads = match ? closure(match, tree.parents) : null;
  const shown = (id: string, recursive: boolean) =>
    !(leads && match) || (leads.has(id) && (!recursive || match.has(id)));
  const rows: TreeRow[] = [];
  let truncated = false;
  const visit = (id: string, path: string[]) => {
    if (rows.length >= ROW_LIMIT) {
      truncated = true;
      return;
    }
    const recursive = path.includes(id);
    if (!shown(id, recursive)) return;
    const key = [...path, id].join("/");
    const kids = recursive ? [] : (tree.children.get(id) ?? []);
    const open = kids.length > 0 && (leads !== null || expanded.has(key));
    rows.push({
      key,
      id,
      depth: path.length,
      recursive,
      expandable: kids.length > 0,
      open,
    });
    if (open) for (const child of kids) visit(child, [...path, id]);
  };
  for (const root of tree.roots) visit(root, []);
  return { rows, truncated };
}

/** Everything reachable from `starts` along `next`, the starts included. Safe in cycles. */
function closure(
  starts: Iterable<string>,
  next: ReadonlyMap<string, string[]>
): Set<string> {
  const found = new Set(starts);
  const queue = [...found];
  for (let at = queue.shift(); at !== undefined; at = queue.shift())
    for (const step of next.get(at) ?? [])
      if (!found.has(step)) {
        found.add(step);
        queue.push(step);
      }
  return found;
}
