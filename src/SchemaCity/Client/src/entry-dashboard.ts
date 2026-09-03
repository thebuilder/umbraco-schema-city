import {
  LitElement,
  css,
  customElement,
  html,
  state,
} from "@umbraco-cms/backoffice/external/lit";
import { UmbElementMixin } from "@umbraco-cms/backoffice/element-api";
import { tryExecute } from "@umbraco-cms/backoffice/resources";
import { getGraph } from "./api.js";
import type { SchemaNode } from "./model/types.js";

/** Lists what the graph endpoint returns. The city itself lands in M1. */
@customElement("schema-city-dashboard")
export class SchemaCityDashboardElement extends UmbElementMixin(LitElement) {
  @state()
  private _nodes?: SchemaNode[];

  @state()
  private _failed = false;

  override connectedCallback() {
    super.connectedCallback();
    this.#load();
  }

  async #load() {
    const { data, error } = await tryExecute(this, getGraph());

    if (error) {
      this._failed = true;
      return;
    }

    this._nodes = data?.nodes ?? [];
  }

  override render() {
    if (this._failed) {
      return html`<uui-box headline="Schema City"
        >The graph endpoint did not answer.</uui-box
      >`;
    }

    if (!this._nodes) {
      return html`<uui-box headline="Schema City"
        ><uui-loader></uui-loader
      ></uui-box>`;
    }

    return html`
      <uui-box headline="Schema City, ${this._nodes.length} types">
        <ul>
          ${this._nodes.map((node) => html`<li>${node.name}</li>`)}
        </ul>
      </uui-box>
    `;
  }

  static override styles = [
    css`
      :host {
        display: block;
        padding: var(--uui-size-layout-1);
      }
    `,
  ];
}

export default SchemaCityDashboardElement;

declare global {
  interface HTMLElementTagNameMap {
    "schema-city-dashboard": SchemaCityDashboardElement;
  }
}
