import { SchemaCityElement } from "./schema-city-element.js";

/** The Schema City workspace: the whole city, opened where its own address says. */
class SchemaCityWorkspaceElement extends SchemaCityElement {}

// Belt and braces: the fixed double-fetch in vite.config.ts stops two module instances
// from existing, but if a host ever serves this chunk twice anyway, a second define()
// throws and the workspace renders blank instead of just skipping the redundant one.
if (!customElements.get("schema-city-workspace")) {
  customElements.define("schema-city-workspace", SchemaCityWorkspaceElement);
}

export default SchemaCityWorkspaceElement;

declare global {
  interface HTMLElementTagNameMap {
    "schema-city-workspace": SchemaCityWorkspaceElement;
  }
}
