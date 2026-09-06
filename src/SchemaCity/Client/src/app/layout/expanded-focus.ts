import type { Placement } from "./city";

const GAP = 3;
const STREET = 9;
const ROW_LIMIT = 8;

/** Adds one stable band of newly reached nodes below the existing focused layout. */
export function expandFocusLayout(
  cityPlacements: Placement[],
  directLayout: Placement[],
  directIds: ReadonlySet<string>,
  expandedIds: ReadonlySet<string>
): Placement[] {
  const cityById = new Map(
    cityPlacements.map((placement) => [placement.id, placement])
  );
  // `layoutFocus` deliberately returns the complete city array.  Only the
  // focused neighbourhood is replaced, so using every id in `directLayout` as
  // an "existing" id would make expansion a no-op.
  const alreadyExpanded = directLayout.filter((placement) => {
    if (directIds.has(placement.id)) return false;
    const cityPlacement = cityById.get(placement.id);
    return (
      cityPlacement !== undefined &&
      (placement.position.x !== cityPlacement.position.x ||
        placement.position.z !== cityPlacement.position.z)
    );
  });
  const alreadyExpandedIds = new Set(
    alreadyExpanded.map((placement) => placement.id)
  );
  const extra = [...expandedIds]
    .filter((id) => !(directIds.has(id) || alreadyExpandedIds.has(id)))
    .map((id) => cityById.get(id))
    .filter((placement): placement is Placement => placement !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (extra.length === 0) return directLayout;

  const laid = [
    ...directLayout.filter((placement) => directIds.has(placement.id)),
    ...alreadyExpanded,
  ];
  const maxX = Math.max(
    ...laid.map((placement) => placement.position.x + placement.footprint / 2)
  );
  const minX = Math.min(
    ...laid.map((placement) => placement.position.x - placement.footprint / 2)
  );
  const maxZ = Math.max(
    ...laid.map((placement) => placement.position.z + placement.footprint / 2)
  );
  const pitch =
    Math.max(...extra.map((placement) => placement.footprint)) + GAP;
  const centreX = (minX + maxX) / 2;
  const firstZ = maxZ + STREET + pitch / 2;
  const additions = extra.map((placement, index) => {
    const column = index % ROW_LIMIT;
    const row = Math.floor(index / ROW_LIMIT);
    const rowCount = Math.min(ROW_LIMIT, extra.length - row * ROW_LIMIT);
    const rowWidth = rowCount * pitch - GAP;
    return {
      ...placement,
      position: {
        x: centreX - rowWidth / 2 + column * pitch + placement.footprint / 2,
        z: firstZ + row * pitch,
      },
    };
  });
  const additionsById = new Map(
    additions.map((placement) => [placement.id, placement])
  );
  // Preserve the array identity/order contract used by Scene: unrelated city
  // placements stay where layoutFocus put them, while newly expanded nodes are
  // replaced in place with their focused coordinates.
  return directLayout.map(
    (placement) => additionsById.get(placement.id) ?? placement
  );
}
