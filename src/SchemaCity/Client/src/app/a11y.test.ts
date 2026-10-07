import { expect, test } from "vitest";
import medium from "../../dev/fixtures/medium.json";
import pathological from "../../dev/fixtures/pathological.json";
import small from "../../dev/fixtures/small.json";
import type { SchemaGraph } from "../model/types";
import { districtCount } from "./a11y";
import { cityDistricts } from "./layout/city";

const fixtures = [small, medium, pathological] as unknown as SchemaGraph[];

test("counts the districts the layout draws, with folders and without", () => {
  for (const graph of fixtures) {
    const unfiled = { ...graph, folders: [] };
    expect(districtCount(graph)).toBe(cityDistricts(graph).districts.length);
    expect(districtCount(unfiled)).toBe(
      cityDistricts(unfiled).districts.length
    );
  }
});
