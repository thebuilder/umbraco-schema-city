// Data Types as pages of their own: every one the schema has, what uses it, what
// it offers and how many blocks content stores in it. Pure: no DOM, no React.
import type {
  SchemaDataType,
  SchemaGraph,
  SchemaNode,
  SchemaProperty,
  UsageReport,
} from "./types";

/** The editors whose stored values hold blocks. TinyMCE is rich text before Umbraco 14. */
const BLOCK_EDITORS: ReadonlySet<string> = new Set([
  "Umbraco.BlockList",
  "Umbraco.BlockGrid",
  "Umbraco.RichText",
  "Umbraco.TinyMCE",
  "Umbraco.SingleBlock",
]);

export const isBlockEditor = (dataType: SchemaDataType) =>
  BLOCK_EDITORS.has(dataType.editorAlias);

const UI_PREFIX = /^Umb\.PropertyEditorUi\./;

/** "BlockGrid" for Umb.PropertyEditorUi.BlockGrid, the editor alias without a UI alias. */
export const editorName = (dataType: SchemaDataType) =>
  dataType.editorUiAlias
    ? dataType.editorUiAlias.replace(UI_PREFIX, "")
    : dataType.editorAlias;

export type DataTypeRow = SchemaDataType & {
  /** The editor as the list shows it, see editorName. */
  editor: string;
  /** Property definitions on it, each counted once, on the type that declares it. */
  properties: number;
  /** Types with a property on it, their own or from a composition. */
  types: number;
  /** False for one only a property names, from a graph that lists no Data Types. */
  listed: boolean;
  /** Blocks stored in it, or null for an editor that holds none or without counts. */
  stored: number | null;
};

const propertiesOf = (node: SchemaNode): SchemaProperty[] =>
  (node.groups ?? []).flatMap((group) => group.properties);

/**
 * Every Data Type, by name. A graph from before the Data Types list still names the
 * ones its properties use, so those are filled in from the first property found.
 */
export function dataTypeIndex(
  graph: SchemaGraph,
  usage?: UsageReport
): DataTypeRow[] {
  const known = new Map<string, { dataType: SchemaDataType; listed: boolean }>(
    (graph.dataTypes ?? []).map((dataType) => [
      dataType.id,
      { dataType, listed: true },
    ])
  );
  const properties = new Map<string, number>();
  const types = new Map<string, Set<string>>();
  for (const node of graph.nodes)
    for (const property of propertiesOf(node)) {
      const id = property.dataTypeId;
      if (!known.has(id))
        known.set(id, {
          dataType: {
            id,
            name: property.dataTypeName ?? property.editorAlias,
            editorAlias: property.editorAlias,
            editorUiAlias: property.editorUiAlias,
            folder: null,
            targets: property.targets,
            otherUses: 0,
          },
          listed: false,
        });
      if (!property.fromCompositionId)
        properties.set(id, (properties.get(id) ?? 0) + 1);
      types.set(id, (types.get(id) ?? new Set()).add(node.id));
    }

  const stored = storedTotals(usage);
  return [...known.values()]
    .map(({ dataType, listed }) => ({
      ...dataType,
      editor: editorName(dataType),
      properties: properties.get(dataType.id) ?? 0,
      types: types.get(dataType.id)?.size ?? 0,
      listed,
      stored:
        usage?.blocks && isBlockEditor(dataType)
          ? (stored.get(dataType.id)?.blocks ?? 0)
          : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Data Type id to its name, from the list or from the properties that name it. */
export const dataTypeNames = (graph: SchemaGraph) =>
  new Map(dataTypeIndex(graph).map((row) => [row.id, row.name]));

export type DataTypeUser = {
  node: SchemaNode;
  /** Its properties on the Data Type, composed ones with the composition they come from. */
  properties: SchemaProperty[];
};

/** Every type with a property on the Data Type, by name. */
export function dataTypeUsers(graph: SchemaGraph, id: string): DataTypeUser[] {
  return graph.nodes
    .map((node) => ({
      node,
      properties: propertiesOf(node).filter(
        (property) => property.dataTypeId === id
      ),
    }))
    .filter((user) => user.properties.length > 0)
    .sort((a, b) => a.node.name.localeCompare(b.node.name));
}

type Totals = {
  content: number;
  settings: number;
  blocks: number;
  /** Content items holding any of them; per Data Type, so never summed across them. */
  items: number;
  values: number;
};

/** Per Data Type, its stored blocks added up over the Element Types. */
export function storedTotals(usage?: UsageReport): Map<string, Totals> {
  return new Map(
    (usage?.blocks?.byDataType ?? []).map((row) => {
      const content = row.elements.reduce((sum, e) => sum + e.content, 0);
      const settings = row.elements.reduce((sum, e) => sum + e.settings, 0);
      return [
        row.dataTypeId,
        {
          content,
          settings,
          blocks: content + settings,
          items: row.items,
          values: row.values,
        },
      ];
    })
  );
}

/**
 * Per Element Type, the blocks of it stored anywhere and the Data Types they are
 * stored in, for the findings that ask whether content still uses one.
 */
export function storedByElementType(
  usage?: UsageReport
): Map<string, { blocks: number; dataTypeIds: string[] }> {
  const out = new Map<string, { blocks: number; dataTypeIds: string[] }>();
  for (const row of usage?.blocks?.byDataType ?? [])
    for (const element of row.elements) {
      const blocks = element.content + element.settings;
      if (blocks === 0) continue;
      const was = out.get(element.elementTypeId);
      out.set(element.elementTypeId, {
        blocks: (was?.blocks ?? 0) + blocks,
        dataTypeIds: [...(was?.dataTypeIds ?? []), row.dataTypeId],
      });
    }
  return out;
}

export type BlockChip = {
  /** The Element Type key. */
  id: string;
  /** Null when the key resolves to no type, which is a broken block reference. */
  name: string | null;
  /** Blocks of it stored in this Data Type, null without block counts. */
  stored: number | null;
};

/**
 * What a block editor offers, as content and as settings, each with its stored
 * count, plus the Element Types content stores in it that it no longer offers.
 */
export function allowedBlocks(
  dataType: SchemaDataType,
  usage: UsageReport | undefined,
  nodesById: Map<string, SchemaNode>
): { content: BlockChip[]; settings: BlockChip[]; notOffered: BlockChip[] } {
  const row = usage?.blocks?.byDataType.find(
    (entry) => entry.dataTypeId === dataType.id
  );
  const counted = new Map(
    (row?.elements ?? []).map((element) => [element.elementTypeId, element])
  );
  const chip = (id: string, role: "content" | "settings"): BlockChip => {
    const element = counted.get(id);
    return {
      id,
      name: nodesById.get(id)?.name ?? null,
      stored: usage?.blocks ? (element?.[role] ?? 0) : null,
    };
  };
  const offered = (role: "content" | "settings") => [
    ...new Set(
      dataType.targets.filter((t) => t.role === role).map((t) => t.nodeId)
    ),
  ];
  const listed = new Set(dataType.targets.map((target) => target.nodeId));
  return {
    content: offered("content").map((id) => chip(id, "content")),
    settings: offered("settings").map((id) => chip(id, "settings")),
    notOffered: [...counted.values()]
      .filter((element) => !listed.has(element.elementTypeId))
      .map((element) => ({
        id: element.elementTypeId,
        name: nodesById.get(element.elementTypeId)?.name ?? null,
        stored: element.content + element.settings,
      })),
  };
}

/** Rows whose name, editor or key contains the query, ignoring case. */
export function matchDataTypes(
  rows: DataTypeRow[],
  query: string
): DataTypeRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [row.name, row.editorAlias, row.editorUiAlias ?? "", row.id].some((text) =>
      text.toLowerCase().includes(needle)
    )
  );
}
