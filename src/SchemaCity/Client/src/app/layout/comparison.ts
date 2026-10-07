import type { SchemaGraph } from "../../model/types";
import {
  cityDistricts,
  DISTRICT_GAP,
  type Grouping,
  type Placement,
} from "./city";

/**
 * Keep matched types at baseline coordinates; append new districts beside them.
 * `removed` holds where the baseline's removed types stood, for their outlines.
 */
export function comparisonCity(
  baseline: SchemaGraph,
  current: SchemaGraph,
  matches: ReadonlyMap<string, string>,
  grouping: Grouping = "structure"
): ReturnType<typeof cityDistricts> & { removed: Placement[] } {
  const before = cityDistricts(baseline, grouping);
  const kept = new Set(matches.values());
  const removed = before.placements.filter((at) => !kept.has(at.id));
  const currentCity = cityDistricts(current, grouping);
  const byId = new Map(
    before.placements.map((placement) => [placement.id, placement])
  );
  const retained = currentCity.placements.flatMap((placement) => {
    const previous = byId.get(matches.get(placement.id) ?? "");
    return previous
      ? [
          {
            ...placement,
            position: { ...previous.position },
            district: previous.district,
            districtKind: previous.districtKind,
          },
        ]
      : [];
  });
  const addedIds = new Set(
    current.nodes.filter((node) => !matches.has(node.id)).map((node) => node.id)
  );
  if (addedIds.size === 0)
    return { placements: retained, districts: before.districts, removed };
  const added = cityDistricts(
    {
      ...current,
      nodes: current.nodes.filter((node) => addedIds.has(node.id)),
      edges: current.edges.filter(
        (edge) => addedIds.has(edge.from) && addedIds.has(edge.to)
      ),
    },
    grouping
  );
  const shift =
    Math.max(0, ...before.districts.map((district) => district.maxX)) +
    DISTRICT_GAP;
  return {
    removed,
    placements: [
      ...retained,
      ...added.placements.map((placement) => ({
        ...placement,
        position: { x: placement.position.x + shift, z: placement.position.z },
        district: `added/${placement.district}`,
      })),
    ],
    districts: [
      ...before.districts,
      ...added.districts.map((district) => ({
        ...district,
        id: `added/${district.id}`,
        name: `Added · ${district.name}`,
        minX: district.minX + shift,
        maxX: district.maxX + shift,
        centre: { x: district.centre.x + shift, z: district.centre.z },
      })),
    ],
  };
}
