import { UmbElementMixin } from "@umbraco-cms/backoffice/element-api";
import {
  css,
  customElement,
  html,
  LitElement,
  unsafeCSS,
} from "@umbraco-cms/backoffice/external/lit";
import { tryExecute } from "@umbraco-cms/backoffice/resources";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./app/App.js";
import appStyles from "./app/styles.css?inline";
import { getGraph } from "./api.js";
import type { SchemaGraph } from "./model/types.js";

/**
 * The one file that knows about Umbraco. It fetches the graph, hands it to the React
 * app as a property, and takes the app's callbacks back. Everything under app/ is
 * plain React and runs unchanged in the fixture harness.
 */
@customElement("schema-city-workspace")
export class SchemaCityWorkspaceElement extends UmbElementMixin(LitElement) {
  #root?: Root;
  #graph?: SchemaGraph;
  #failed = false;

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
    this.#root = createRoot(this.renderRoot.querySelector("#app") as HTMLElement);
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

    this.#root.render(
      this.#graph ? (
        <App graph={this.#graph} onOpenType={openType} />
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

/** ponytail: M2 turns this into a link to the Document Type editor. */
const openType = (id: string) => console.log("schema-city: open type", id);

export default SchemaCityWorkspaceElement;

declare global {
  interface HTMLElementTagNameMap {
    "schema-city-workspace": SchemaCityWorkspaceElement;
  }
}
