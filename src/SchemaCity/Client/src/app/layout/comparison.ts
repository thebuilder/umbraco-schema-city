import type { SchemaGraph } from "../../model/types";
import { cityDistricts, DISTRICT_GAP } from "./city";

/** Keep matched types at baseline coordinates; append new districts beside them. */
export function comparisonCity(
  baseline: SchemaGraph,
  current: SchemaGraph,
  matches: ReadonlyMap<string, string>
): ReturnType<typeof cityDistricts> {
  const before = cityDistricts(baseline);
  const currentCity = cityDistricts(current);
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
    return { placements: retained, districts: before.districts };
  const added = cityDistricts({
    ...current,
    nodes: current.nodes.filter((node) => addedIds.has(node.id)),
    edges: current.edges.filter(
      (edge) => addedIds.has(edge.from) && addedIds.has(edge.to)
    ),
  });
  const shift =
    Math.max(0, ...before.districts.map((district) => district.maxX)) +
    DISTRICT_GAP;
  return {
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
