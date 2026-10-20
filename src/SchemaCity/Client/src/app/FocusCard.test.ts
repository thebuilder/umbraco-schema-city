import { expect, it } from "vitest";
import type { SchemaNode } from "../model/types";
import { focusCardNode } from "./FocusCard";

const home = { id: "home", name: "Home" } as SchemaNode;
const nodes = new Map([[home.id, home]]);

it("names the focused type once nothing is selected", () => {
  expect(focusCardNode("home", null, false, nodes)).toBe(home);
});

it("stays away while a type is selected, over a 2D view or without a focus", () => {
  expect(focusCardNode("home", "home", false, nodes)).toBeUndefined();
  expect(focusCardNode("home", null, true, nodes)).toBeUndefined();
  expect(focusCardNode(null, null, false, nodes)).toBeUndefined();
});
