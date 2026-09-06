import type {
  PropertyGroup,
  SchemaEdge,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
} from "./types";

const SNAPSHOT_FORMAT = "schema-city" as const;
const SNAPSHOT_VERSION = 1 as const;

export type SchemaSnapshot = {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  capturedAt: string;
  graph: SchemaGraph;
};

export type SnapshotParseResult =
  | { snapshot: SchemaSnapshot; error?: never }
  | { snapshot?: never; error: string };

export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export async function readSnapshotFile(
  file: Pick<File, "size" | "text">
): Promise<SnapshotParseResult> {
  if (file.size > MAX_SNAPSHOT_BYTES)
    return { error: "Snapshot is larger than 5 MB." };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { error: "Could not read the snapshot file." };
  }
  try {
    return parseSnapshot(JSON.parse(text));
  } catch {
    return {
      error: "Invalid Schema City snapshot: the file is not valid JSON.",
    };
  }
}

export type SchemaChange = {
  status: "added" | "removed" | "changed";
  name: string;
  alias: string;
  currentId?: string;
  baselineId?: string;
  details: string[];
};

export type SchemaComparison = {
  added: SchemaChange[];
  removed: SchemaChange[];
  changed: SchemaChange[];
  /** Current node id to the matching baseline node id, including alias matches. */
  matches: Map<string, string>;
};

export function createSnapshot(graph: SchemaGraph): SchemaSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    graph,
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be a finite number`);
  return value;
}

function count(value: unknown, path: string): number {
  const result = requiredNumber(value, path);
  if (!Number.isInteger(result) || result < 0)
    throw new Error(`${path} must be a non-negative integer`);
  return result;
}

function timestamp(value: unknown, path: string): string {
  const result = requiredString(value, path);
  if (Number.isNaN(Date.parse(result)))
    throw new Error(`${path} must be an ISO date`);
  return result;
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value !== null && typeof value !== "string")
    throw new Error(`${path} must be a string or null`);
  return value as string | null;
}

function validateNode(value: unknown, index: number): SchemaNode {
  const path = `graph.nodes[${index}]`;
  if (!record(value)) throw new Error(`${path} must be an object`);
  requiredString(value.id, `${path}.id`);
  requiredString(value.alias, `${path}.alias`);
  requiredString(value.name, `${path}.name`);
  requiredString(value.icon, `${path}.icon`);
  if (value.iconColor !== null)
    requiredString(value.iconColor, `${path}.iconColor`);
  if (value.folderId !== null)
    requiredString(value.folderId, `${path}.folderId`);
  requiredBoolean(value.isElement, `${path}.isElement`);
  requiredBoolean(value.allowedAsRoot, `${path}.allowedAsRoot`);
  requiredBoolean(value.variesByCulture, `${path}.variesByCulture`);
  requiredBoolean(value.variesBySegment, `${path}.variesBySegment`);
  if (value.description !== null)
    requiredString(value.description, `${path}.description`);
  count(value.ownPropertyCount, `${path}.ownPropertyCount`);
  count(value.composedPropertyCount, `${path}.composedPropertyCount`);
  requiredArray(value.groups, `${path}.groups`);
  requiredArray(value.templates, `${path}.templates`);
  (value.groups as unknown[]).forEach((group, groupIndex) => {
    const groupPath = `${path}.groups[${groupIndex}]`;
    if (!record(group)) throw new Error(`${groupPath} must be an object`);
    requiredString(group.id, `${groupPath}.id`);
    requiredString(group.alias, `${groupPath}.alias`);
    requiredString(group.name, `${groupPath}.name`);
    if (group.type !== "Tab" && group.type !== "Group")
      throw new Error(`${groupPath}.type must be Tab or Group`);
    nullableString(group.parentAlias, `${groupPath}.parentAlias`);
    nullableString(group.fromCompositionId, `${groupPath}.fromCompositionId`);
    requiredArray(group.properties, `${groupPath}.properties`).forEach(
      (property, propertyIndex) => {
        const propertyPath = `${groupPath}.properties[${propertyIndex}]`;
        if (!record(property))
          throw new Error(`${propertyPath} must be an object`);
        for (const key of ["alias", "name", "dataTypeId", "editorAlias"])
          requiredString(property[key], `${propertyPath}.${key}`);
        nullableString(property.editorUiAlias, `${propertyPath}.editorUiAlias`);
        nullableString(
          property.fromCompositionId,
          `${propertyPath}.fromCompositionId`
        );
        requiredBoolean(property.mandatory, `${propertyPath}.mandatory`);
        requiredBoolean(
          property.variesByCulture,
          `${propertyPath}.variesByCulture`
        );
        requiredArray(property.targets, `${propertyPath}.targets`).forEach(
          (target, targetIndex) => {
            const targetPath = `${propertyPath}.targets[${targetIndex}]`;
            if (!record(target))
              throw new Error(`${targetPath} must be an object`);
            requiredString(target.nodeId, `${targetPath}.nodeId`);
            if (
              !["content", "settings", "picker"].includes(String(target.role))
            )
              throw new Error(`${targetPath}.role is invalid`);
          }
        );
      }
    );
  });
  (value.templates as unknown[]).forEach((template, templateIndex) => {
    const templatePath = `${path}.templates[${templateIndex}]`;
    if (!record(template)) throw new Error(`${templatePath} must be an object`);
    requiredString(template.id, `${templatePath}.id`);
    requiredString(template.alias, `${templatePath}.alias`);
    requiredString(template.name, `${templatePath}.name`);
    requiredBoolean(template.isDefault, `${templatePath}.isDefault`);
  });
  return value as unknown as SchemaNode;
}

function validateGraph(value: unknown): SchemaGraph {
  if (!record(value)) throw new Error("graph must be an object");
  timestamp(value.generatedAt, "graph.generatedAt");
  const folders = requiredArray(value.folders, "graph.folders");
  validateFolders(folders);
  const nodes = requiredArray(value.nodes, "graph.nodes").map(validateNode);
  validateNodeIds(nodes);
  const edges = requiredArray(value.edges, "graph.edges");
  validateEdges(edges);
  return {
    generatedAt: timestamp(value.generatedAt, "graph.generatedAt"),
    folders: folders as SchemaGraph["folders"],
    nodes,
    edges: edges as SchemaGraph["edges"],
  };
}

function validateNodeIds(nodes: SchemaNode[]) {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.id.length === 0 || ids.has(node.id))
      throw new Error("graph.nodes ids must be unique and non-empty");
    ids.add(node.id);
  }
}

function validateFolders(folders: unknown[]) {
  folders.forEach((folder, index) => {
    if (!record(folder))
      throw new Error(`graph.folders[${index}] must be an object`);
    requiredString(folder.id, `graph.folders[${index}].id`);
    requiredString(folder.name, `graph.folders[${index}].name`);
    if (folder.parentId !== null)
      requiredString(folder.parentId, `graph.folders[${index}].parentId`);
  });
  const folderRows = folders as SchemaGraph["folders"];
  const ids = new Set<string>();
  for (const folder of folderRows) {
    if (folder.id.length === 0 || ids.has(folder.id))
      throw new Error("graph.folders ids must be unique and non-empty");
    ids.add(folder.id);
  }
  for (const folder of folderRows) {
    const seen = new Set<string>();
    let parent = folder.parentId;
    while (parent !== null) {
      if (seen.has(parent))
        throw new Error("graph.folders must not contain cycles");
      seen.add(parent);
      parent =
        folderRows.find((candidate) => candidate.id === parent)?.parentId ??
        null;
    }
  }
}

function validateEdges(edges: unknown[]) {
  edges.forEach((edge, index) => {
    const path = `graph.edges[${index}]`;
    if (!record(edge)) throw new Error(`${path} must be an object`);
    if (
      ![
        "allowedChild",
        "composition",
        "inherits",
        "block",
        "reference",
      ].includes(String(edge.kind))
    )
      throw new Error(`${path}.kind is invalid`);
    requiredString(edge.from, `${path}.from`);
    requiredString(edge.to, `${path}.to`);
    if (edge.propertyAlias !== undefined)
      requiredString(edge.propertyAlias, `${path}.propertyAlias`);
    if (
      edge.role !== undefined &&
      !["content", "settings"].includes(String(edge.role))
    )
      throw new Error(`${path}.role is invalid`);
  });
}

export function parseSnapshot(value: unknown): SnapshotParseResult {
  try {
    if (!record(value)) throw new Error("snapshot must be an object");
    if (value.format !== SNAPSHOT_FORMAT)
      throw new Error(`format must be ${SNAPSHOT_FORMAT}`);
    if (value.version !== SNAPSHOT_VERSION)
      throw new Error(`version must be ${SNAPSHOT_VERSION}`);
    const capturedAt = timestamp(value.capturedAt, "capturedAt");
    return {
      snapshot: {
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        capturedAt,
        graph: validateGraph(value.graph),
      },
    };
  } catch (error) {
    return {
      error: `Invalid Schema City snapshot: ${error instanceof Error ? error.message : "unknown format"}`,
    };
  }
}

const stable = (value: unknown): string => JSON.stringify(value);
const byKey = <T>(items: T[], key: (item: T) => string) =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)));

function nodeMatches(
  baseline: SchemaGraph,
  current: SchemaGraph
): Map<string, string> {
  const matches = new Map<string, string>();
  const unused = new Set(baseline.nodes.map((node) => node.id));
  for (const node of current.nodes) {
    if (unused.has(node.id)) {
      matches.set(node.id, node.id);
      unused.delete(node.id);
    }
  }
  for (const node of current.nodes) {
    if (matches.has(node.id)) continue;
    const aliases = baseline.nodes.filter(
      (candidate) => unused.has(candidate.id) && candidate.alias === node.alias
    );
    const currentAliasCount = current.nodes.filter(
      (candidate) => candidate.alias === node.alias
    ).length;
    const baselineAliasCount = baseline.nodes.filter(
      (candidate) => candidate.alias === node.alias
    ).length;
    if (
      aliases.length === 1 &&
      currentAliasCount === 1 &&
      baselineAliasCount === 1
    ) {
      matches.set(node.id, aliases[0].id);
      unused.delete(aliases[0].id);
    }
  }
  return matches;
}

function canonicalTargets(
  targets: SchemaProperty["targets"],
  currentToBaseline: Map<string, string>
) {
  return byKey(
    targets.map((target) => ({
      nodeId: currentToBaseline.get(target.nodeId) ?? target.nodeId,
      role: target.role,
    })),
    (target) => stable(target)
  );
}

function canonicalProperty(
  property: SchemaProperty,
  currentToBaseline: Map<string, string>
) {
  return {
    alias: property.alias,
    name: property.name,
    dataTypeId: property.dataTypeId,
    editorAlias: property.editorAlias,
    editorUiAlias: property.editorUiAlias,
    mandatory: property.mandatory,
    variesByCulture: property.variesByCulture,
    fromCompositionId: property.fromCompositionId
      ? (currentToBaseline.get(property.fromCompositionId) ??
        property.fromCompositionId)
      : null,
    targets: canonicalTargets(property.targets, currentToBaseline),
  };
}

function canonicalGroups(
  groups: PropertyGroup[],
  currentToBaseline: Map<string, string>
) {
  return byKey(
    groups.map((group) => ({
      alias: group.alias,
      name: group.name,
      type: group.type,
      parentAlias: group.parentAlias,
      fromCompositionId: group.fromCompositionId
        ? (currentToBaseline.get(group.fromCompositionId) ??
          group.fromCompositionId)
        : null,
      properties: byKey(
        group.properties.map((property) =>
          canonicalProperty(property, currentToBaseline)
        ),
        (property) => property.alias
      ),
    })),
    (group) => group.alias
  );
}

function folderPath(
  graph: SchemaGraph,
  folderId: string | null
): string | null {
  const folders = new Map(graph.folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = folderId;
  while (current !== null) {
    if (seen.has(current)) return `cycle:${current}`;
    seen.add(current);
    const folder = folders.get(current);
    if (!folder) return `missing:${current}`;
    parts.unshift(folder.name);
    current = folder.parentId;
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function nodeShape(
  graph: SchemaGraph,
  node: SchemaNode,
  currentToBaseline: Map<string, string>
) {
  return {
    alias: node.alias,
    name: node.name,
    icon: node.icon,
    iconColor: node.iconColor,
    folderPath: folderPath(graph, node.folderId),
    isElement: node.isElement,
    allowedAsRoot: node.allowedAsRoot,
    variesByCulture: node.variesByCulture,
    variesBySegment: node.variesBySegment,
    description: node.description,
    ownPropertyCount: node.ownPropertyCount,
    composedPropertyCount: node.composedPropertyCount,
    groups: canonicalGroups(node.groups, currentToBaseline),
    templates: byKey(
      node.templates.map((template) => ({
        alias: template.alias,
        name: template.name,
        isDefault: template.isDefault,
      })),
      (template) => template.alias
    ),
  };
}

function edgeShape(graph: SchemaGraph, currentToBaseline: Map<string, string>) {
  return byKey(
    graph.edges.map((edge) => ({
      kind: edge.kind,
      from: currentToBaseline.get(edge.from) ?? edge.from,
      to: currentToBaseline.get(edge.to) ?? edge.to,
      propertyAlias: edge.propertyAlias,
      role: edge.role,
    })),
    (edge) => stable(edge)
  );
}

function propertyDiff(
  groupAlias: string,
  oldProperty: SchemaProperty,
  property: SchemaProperty,
  matches: Map<string, string>
): string[] {
  const details: string[] = [];
  for (const key of [
    "name",
    "dataTypeId",
    "editorAlias",
    "editorUiAlias",
    "mandatory",
    "variesByCulture",
  ] as const)
    if (oldProperty[key] !== property[key])
      details.push(
        `property ${groupAlias}.${property.alias} ${key}: ${JSON.stringify(oldProperty[key])} -> ${JSON.stringify(property[key])}`
      );
  const oldTargets = new Set(
    oldProperty.targets.map((target) => `${target.nodeId}:${target.role}`)
  );
  const newTargets = new Set(
    property.targets.map(
      (target) =>
        `${matches.get(target.nodeId) ?? target.nodeId}:${target.role}`
    )
  );
  for (const target of property.targets) {
    const key = `${matches.get(target.nodeId) ?? target.nodeId}:${target.role}`;
    if (!oldTargets.has(key))
      details.push(
        `target added: ${groupAlias}.${property.alias} -> ${target.nodeId} (${target.role})`
      );
  }
  for (const target of oldProperty.targets)
    if (!newTargets.has(`${target.nodeId}:${target.role}`))
      details.push(
        `target removed: ${groupAlias}.${property.alias} -> ${target.nodeId} (${target.role})`
      );
  return details;
}

function groupDiff(
  oldGroup: PropertyGroup,
  group: PropertyGroup,
  matches: Map<string, string>
): string[] {
  const details: string[] = [];
  for (const key of ["name", "type", "parentAlias"] as const)
    if (oldGroup[key] !== group[key])
      details.push(
        `group ${group.alias} ${key}: ${oldGroup[key] ?? "none"} -> ${group[key] ?? "none"}`
      );
  const oldProperties = new Map(
    oldGroup.properties.map((property) => [property.alias, property])
  );
  const newProperties = new Map(
    group.properties.map((property) => [property.alias, property])
  );
  const detailsForProperty = (property: SchemaProperty) => {
    const oldProperty = oldProperties.get(property.alias);
    return oldProperty
      ? propertyDiff(group.alias, oldProperty, property, matches)
      : [`property added: ${group.alias}.${property.alias}`];
  };
  for (const property of group.properties)
    details.push(...detailsForProperty(property));
  for (const property of oldGroup.properties)
    if (!newProperties.has(property.alias))
      details.push(`property removed: ${group.alias}.${property.alias}`);
  return details;
}

function detailedGroups(
  before: SchemaNode,
  after: SchemaNode,
  matches: Map<string, string>
): string[] {
  const details: string[] = [];
  const oldGroups = new Map(before.groups.map((group) => [group.alias, group]));
  const newGroups = new Map(after.groups.map((group) => [group.alias, group]));
  for (const group of after.groups) {
    const oldGroup = oldGroups.get(group.alias);
    if (!oldGroup) {
      details.push(`group added: ${group.alias}`);
      continue;
    }
    details.push(...groupDiff(oldGroup, group, matches));
  }
  for (const group of before.groups)
    if (!newGroups.has(group.alias))
      details.push(`group removed: ${group.alias}`);
  return details;
}

function detailedEdges(
  baseline: SchemaGraph,
  current: SchemaGraph,
  node: SchemaNode,
  matches: Map<string, string>
): string[] {
  const aliases = new Map(
    baseline.nodes.map((candidate) => [candidate.id, candidate.alias])
  );
  const currentAliases = new Map(
    current.nodes.map((candidate) => [candidate.id, candidate.alias])
  );
  const oldEdges = edgeShape(baseline, new Map()).filter(
    (edge) => edge.from === node.id || edge.to === node.id
  );
  const newEdges = edgeShape(current, matches).filter(
    (edge) => edge.from === node.id || edge.to === node.id
  );
  const key = (edge: SchemaEdge) =>
    stable([edge.kind, edge.from, edge.to, edge.propertyAlias, edge.role]);
  const oldKeys = new Set(oldEdges.map(key));
  const newKeys = new Set(newEdges.map(key));
  const label = (edge: SchemaEdge, names: Map<string, string>) =>
    `${edge.kind}: ${names.get(edge.from) ?? edge.from} -> ${names.get(edge.to) ?? edge.to}${edge.propertyAlias ? ` (${edge.propertyAlias})` : ""}`;
  return [
    ...newEdges
      .filter((edge) => !oldKeys.has(key(edge)))
      .map((edge) => `relationship added: ${label(edge, currentAliases)}`),
    ...oldEdges
      .filter((edge) => !newKeys.has(key(edge)))
      .map((edge) => `relationship removed: ${label(edge, aliases)}`),
  ];
}

function detailDiff(
  baseline: SchemaNode,
  current: SchemaNode,
  baselineGraph: SchemaGraph,
  currentGraph: SchemaGraph,
  matches: Map<string, string>
): string[] {
  const details: string[] = [];
  const show = (value: unknown) =>
    typeof value === "string" ? value || "empty" : JSON.stringify(value);
  const before = nodeShape(baselineGraph, baseline, new Map());
  const after = nodeShape(currentGraph, current, matches);
  for (const key of [
    "alias",
    "name",
    "icon",
    "iconColor",
    "folderPath",
    "isElement",
    "allowedAsRoot",
    "variesByCulture",
    "variesBySegment",
    "description",
    "ownPropertyCount",
    "composedPropertyCount",
  ] as const) {
    if (stable(before[key]) !== stable(after[key]))
      details.push(`${key}: ${show(before[key])} -> ${show(after[key])}`);
  }
  if (stable(before.groups) !== stable(after.groups))
    details.push(...detailedGroups(baseline, current, matches));
  if (stable(before.templates) !== stable(after.templates))
    details.push("templates changed");
  const beforeEdges = edgeShape(baselineGraph, new Map()).filter(
    (edge) => edge.from === baseline.id || edge.to === baseline.id
  );
  const afterEdges = edgeShape(currentGraph, matches).filter(
    (edge) => edge.from === baseline.id || edge.to === baseline.id
  );
  if (stable(beforeEdges) !== stable(afterEdges))
    details.push(
      ...detailedEdges(baselineGraph, currentGraph, baseline, matches)
    );
  return details;
}

export function compareSchemas(
  baseline: SchemaGraph,
  current: SchemaGraph
): SchemaComparison {
  const matches = nodeMatches(baseline, current);
  const baselineById = new Map(baseline.nodes.map((node) => [node.id, node]));
  const added: SchemaChange[] = [];
  const removed: SchemaChange[] = [];
  const changed: SchemaChange[] = [];
  for (const node of byKey(current.nodes, (candidate) => candidate.alias)) {
    const baselineId = matches.get(node.id);
    if (!baselineId) {
      added.push({
        status: "added",
        name: node.name,
        alias: node.alias,
        currentId: node.id,
        details: ["type added"],
      });
      continue;
    }
    const previous = baselineById.get(baselineId);
    if (!previous) continue;
    const details = detailDiff(previous, node, baseline, current, matches);
    if (details.length > 0)
      changed.push({
        status: "changed",
        name: node.name,
        alias: node.alias,
        currentId: node.id,
        baselineId,
        details,
      });
  }
  for (const node of byKey(baseline.nodes, (candidate) => candidate.alias)) {
    if (![...matches.values()].includes(node.id))
      removed.push({
        status: "removed",
        name: node.name,
        alias: node.alias,
        baselineId: node.id,
        details: [
          "type removed",
          ...node.groups.flatMap((group) =>
            group.properties.map(
              (property) =>
                `property in baseline: ${group.alias}.${property.alias}`
            )
          ),
          ...baseline.edges
            .filter((edge) => edge.from === node.id || edge.to === node.id)
            .map((edge) => {
              const aliases = new Map(
                baseline.nodes.map((candidate) => [
                  candidate.id,
                  candidate.alias,
                ])
              );
              return `relationship in baseline: ${edge.kind} ${aliases.get(edge.from) ?? edge.from} -> ${aliases.get(edge.to) ?? edge.to}${edge.propertyAlias ? ` (${edge.propertyAlias})` : ""}`;
            }),
        ],
      });
  }
  return { added, removed, changed, matches };
}
