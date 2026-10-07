import { UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT } from "@umbraco-cms/backoffice/document-type";
import { SchemaCityElement } from "./schema-city-element.js";

/**
 * The Relationships tab on the Document Type editor. Same React app as the workspace,
 * same graph, opened on the type being edited. The key comes from the editor's own
 * workspace context, so the tab follows a save or a switch to another type.
 */
class SchemaCityDocumentTypeViewElement extends SchemaCityElement {
  #unique?: string;

  constructor() {
    super();
    this.consumeContext(UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        this.#unique = unique ?? undefined;
        this.draw();
      });
    });
  }

  // The app reads its initial selection once, so it waits for the key rather than
  // mounting on the whole city and jumping to the type a moment later.
  protected override opening() {
    return {
      ready: Boolean(this.#unique),
      initial: { type: this.#unique, focus: true },
    };
  }
}

// Belt and braces: the fixed double-fetch in vite.config.ts stops two module instances
// from existing, but if a host ever serves this chunk twice anyway, a second define()
// throws and the view renders blank instead of just skipping the redundant one.
if (!customElements.get("schema-city-document-type-view")) {
  customElements.define(
    "schema-city-document-type-view",
    SchemaCityDocumentTypeViewElement
  );
}

export default SchemaCityDocumentTypeViewElement;

declare global {
  interface HTMLElementTagNameMap {
    "schema-city-document-type-view": SchemaCityDocumentTypeViewElement;
  }
}
