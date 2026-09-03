import { UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT } from "@umbraco-cms/backoffice/document-type";
import { UmbElementMixin } from "@umbraco-cms/backoffice/element-api";
import {
  css,
  html,
  LitElement,
  unsafeCSS,
} from "@umbraco-cms/backoffice/external/lit";
import { tryExecute } from "@umbraco-cms/backoffice/resources";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./app/App.js";
import appStyles from "./app/styles.css?inline";
import { getGraph, openTypeInEditor } from "./api.js";
import type { SchemaGraph } from "./model/types.js";

/**
 * The Relationships tab on the Document Type editor. Same React app as the workspace,
 * same graph, opened on the type being edited. The key comes from the editor's own
 * workspace context, so the tab follows a save or a switch to another type.
 */
export class SchemaCityDocumentTypeViewElement extends UmbElementMixin(
  LitElement,
) {
  #root?: Root;
  #graph?: SchemaGraph;
  #unique?: string;
  #failed = false;

  constructor() {
    super();
    this.consumeContext(UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, (unique) => {
        this.#unique = unique ?? undefined;
        this.#draw();
      });
    });
  }

  override connectedCallback() {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#root?.unmount();
    this.#root = undefined;
  }

  override firstUpdated() {
    // Created once and never again. Re-creating it would tear down the WebGL context.
    this.#root = createRoot(
      this.renderRoot.querySelector("#app") as HTMLElement,
    );
    this.#draw();
  }

  async #load() {
    const { data, error } = await tryExecute(this, getGraph());
    this.#failed = Boolean(error);
    this.#graph = data ?? undefined;
    this.#draw();
  }

  #draw() {
    if (!this.#root) return;

    // The app reads its initial selection once, so it waits for the key rather than
    // mounting on the whole city and jumping to the type a moment later.
    this.#root.render(
      this.#graph && this.#unique ? (
        <App
          graph={this.#graph}
          initial={{ type: this.#unique, focus: true }}
          onOpenType={openTypeInEditor}
        />
      ) : (
        <p className="p-4 font-mono text-sm text-phosphor-dim">
          {this.#failed ? "The graph endpoint did not answer." : "Loading…"}
        </p>
      ),
    );
  }

  override render() {
    return html`<div id="app"></div>`;
  }

  static override styles = [
    unsafeCSS(appStyles),
    css`
      :host {
        display: block;
        height: 100%;
      }
      #app {
        height: 100%;
      }
    `,
  ];
}

// Belt and braces: the fixed double-fetch in vite.config.ts stops two module instances
// from existing, but if a host ever serves this chunk twice anyway, a second define()
// throws and the view renders blank instead of just skipping the redundant one.
if (!customElements.get("schema-city-document-type-view")) {
  customElements.define(
    "schema-city-document-type-view",
    SchemaCityDocumentTypeViewElement,
  );
}

export default SchemaCityDocumentTypeViewElement;

declare global {
  interface HTMLElementTagNameMap {
    "schema-city-document-type-view": SchemaCityDocumentTypeViewElement;
  }
}
