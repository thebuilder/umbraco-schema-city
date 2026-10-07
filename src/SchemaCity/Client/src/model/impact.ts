// What a change to one type reaches: the types that get its properties, offer it as
// a block, allow it as a child or pick it, and what those reach in turn, each with
// the paths that explain why. Evidence to review, never a verdict. Pure: no DOM.
import { closure, creationTree } from "./creation-tree";
import { storedByElementType } from "./data-types";
import { dayOf } from "./dates";
import { csv, DOCUMENT_TYPE_PATH } from "./findings-export";
import { contentCountOf } from "./inspector";
import type { SchemaEdge, SchemaGraph, SchemaNode, UsageReport } from "./types";

/** The relationship kinds a developer can switch on and off. */
export type Relation = "compositions" | "blocks" | "children" | "pickers";
export const RELATIONS: Relation[] = [
  "compositions",
  "blocks",
  "children",
  "pickers",
];
export const RELATION_LABEL: Record<Relation, string> = {
  compositions: "Compositions and inheritance",
  blocks: "Blocks",
  children: "Allowed children",
  pickers: "Pickers",
};

/** Dependents: what a change to the type reaches. Dependencies: what it relies on. */
export type Direction = "dependents" | "dependencies";

export type StepKind =
  | "inherits"
  | "composes"
  | "block"
  | "picker"
  | "allowsChild"
  | "unreachable";

/** One hop of a path: the type it reaches, how, and through which property. */
export type Step = {
  id: string;
  kind: StepKind;
  property?: string;
  /** The property's Data Type name, or its editor alias when the Data Type is gone. */
  dataType?: string;
};

const RELATION_OF: Record<StepKind, Relation> = {
  inherits: "compositions",
  composes: "compositions",
  block: "blocks",
  picker: "pickers",
  allowsChild: "children",
  unreachable: "children",
};

export type GroupKey =
  | "receivers"
  | "blockHosts"
  | "parents"
  | "orphans"
  | "pickers"
  | "sources"
  | "blocks"
  | "children"
  | "picks";

type GroupSpec = { key: GroupKey; label: string; first: StepKind[] };

/** The groups each direction lists, in order, by the kind of their first step. */
const GROUPS: Record<Direction, GroupSpec[]> = {
  dependents: [
    {
      key: "receivers",
      label: "Get its properties",
      first: ["inherits", "composes"],
    },
    { key: "blockHosts", label: "Offer it as a block", first: ["block"] },
    { key: "parents", label: "Allow it as a child", first: ["allowsChild"] },
    {
      key: "orphans",
      label: "Only reached through it",
      first: ["unreachable"],
    },
    { key: "pickers", label: "Pick it in a picker", first: ["picker"] },
  ],
  dependencies: [
    {
      key: "sources",
      label: "Give it properties",
      first: ["inherits", "composes"],
    },
    { key: "blocks", label: "Offered as its blocks", first: ["block"] },
    { key: "children", label: "Allowed under it", first: ["allowsChild"] },
    { key: "picks", label: "Its pickers allow", first: ["picker"] },
  ],
};

/** Paths kept per type. More would bury the shortest ones without adding reasons. */
export const MAX_PATHS = 3;

export type ImpactRow = {
  id: string;
  name: string;
  alias: string;
  /** Reached in one step. */
  direct: boolean;
  /** Up to MAX_PATHS, shortest first. */
  paths: Step[][];
  /** Content items, undefined for a type that holds none of its own. */
  content?: number;
  /** Blocks of an Element Type stored anywhere, when the usage report counted them. */
  blocks?: number;
};

export type ImpactGroup = { key: GroupKey; label: string; rows: ImpactRow[] };

export type Impact = {
  start: string;
  direction: Direction;
  relations: Relation[];
  depth: number;
  groups: ImpactGroup[];
  /** Distinct types across every group. */
  types: number;
  /** Content items summed over those types, each type once. */
  content: number;
  /** The start type's own content items, undefined when it holds none of its own. */
  own?: number;
  /** Blocks of the start type stored per Data Type, when it is an Element Type. */
  stored: { dataTypeId: string; name: string; blocks: number }[];
  /** The block count stopped early, so its numbers are lower bounds. */
  partial: boolean;
};

type Link = Step;

/**
 * Per type, the links a trace can take from it. Dependents walk each edge from its
 * end back to its start (a composition to the types that compose it), dependencies
 * walk it forwards. Umbraco records a parent type as a composition too, so the pair
 * is one link, an inherits one.
 */
function linksFor(graph: SchemaGraph, direction: Direction) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const parents = new Set(
    graph.edges
      .filter((edge) => edge.kind === "inherits")
      .map((edge) => `${edge.from}>${edge.to}`)
  );
  const links = new Map<string, Link[]>();
  const seen = new Set<string>();
  const add = (at: string, link: Link) => {
    const key = `${at}>${link.id}>${link.kind}>${link.property ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.set(at, [...(links.get(at) ?? []), link]);
  };
  for (const edge of graph.edges) {
    const kind = stepKind(edge.kind, parents.has(`${edge.from}>${edge.to}`));
    const known = nodes.has(edge.from) && nodes.has(edge.to);
    if (!kind || edge.from === edge.to || !known) continue;
    const step = { kind, ...viaOf(edge, nodes) };
    if (direction === "dependents") add(edge.to, { id: edge.from, ...step });
    else add(edge.from, { id: edge.to, ...step });
  }
  return links;
}

/** The property a block or picker edge goes through, with its Data Type's name. */
function viaOf(
  edge: SchemaEdge,
  nodes: ReadonlyMap<string, SchemaNode>
): Pick<Step, "property" | "dataType"> {
  if (!edge.propertyAlias) return {};
  const property = nodes
    .get(edge.from)
    ?.groups.flatMap((group) => group.properties)
    .find((candidate) => candidate.alias === edge.propertyAlias);
  return {
    property: edge.propertyAlias,
    ...(property
      ? { dataType: property.dataTypeName ?? property.editorAlias }
      : {}),
  };
}

function stepKind(kind: string, isParent: boolean): StepKind | null {
  switch (kind) {
    case "composition":
    case "inherits":
      return isParent ? "inherits" : "composes";
    case "block":
      return "block";
    case "reference":
      return "picker";
    case "allowedChild":
      return "allowsChild";
    default:
      return null;
  }
}

/**
 * Which steps may follow a step, given the relations that are on. A type that now
 * carries something changed, a property or a block option, passes it on to the
 * types that inherit or compose it, and an Element Type to the blocks that nest it.
 * A parent that loses a creation option passes nothing on: allowed children are
 * neither inherited nor composed. Dependencies follow one relation at a time.
 */
function follows(
  direction: Direction,
  last: StepKind,
  on: ReadonlySet<Relation>
): StepKind[] {
  if (direction === "dependencies")
    return (Object.keys(RELATION_OF) as StepKind[]).filter(
      (kind) =>
        kind !== "unreachable" && RELATION_OF[kind] === RELATION_OF[last]
    );
  if (last === "allowsChild") return [];
  if (last === "unreachable") return ["unreachable"];
  return [
    ...(on.has("compositions") ? (["inherits", "composes"] as const) : []),
    ...(on.has("blocks") ? (["block"] as const) : []),
  ];
}

/**
 * The types only `start` leads to from a root: removing it leaves them with no way
 * to be created. A type allowed under it and under some other reachable type is
 * not one of them.
 */
function orphansOf(graph: SchemaGraph, start: string): Set<string> {
  const tree = creationTree(graph);
  const all = closure(tree.roots, tree.children);
  const without = closure(
    tree.roots.filter((root) => root !== start),
    new Map([...tree.children].filter(([id]) => id !== start))
  );
  return new Set([...all].filter((id) => id !== start && !without.has(id)));
}

/**
 * Breadth first over paths rather than types, so a type keeps more than one reason
 * and the shortest comes first. A path never visits a type twice, which is what
 * makes a cycle safe, and each type takes at most MAX_PATHS, which bounds the walk.
 */
function walk(
  start: string,
  first: StepKind[],
  depth: number,
  linksOf: (at: string, kinds: StepKind[]) => Link[],
  next: (last: StepKind) => StepKind[]
): Map<string, Step[][]> {
  const found = new Map<string, Step[][]>();
  const queue: Step[][] = [[]];
  const extend = (path: Step[], link: Link) => {
    const paths = found.get(link.id) ?? [];
    const revisits =
      link.id === start || path.some((step) => step.id === link.id);
    if (revisits || paths.length >= MAX_PATHS) return;
    const longer = [...path, link];
    paths.push(longer);
    found.set(link.id, paths);
    queue.push(longer);
  };
  for (let path = queue.shift(); path; path = queue.shift()) {
    const last = path[path.length - 1];
    const kinds = last ? next(last.kind) : first;
    if (path.length < depth)
      for (const link of linksOf(last?.id ?? start, kinds)) extend(path, link);
  }
  return found;
}

/** Row content: the type's own content items, and stored blocks for an Element Type. */
function counter(graph: SchemaGraph, usage: UsageReport | undefined) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const countOf = contentCountOf(usage, nodes, graph.edges);
  const stored = usage?.blocks ? storedByElementType(usage) : null;
  return (node: SchemaNode) => {
    const content = countOf(node.id);
    return {
      ...(content === undefined ? {} : { content }),
      ...(stored && node.isElement
        ? { blocks: stored.get(node.id)?.blocks ?? 0 }
        : {}),
    };
  };
}

function rowsOf(
  found: Map<string, Step[][]>,
  nodes: Map<string, SchemaNode>,
  count: ReturnType<typeof counter>
): ImpactRow[] {
  return [...found]
    .flatMap(([id, paths]) => {
      const node = nodes.get(id);
      return node
        ? [
            {
              id,
              name: node.name,
              alias: node.alias,
              direct: (paths[0]?.length ?? 0) === 1,
              paths,
              ...count(node),
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        (a.paths[0]?.length ?? 0) - (b.paths[0]?.length ?? 0) ||
        (b.content ?? -1) - (a.content ?? -1) ||
        a.name.localeCompare(b.name)
    );
}

/** Every type a change to `start` reaches, by group, along the relations that are on. */
export function impactOf(
  graph: SchemaGraph,
  start: string,
  {
    direction = "dependents",
    relations = RELATIONS,
    depth = Number.POSITIVE_INFINITY,
  }: { direction?: Direction; relations?: Relation[]; depth?: number } = {},
  usage?: UsageReport
): Impact {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const on = new Set(relations);
  const links = linksFor(graph, direction);
  const orphans =
    direction === "dependents" && on.has("children")
      ? orphansOf(graph, start)
      : new Set<string>();
  // An orphan is reached down the allowed-child edges, the other way from a parent.
  const children = linksFor(graph, "dependencies");
  const linksOf = (at: string, kinds: StepKind[]): Link[] => [
    ...(links.get(at) ?? []).filter((link) => kinds.includes(link.kind)),
    ...(kinds.includes("unreachable")
      ? (children.get(at) ?? [])
          .filter((link) => link.kind === "allowsChild" && orphans.has(link.id))
          .map((link) => ({ id: link.id, kind: "unreachable" as const }))
      : []),
  ];
  const count = counter(graph, usage);
  const groups = GROUPS[direction]
    .filter((spec) => on.has(RELATION_OF[spec.first[0] as StepKind]))
    .map((spec) => ({
      key: spec.key,
      label: spec.label,
      rows: rowsOf(
        walk(start, spec.first, depth, linksOf, (last) =>
          follows(direction, last, on)
        ),
        nodes,
        count
      ),
    }))
    .filter((group) => group.rows.length > 0);

  const distinct = new Map(
    groups.flatMap((group) => group.rows.map((row) => [row.id, row] as const))
  );
  const names = new Map(
    (graph.dataTypes ?? []).map((dataType) => [dataType.id, dataType.name])
  );
  const startNode = nodes.get(start);
  const startsElement = startNode?.isElement === true;
  return {
    ...(startNode ? { own: count(startNode).content } : {}),
    start,
    direction,
    relations: RELATIONS.filter((relation) => on.has(relation)),
    depth,
    groups,
    types: distinct.size,
    content: [...distinct.values()].reduce(
      (sum, row) => sum + (row.content ?? 0),
      0
    ),
    stored: startsElement
      ? (usage?.blocks?.byDataType ?? []).flatMap((row) => {
          const element = row.elements.find((e) => e.elementTypeId === start);
          const blocks = element ? element.content + element.settings : 0;
          return blocks > 0
            ? [
                {
                  dataTypeId: row.dataTypeId,
                  name: names.get(row.dataTypeId) ?? row.dataTypeId,
                  blocks,
                },
              ]
            : [];
        })
      : [],
    partial: usage?.blocks?.partial === true,
  };
}

/** What one hop says, read with its own subject: "inherits Article". */
function verb(step: Step, object: string): string {
  const where = step.property
    ? ` in ${step.property}${step.dataType ? ` (${step.dataType})` : ""}`
    : "";
  switch (step.kind) {
    case "inherits":
      return `inherits ${object}`;
    case "composes":
      return `composes ${object}`;
    case "block":
      return `offers ${object} as a block${where}`;
    case "picker":
      return `can pick ${object}${where}`;
    case "allowsChild":
      return `allows ${object} as a child`;
    default:
      return `is reached only through ${object}`;
  }
}

/**
 * A path as one sentence. Dependents read from the affected type back to the start,
 * "Press Release inherits Article, which composes Seo Composition", because every
 * edge points from the type that depends to the one it depends on. Dependencies
 * read forwards from the start for the same reason.
 */
export function pathWords(
  start: string,
  path: Step[],
  direction: Direction,
  nameOf: (id: string) => string
): string {
  const ids = [start, ...path.map((step) => step.id)];
  const clauses =
    direction === "dependents"
      ? path
          .map((step, index) => verb(step, nameOf(ids[index] ?? "")))
          .reverse()
      : path.map((step) => verb(step, nameOf(step.id)));
  const subject = nameOf(
    (direction === "dependents" ? ids[ids.length - 1] : start) ?? ""
  );
  return `${subject} ${clauses.join(", which ")}`;
}

/** A type that already has the alias from somewhere other than the property's source. */
export type Collision = { id: string; name: string; from: string };

export type AliasImpact = {
  alias: string;
  /** The type that declares the property, or the start type for a planned alias. */
  source: string;
  /** The start type already has the alias, so this traces where it lands. */
  exists: boolean;
  /** Every type that carries it or would, the source first. */
  carriers: ImpactRow[];
  /** Content items summed over the carriers. */
  content: number;
  collisions: Collision[];
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Where a property lands: the type that declares it and every type that gets that
 * type's properties. For an alias the start type does not have yet, the start is the
 * source, so this is where a planned property would land. A carrier that already has
 * the alias from another source is a collision: Umbraco compares aliases without
 * case, and a type cannot hold one alias twice. `from` picks which of two rows with
 * one alias, a duplicate already, is meant: the composition it comes from, or null
 * for the start type's own.
 */
export function aliasImpact(
  graph: SchemaGraph,
  start: string,
  alias: string,
  usage?: UsageReport,
  from?: string | null
): AliasImpact | null {
  const wanted = alias.trim();
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const startNode = nodes.get(start);
  if (!(startNode && wanted)) return null;
  const propertiesOf = (node: SchemaNode) =>
    node.groups.flatMap((group) => group.properties);
  const matches = propertiesOf(startNode).filter((property) =>
    same(property.alias, wanted)
  );
  const existing =
    matches.find(
      (property) =>
        from !== undefined &&
        (property.fromCompositionId ?? start) === (from ?? start)
    ) ?? matches[0];
  const source = existing?.fromCompositionId ?? start;
  const sourceNode = nodes.get(source) ?? startNode;
  const users =
    impactOf(graph, source, { relations: ["compositions"] }, usage).groups[0]
      ?.rows ?? [];
  // The source carries it with no path to explain.
  const carriers = [
    ...rowsOf(new Map([[sourceNode.id, [[]]]]), nodes, counter(graph, usage)),
    ...users,
  ];
  const collisions = carriers.flatMap((row) => {
    const node = nodes.get(row.id);
    return node
      ? propertiesOf(node)
          .filter(
            (property) =>
              same(property.alias, wanted) &&
              (property.fromCompositionId ?? node.id) !== source
          )
          .map((property) => {
            const declaredOn = property.fromCompositionId ?? node.id;
            return {
              id: node.id,
              name: node.name,
              from: nodes.get(declaredOn)?.name ?? declaredOn,
            };
          })
      : [];
  });
  return {
    alias: existing?.alias ?? wanted,
    source: sourceNode.id,
    exists: existing !== undefined,
    carriers,
    content: carriers.reduce((sum, row) => sum + (row.content ?? 0), 0),
    collisions,
  };
}

const DEPTH_WORD = (depth: number) =>
  Number.isFinite(depth) ? `${depth}` : "all";

/** "37 types, 188 content items". */
/**
 * "Content stores it in 38 blocks: 33 in SC Body Blocks, 5 in SC Rich Text With
 * Blocks.", or null for a type with none counted.
 */
export function storedLine({ stored, partial }: Impact): string | null {
  if (stored.length === 0) return null;
  const total = stored.reduce((sum, row) => sum + row.blocks, 0);
  const parts = [...stored]
    .sort((a, b) => b.blocks - a.blocks)
    .map((row) => `${row.blocks.toLocaleString()} in ${row.name}`);
  return `Content stores it in ${total.toLocaleString()} ${total === 1 ? "block" : "blocks"}: ${parts.join(", ")}${partial ? ". The count stopped early, so these are lower bounds" : ""}.`;
}

export const totalsLine = (types: number, content: number) =>
  `${types.toLocaleString()} ${types === 1 ? "type" : "types"}, ${content.toLocaleString()} content ${content === 1 ? "item" : "items"}`;

const cell = (text: string | number) =>
  String(text)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");

const table = (header: string[], rows: (string | number)[][]) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");

const amount = (row: ImpactRow) =>
  row.content ??
  (row.blocks === undefined ? "" : `${row.blocks.toLocaleString()} blocks`);

/** The schema and usage snapshot dates a trace was read from. */
const datesLine = (graph: SchemaGraph, usage: UsageReport | undefined) =>
  `Schema snapshot ${dayOf(graph.generatedAt) ?? "undated"}, usage snapshot ${usage ? (dayOf(usage.generatedAt) ?? "undated") : "unavailable"}.`;

/** The start type's own content and its stored blocks, each as a paragraph. */
function startLines(impact: Impact, name: string): string[] {
  const { own } = impact;
  const stored = storedLine(impact);
  return [
    ...(own === undefined
      ? []
      : [
          "",
          `${name} has ${own.toLocaleString()} content ${own === 1 ? "item" : "items"} of its own.`,
        ]),
    ...(stored ? ["", stored] : []),
  ];
}

/** What was traced and when, the totals, and the start type's own counts. */
function markdownHeader(
  impact: Impact,
  graph: SchemaGraph,
  usage: UsageReport | undefined
): string[] {
  const start = graph.nodes.find((node) => node.id === impact.start);
  const name = start?.name ?? impact.start;
  const title =
    impact.direction === "dependents"
      ? "Impact of changing"
      : "Dependencies of";
  const relations = impact.relations
    .map((relation) => RELATION_LABEL[relation].toLowerCase())
    .join(", ");
  return [
    `## ${title} ${name} (${start?.alias ?? ""})`,
    "",
    `Relationships: ${relations || "none"}. Depth: ${DEPTH_WORD(impact.depth)}.`,
    datesLine(graph, usage),
    "",
    `**${totalsLine(impact.types, impact.content)}.** These are configured relationships to review, not proof that a change breaks them.`,
    ...startLines(impact, name),
  ];
}

/** Where a property alias lands and the types that already have it. */
function aliasMarkdown(
  alias: AliasImpact,
  nameOf: (id: string) => string
): string[] {
  return [
    "",
    `### Property ${alias.alias}`,
    "",
    `Lands on ${totalsLine(alias.carriers.length, alias.content)}, declared on ${nameOf(alias.source)}.`,
    "",
    alias.collisions.length === 0
      ? "No alias collisions found."
      : table(
          ["Type", "Already has it from"],
          alias.collisions.map((collision) => [collision.name, collision.from])
        ),
  ];
}

/**
 * A ticket-ready summary: what was traced, the totals, a table per group and the
 * alias collisions. Paths beyond the first are listed after it, so a reviewer sees
 * every reason a type is there.
 */
export function impactMarkdown(
  impact: Impact,
  graph: SchemaGraph,
  usage?: UsageReport,
  alias?: AliasImpact | null
): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const nameOf = (id: string) => nodes.get(id) ?? id;
  const words = (path: Step[]) =>
    pathWords(impact.start, path, impact.direction, nameOf);
  const groups = impact.groups.flatMap((group) => [
    "",
    `### ${group.label} (${group.rows.length})`,
    "",
    table(
      ["Type", "Alias", "Content", "Path"],
      group.rows.map((row) => [
        row.name,
        row.alias,
        amount(row),
        row.paths.map(words).join("; or "),
      ])
    ),
  ]);
  const lines = [
    ...markdownHeader(impact, graph, usage),
    ...groups,
    ...(alias ? aliasMarkdown(alias, nameOf) : []),
  ];
  return `${lines.join("\n")}\n`;
}

const HEADER = [
  "Group",
  "Type",
  "Alias",
  "Type key",
  "Direct",
  "Content items",
  "Stored blocks",
  "Path",
  "Other paths",
  "Backoffice path",
  "Start type",
  "Direction",
  "Relationships",
  "Depth",
  "Schema snapshot",
  "Usage snapshot",
];

/**
 * One header row, then one row per type per group, then one per alias collision,
 * with the trace's settings repeated on every row as the findings export does, so
 * an import never takes a preamble for data.
 */
export function impactCsv(
  impact: Impact,
  graph: SchemaGraph,
  usage?: UsageReport,
  alias?: AliasImpact | null
): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const nameOf = (id: string) => nodes.get(id)?.name ?? id;
  const words = (path: Step[]) =>
    pathWords(impact.start, path, impact.direction, nameOf);
  const settings = [
    nameOf(impact.start),
    impact.direction,
    impact.relations.map((relation) => RELATION_LABEL[relation]).join(" | "),
    DEPTH_WORD(impact.depth),
    dayOf(graph.generatedAt) ?? "",
    usage ? (dayOf(usage.generatedAt) ?? "") : "unavailable",
  ];
  const rows = impact.groups.flatMap((group) =>
    group.rows.map((row) => [
      group.label,
      row.name,
      row.alias,
      row.id,
      row.direct ? "yes" : "no",
      row.content ?? "",
      row.blocks ?? "",
      words(row.paths[0] ?? []),
      row.paths.slice(1).map(words).join(" | "),
      `${DOCUMENT_TYPE_PATH}${row.id}`,
      ...settings,
    ])
  );
  const collisions = (alias?.collisions ?? []).map((collision) => [
    `Alias collision: ${alias?.alias ?? ""}`,
    collision.name,
    nodes.get(collision.id)?.alias ?? "",
    collision.id,
    "",
    "",
    "",
    `Already has ${alias?.alias ?? ""} from ${collision.from}`,
    "",
    `${DOCUMENT_TYPE_PATH}${collision.id}`,
    ...settings,
  ]);
  return `${[HEADER, ...rows, ...collisions].map((row) => row.map(csv).join(",")).join("\n")}\n`;
}
