import type { PropertyGroup, SchemaNode } from "../model/types";
import { DataTypeName } from "./InspectorChips";

type Lookup = Map<string, SchemaNode>;

/**
 * The composition a group or property comes from. A whole group can come from one
 * composition, and then the header already says so, so only a property that
 * differs from its group passes an id.
 */
function From({ id, nodesById }: { id: string | null; nodesById: Lookup }) {
  if (!id) return null;
  return (
    <span className="text-azure text-xs">
      from {nodesById.get(id)?.name ?? "a deleted type"}
    </span>
  );
}

function Rows({
  group,
  nodesById,
}: {
  group: PropertyGroup;
  nodesById: Lookup;
}) {
  return (
    <ul>
      {group.properties.map((property) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-line/40 border-t px-2.5 py-1.5 first:border-t-0"
          key={property.alias}
        >
          <div className="min-w-0">
            <p className="truncate text-prose">
              {property.name}
              {property.mandatory ? (
                <span className="text-signal" title="Mandatory">
                  {" *"}
                </span>
              ) : null}
            </p>
            <p className="truncate font-mono text-2xs text-faint">
              {property.alias}
            </p>
            <From
              id={
                property.fromCompositionId === group.fromCompositionId
                  ? null
                  : property.fromCompositionId
              }
              nodesById={nodesById}
            />
          </div>
          <DataTypeName
            className="block max-w-40 truncate text-right text-label text-xs"
            property={property}
          />
        </li>
      ))}
    </ul>
  );
}

function GroupHeader({
  group,
  nodesById,
}: {
  group: PropertyGroup;
  nodesById: Lookup;
}) {
  return (
    <>
      <span className="truncate">{group.name}</span>
      {group.type === "Tab" ? (
        <span className="font-mono font-normal text-2xs text-faint">tab</span>
      ) : null}
      <span className="font-mono font-normal text-2xs text-faint">
        {group.properties.length}
      </span>
      {group.fromCompositionId ? (
        <span className="ml-auto shrink-0 font-normal">
          <From id={group.fromCompositionId} nodesById={nodesById} />
        </span>
      ) : null}
    </>
  );
}

/**
 * Top-level groups, each tab with the groups it holds. Anything whose parent alias
 * resolves to nothing is drawn at the top level rather than hidden. When the type
 * and a composition both declare a tab under one alias, its groups go under the
 * first of them only.
 */
export function topGroups(
  groups: PropertyGroup[]
): (PropertyGroup & { children: PropertyGroup[] })[] {
  const top = groups.filter(
    (group) =>
      group.parentAlias === null ||
      !groups.some((candidate) => candidate.alias === group.parentAlias)
  );
  return top.map((group) => ({
    ...group,
    children:
      top.find((first) => first.alias === group.alias) === group
        ? groups.filter((child) => child.parentAlias === group.alias)
        : [],
  }));
}

export function InspectorProperties({
  node,
  nodesById,
}: {
  node: SchemaNode;
  nodesById: Lookup;
}) {
  const { groups } = node;
  if (groups.length === 0)
    return <p className="py-3.5 text-faint text-xs">No properties.</p>;
  const top = topGroups(groups);
  const total = node.ownPropertyCount + node.composedPropertyCount;

  return (
    <div className="space-y-2 py-3.5">
      <p className="text-label text-xs">
        {total} {total === 1 ? "property" : "properties"}:{" "}
        {node.ownPropertyCount} own, {node.composedPropertyCount} composed
      </p>
      {top.map((group) => (
        <section className="border border-line" key={group.id}>
          <h3 className="flex items-baseline gap-2 border-line border-b bg-muted px-2.5 py-1.5 font-medium">
            <GroupHeader group={group} nodesById={nodesById} />
          </h3>
          <Rows group={group} nodesById={nodesById} />
          {group.children.map((child) => (
            <div className="border-line border-t" key={child.id}>
              <h4 className="flex items-baseline gap-2 px-2.5 pt-2 font-medium text-label text-xs">
                <GroupHeader group={child} nodesById={nodesById} />
              </h4>
              <Rows group={child} nodesById={nodesById} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
