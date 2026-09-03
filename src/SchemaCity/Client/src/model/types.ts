// The payload the backend returns, mirrored by the C# records in Models/.
// M0 fills in generatedAt, folders and nodes without groups or edges; M1 completes it.

export type SchemaGraph = {
  generatedAt: string;
  folders: SchemaFolder[];
  nodes: SchemaNode[];
  edges: SchemaEdge[];
};

export type SchemaFolder = { id: string; name: string; parentId: string | null };

export type SchemaNode = {
  id: string;                      // Document Type key (guid)
  alias: string;
  name: string;
  icon: string;                    // "icon-document", colour suffix stripped
  iconColor: string | null;        // "color-blue" if present
  folderId: string | null;
  isElement: boolean;
  allowedAsRoot: boolean;
  variesByCulture: boolean;
  variesBySegment: boolean;
  description: string | null;
  groups: PropertyGroup[];         // ordered tabs/groups, composed ones marked
  ownPropertyCount: number;
  composedPropertyCount: number;
  templates: { id: string; alias: string; name: string; isDefault: boolean }[];
};

export type PropertyGroup = {
  id: string; alias: string; name: string; type: "Tab" | "Group";
  parentAlias: string | null;
  fromCompositionId: string | null;   // null = own
  properties: SchemaProperty[];
};

export type SchemaProperty = {
  alias: string; name: string;
  dataTypeId: string;
  editorAlias: string; editorUiAlias: string | null;
  mandatory: boolean; variesByCulture: boolean;
  fromCompositionId: string | null;
  /** Element Types this property can contain (block editors) or point at (pickers). */
  targets: { nodeId: string; role: "content" | "settings" | "picker" }[];
};

export type EdgeKind =
  | "allowedChild"    // from parent type -> to child type
  | "composition"     // from user -> to composition
  | "inherits"        // from child -> to parent (ParentId, also present as composition)
  | "block"           // from host type -> to element type, via propertyAlias
  | "reference";      // from picker host -> to allowed target type, via propertyAlias

export type SchemaEdge = {
  kind: EdgeKind; from: string; to: string;
  propertyAlias?: string; role?: "content" | "settings";
};

export type UsageReport = {
  generatedAt: string;
  byType: Record<string, TypeUsage>;         // keyed by node id
  references: { fromType: string; toType: string; count: number }[];  // instance-level, aggregated
};

export type TypeUsage = {
  total: number; published: number; drafts: number; trashed: number;
  rootInstances: number;
  cultures: string[];                          // cultures with at least one variant
  lastEdited: string | null;
};
