import { expect, it } from "vitest";
import { GENERIC_TAB } from "../model/editor-layout";
import { hasTabRow } from "./EditorLayout";

const tab = (key: string) => ({
  key,
  name: key || GENERIC_TAB,
  panels: [],
  count: 1,
});

it("draws a tab row only when the type has real tabs", () => {
  expect(hasTabRow([])).toBe(false);
  expect(hasTabRow([tab("")])).toBe(false);
  expect(hasTabRow([tab(""), tab("content")])).toBe(true);
  expect(hasTabRow([tab("content")])).toBe(true);
});
