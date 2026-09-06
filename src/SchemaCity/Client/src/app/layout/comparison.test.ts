import { expect, test } from "vitest";
import medium from "../../../dev/fixtures/medium.json";
import { compareSchemas } from "../../model/snapshots";
import type { SchemaGraph } from "../../model/types";
import { cityDistricts, DISTRICT_GAP } from "./city";
import { comparisonCity } from "./comparison";

const baseline = medium as SchemaGraph;

test("adding and removing types preserves matched baseline coordinates", () => {
  const [removed] = baseline.nodes;
  const added = { ...baseline.nodes[1], id: "new-type", alias: "aaaNewType" };
  const current = {
    ...baseline,
    nodes: [...baseline.nodes.filter((node) => node.id !== removed.id), added],
  };
  const result = comparisonCity(
    baseline,
    current,
    compareSchemas(baseline, current).matches
  );
  const before = new Map(
    cityDistricts(baseline).placements.map((at) => [at.id, at.position])
  );
  for (const at of result.placements.filter((at) => at.id !== added.id))
    expect(at.position).toEqual(before.get(at.id));
  expect(result.placements.some((at) => at.id === removed.id)).toBe(false);
  const east = Math.max(
    ...cityDistricts(baseline).districts.map((d) => d.maxX)
  );
  const addedDistrict = result.districts.find((d) => d.id.startsWith("added/"));
  expect(addedDistrict?.minX).toBeGreaterThanOrEqual(east + DISTRICT_GAP);
});

test("alias-matched types keep their places across environment key changes", () => {
  const current = {
    ...baseline,
    nodes: baseline.nodes.map((node) => ({ ...node, id: `other-${node.id}` })),
    edges: baseline.edges.map((edge) => ({
      ...edge,
      from: `other-${edge.from}`,
      to: `other-${edge.to}`,
    })),
  };
  const result = comparisonCity(
    baseline,
    current,
    compareSchemas(baseline, current).matches
  );
  const before = cityDistricts(baseline);
  for (const at of before.placements)
    expect(
      result.placements.find((next) => next.id === `other-${at.id}`)?.position
    ).toEqual(at.position);
});
