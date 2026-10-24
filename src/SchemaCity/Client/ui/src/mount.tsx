// How a variant meets the backoffice element. The element knows nothing of React: it
// imports one variant, calls mount() on a container in its shadow root and hands over
// the graph and callbacks. Both variants share React and this module through one
// chunk; each brings its own stylesheet, and three.js loads only with the City.
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { App } from "./App";

type AppProps = Parameters<typeof App>[0];

/** What the element hands a variant: App's props, and one for the variant itself. */
export type HostProps = Omit<AppProps, "onStateChange"> & {
  /** Opens with the schema already laid out, for the Relationships tab. */
  skipOpening?: boolean;
};

export type MountedApp = {
  render: (props: HostProps) => void;
  unmount: () => void;
};

/** What each variant bundle exports, and all the element imports from it. */
export type VariantModule = { mount: (container: HTMLElement) => MountedApp };

const PROPERTY_RULE = /@property[^{]+\{[^}]*\}/g;
const hoisted = new Set<string>();

/**
 * Tailwind 4 gives its utilities' variables their starting values with @property, and
 * a shadow root ignores @property, so inside the backoffice every border, outline and
 * shadow resolved to none. Registered on the document, they apply inside every shadow
 * root. The names are Tailwind's own --tw-*, which Umbraco's UI does not use.
 *
 * Rule by rule rather than once, because both variants share this module and each
 * stylesheet only has the rules its own utilities use: the clean variant's ring on a
 * selected card needs --tw-ring-* that the City's sheet may not have.
 */
function hoistProperties(css: string) {
  const fresh = (css.match(PROPERTY_RULE) ?? []).filter(
    (rule) => !hoisted.has(rule)
  );
  if (fresh.length === 0) return;
  for (const rule of fresh) hoisted.add(rule);
  const properties = document.createElement("style");
  properties.dataset.schemaCityProperties = "";
  properties.textContent = fresh.join("\n");
  document.head.append(properties);
}

/**
 * A variant's mount(): adopts its stylesheet where the container lives, the
 * element's shadow root or the harness's document, and renders `view` there.
 */
export const mountWith =
  (css: string, view: (props: HostProps) => ReactNode) =>
  (container: HTMLElement): MountedApp => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const scope = container.getRootNode() as Document | ShadowRoot;
    scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
    hoistProperties(css);
    const root = createRoot(container);
    return {
      render: (props) => root.render(view(props)),
      unmount: () => {
        root.unmount();
        scope.adoptedStyleSheets = scope.adoptedStyleSheets.filter(
          (adopted) => adopted !== sheet
        );
      },
    };
  };
