import { expect, test } from "vitest";
import { enterFocuses } from "./shortcuts";

const element = (tagName: string, role: string | null = null) => ({
  tagName,
  getAttribute: (name: string) => (name === "role" ? role : null),
});
const CITY = element("DIV", "application");
const BODY = element("BODY");
/** The path a keydown takes from `from` out to the window. */
const enter = (from: unknown, extra: object = {}) => ({
  key: "Enter",
  defaultPrevented: false,
  composedPath: () => [from, CITY, BODY, {}, {}],
  ...extra,
});

test("Enter on the city or an unfocused page focuses the selected type", () => {
  expect(enterFocuses(enter(CITY))).toBe(true);
  expect(enterFocuses({ ...enter(BODY), composedPath: () => [BODY, {}] })).toBe(
    true
  );
});

test("Enter that presses a control is left to the control", () => {
  for (const from of [
    element("BUTTON"),
    element("A"),
    element("SUMMARY"),
    element("INPUT"),
    element("SELECT"),
    element("TEXTAREA"),
    element("DIV", "tab"),
    element("DIV", "option"),
  ])
    expect(enterFocuses(enter(from))).toBe(false);
  // A span inside a row button is still the row's.
  expect(
    enterFocuses({
      ...enter(null),
      composedPath: () => [element("SPAN"), element("BUTTON"), BODY],
    })
  ).toBe(false);
});

test("Enter another handler took, or any other key, focuses nothing", () => {
  expect(enterFocuses(enter(CITY, { defaultPrevented: true }))).toBe(false);
  expect(enterFocuses(enter(CITY, { key: "a" }))).toBe(false);
});
