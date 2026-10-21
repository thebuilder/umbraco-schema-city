// Afterglow's phosphor presets, the colour the whole screen glows in. The tokens
// each one sets are in styles.css under [data-phosphor]; this is the list the menu
// offers and where the choice is kept.
import { type RefObject, useCallback, useEffect, useState } from "react";

/**
 * Afterglow's own names and swatches. Green is the default and the only one drawn
 * from the base tokens. Cyan, blue, magenta and red are left out: each lands on a
 * colour the city already uses for a relation (azure compositions, violet pickers,
 * the signal pink of a problem), so a building and a link would read the same.
 */
export const PHOSPHORS = [
  { value: "green", label: "Green", color: "#86fadd" },
  { value: "orange", label: "Orange", color: "#ff9d4d" },
  { value: "yellow", label: "Yellow", color: "#f4e66d" },
  { value: "grey", label: "Grey", color: "#c5cbc9" },
] as const;

export type Phosphor = (typeof PHOSPHORS)[number]["value"];

const DEFAULT: Phosphor = "green";
const STORAGE_KEY = "schema-city:phosphor";

const isPhosphor = (value: unknown): value is Phosphor =>
  PHOSPHORS.some((phosphor) => phosphor.value === value);

/** The stored choice, or green where storage is empty, unknown or refused. */
function stored(): Phosphor {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isPhosphor(value) ? value : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * The phosphor and its setter. Kept per browser, like the intro and the hint: it is
 * how one reader likes the screen, not a setting of the site.
 */
export function usePhosphor() {
  const [phosphor, setState] = useState<Phosphor>(stored);
  const setPhosphor = useCallback((next: Phosphor) => {
    setState(next);
    try {
      if (next === DEFAULT) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A private window or blocked storage: the choice lasts until reload.
    }
  }, []);
  return { value: phosphor, onChange: setPhosphor };
}

/** The app's root, where the phosphor is set and every token below it follows. */
export const appRoot = (element: Element | null | undefined) =>
  element?.closest("[data-schema-city]") ?? null;

/**
 * The phosphor on the app root above `element`, following it as it changes, for
 * what cannot read CSS variables live: the city's canvas.
 */
export function usePhosphorOf(element: RefObject<HTMLElement | null>) {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const root = appRoot(element.current);
    if (!root) return;
    const read = () => setValue(root.getAttribute("data-phosphor"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributeFilter: ["data-phosphor"],
      attributes: true,
    });
    return () => observer.disconnect();
  }, [element]);
  return value;
}
