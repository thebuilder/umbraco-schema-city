import type { SchemaEdge, SchemaNode } from "../model/types";

export type RelationshipDescription = {
  direction: string;
  label: string;
  detail: string;
};

type RelationshipContext = {
  direction: string;
  incoming: boolean;
  property: string;
  source: string;
  target: string;
  role?: SchemaEdge["role"];
};

const relationshipDetails: Record<
  SchemaEdge["kind"],
  (context: RelationshipContext) => Omit<RelationshipDescription, "direction">
> = {
  allowedChild: ({ incoming, source, target }) => ({
    label: incoming ? "Allowed parent" : "Allowed child",
    detail: `${source} allows ${target} beneath it. This is a schema rule, not the content tree.`,
  }),
  composition: ({ incoming, source, target }) => ({
    label: incoming ? "Composition user" : "Composition",
    detail: `${source} uses the ${target} composition.`,
  }),
  inherits: ({ incoming, source, target }) => ({
    label: incoming ? "Inheriting type" : "Inheritance",
    detail: `${source} inherits from ${target}.`,
  }),
  block: ({ incoming, property, role, target }) => ({
    label: incoming ? "Block host" : "Block target",
    detail: `${property} allows ${target} as block ${role === "settings" ? "settings" : "content"}.`,
  }),
  reference: ({ incoming, property, target }) => ({
    label: incoming ? "Picker host" : "Picker target",
    detail: `${property} allows picking ${target}. This is configuration, not observed usage.`,
  }),
};

/** The sentence always follows the actual edge, even when read from its target. */
export function describeRelationship(
  edge: SchemaEdge,
  nodesById: Map<string, SchemaNode>,
  perspectiveId = edge.from
): RelationshipDescription {
  const incoming = edge.to === perspectiveId && edge.from !== perspectiveId;
  const source = nodesById.get(edge.from)?.name ?? edge.from;
  const target = nodesById.get(edge.to)?.name ?? edge.to;
  const direction = incoming ? "Incoming" : "Outgoing";
  const property = edge.propertyAlias
    ? `${source}.${edge.propertyAlias}`
    : source;
  return {
    direction,
    ...relationshipDetails[edge.kind]({
      direction,
      incoming,
      property,
      role: edge.role,
      source,
      target,
    }),
  };
}

export function connectionKey(edge: SchemaEdge) {
  return JSON.stringify([
    edge.kind,
    edge.from,
    edge.to,
    edge.propertyAlias,
    edge.role,
  ]);
}

/** Merged road segments may carry the same relationship more than once. */
export function uniqueConnections(edges: SchemaEdge[]): SchemaEdge[] {
  return [
    ...new Map(edges.map((edge) => [connectionKey(edge), edge])).values(),
  ];
}
