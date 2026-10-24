import { expect, test } from "vitest";
import { iconColour, iconMask, paintedSvg } from "./icons";

test("an icon colour is Umbraco's suffix, or the theme's own", () => {
  expect(iconColour("color-red", "#0f0")).toBe("red");
  expect(iconColour("color-deep-purple", "#0f0")).toBe("#673ab7");
  expect(iconColour(null, "#0f0")).toBe("#0f0");
  // Nothing that could close the attribute it is written into gets through.
  expect(iconColour('red" onload="x', "#0f0")).toBe("#0f0");
});

test("a painted icon carries one colour and one size", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512">' +
    '<path fill="currentColor" d="M0 0h512v512H0z"/></svg>';
  const painted = paintedSvg(svg, "red");

  expect(painted).not.toContain("currentColor");
  // The root's own fill covers the icons that name no fill anywhere.
  expect(painted).toContain('<svg width="128" height="128" fill="red"');
  expect(painted).toContain('viewBox="0 0 512 512"');
  expect(painted.match(/width=/g)).toHaveLength(1);
});

test("an outline icon keeps the fill it came with", () => {
  const svg =
    '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor"><circle r="8"/></svg>';
  const painted = paintedSvg(svg, "red");

  expect(painted).toContain('fill="none"');
  expect(painted).toContain('stroke="red"');
  expect(painted).toContain('width="128"');
});

test("an icon used as a mask is a data URL, not markup", () => {
  const mask = iconMask('<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>');

  expect(mask.startsWith('url("data:image/svg+xml;charset=utf-8,')).toBe(true);
  // The quotes that would close the CSS url() are encoded away.
  expect(mask.slice('url("'.length, -2)).not.toContain('"');
});
