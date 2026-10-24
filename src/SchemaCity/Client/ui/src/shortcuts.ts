// Which keystrokes the app's own shortcuts may take. Pure: reads the event's path
// as plain objects, so it is tested without a DOM.

const CONTROL_TAGS: ReadonlySet<unknown> = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "SUMMARY",
  "TEXTAREA",
]);
const CONTROL_ROLES: ReadonlySet<unknown> = new Set(["option", "tab"]);

type Hop = {
  tagName?: unknown;
  getAttribute?: (name: string) => string | null;
};

/**
 * Whether Enter focuses the selected type. Enter is also how a keyboard presses a
 * button, follows a link, picks a tab or opens a disclosure, and the tree, list and
 * matrix rows, the inspector's chips and its related links are all buttons. Taking
 * Enter there as well entered focus on the type that was selected before the press.
 */
export function enterFocuses(event: {
  key: string;
  defaultPrevented: boolean;
  composedPath: () => readonly unknown[];
}): boolean {
  if (event.key !== "Enter" || event.defaultPrevented) return false;
  return !event.composedPath().some((step) => {
    const hop = step as Hop | null;
    return (
      CONTROL_TAGS.has(hop?.tagName) ||
      CONTROL_ROLES.has(hop?.getAttribute?.("role"))
    );
  });
}
