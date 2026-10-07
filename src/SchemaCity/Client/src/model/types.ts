// The payload the backend returns, mirrored by the C# records in Models/.
// Every property is filled in since M1; dataTypes arrived with the Data Types view.

export type SchemaGraph = {
  generatedAt: string;
  folders: SchemaFolder[];
  nodes: SchemaNode[];
  edges: SchemaEdge[];
  /**
   * Every Data Type in the site, used or not. Graphs and snapshots from before the
   * Data Types view lack it, and then the client knows only the ones properties name.
   */
  dataTypes?: SchemaDataType[];
};

export type SchemaTarget = {
  nodeId: string;
  role: "content" | "settings" | "picker";
};

export type SchemaDataType = {
  id: string; // Data Type key (guid)
  name: string;
  editorAlias: string;
  editorUiAlias: string | null;
  /** Folder path, "Blocks/Grids", or null at the root. */
  folder: string | null;
  /** Element Types a block editor offers and Document Types a picker allows, missing keys included. */
  targets: SchemaTarget[];
  /** Media and Member Type properties and collection views using it, which have no node here. */
  otherUses: number;
  /** A few cheap values, such as a block list's min and max. Only for the editors read. */
  configuration?: Record<string, string | number | boolean>;
};

export type SchemaFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type SchemaNode = {
  id: string; // Document Type key (guid)
  alias: string;
  name: string;
  icon: string; // "icon-document", colour suffix stripped
  iconColor: string | null; // "color-blue" if present
  folderId: string | null;
  isElement: boolean;
  allowedAsRoot: boolean;
  variesByCulture: boolean;
  variesBySegment: boolean;
  description: string | null;
  groups: PropertyGroup[]; // ordered tabs/groups, composed ones marked
  ownPropertyCount: number;
  composedPropertyCount: number;
  templates: { id: string; alias: string; name: string; isDefault: boolean }[];
};

export type PropertyGroup = {
  id: string;
  alias: string;
  name: string;
  type: "Tab" | "Group";
  parentAlias: string | null;
  fromCompositionId: string | null; // null = own
  properties: SchemaProperty[];
};

export type SchemaProperty = {
  alias: string;
  name: string;
  dataTypeId: string;
  /** Null when the Data Type could not be found. Snapshots exported before it existed lack it. */
  dataTypeName?: string | null;
  editorAlias: string;
  editorUiAlias: string | null;
  mandatory: boolean;
  variesByCulture: boolean;
  fromCompositionId: string | null;
  /** Element Types this property can contain (block editors) or point at (pickers). */
  targets: SchemaTarget[];
};

export type EdgeKind =
  | "allowedChild" // from parent type -> to child type
  | "composition" // from user -> to composition
  | "inherits" // from child -> to parent (ParentId, also present as composition)
  | "block" // from host type -> to element type, via propertyAlias
  | "reference"; // from picker host -> to allowed target type, via propertyAlias

export type SchemaEdge = {
  kind: EdgeKind;
  from: string;
  to: string;
  propertyAlias?: string;
  role?: "content" | "settings";
};

export type UsageReport = {
  generatedAt: string;
  byType: Record<string, TypeUsage>; // keyed by node id
  references: { fromType: string; toType: string; count: number }[]; // instance-level, aggregated
  /** Stored block instances. Reports from before block counting lack it. */
  blocks?: BlockUsage;
};

/**
 * Blocks stored in the latest version of every document outside the recycle bin.
 * `partial` means the count stopped at its row cap or time budget, or failed, so
 * every number is a lower bound.
 */
export type BlockUsage = {
  partial: boolean;
  valuesRead: number;
  /** Values that were not valid JSON, and so could not be read. */
  unreadable: number;
  byDataType: DataTypeBlocks[];
};

export type DataTypeBlocks = {
  dataTypeId: string;
  /** Property values holding JSON. A nested editor can have none of its own. */
  values: number;
  /** Content items with at least one block in this Data Type. */
  items: number;
  elements: ElementBlocks[];
};

export type ElementBlocks = {
  elementTypeId: string;
  content: number;
  settings: number;
  items: number;
};

export type TypeUsage = {
  total: number;
  published: number;
  drafts: number;
  trashed: number;
  rootInstances: number;
  cultures: string[]; // cultures with at least one variant
  lastEdited: string | null;
};
