import { UmbElementMixin } from "@umbraco-cms/backoffice/element-api";
import {
  css,
  html,
  LitElement,
  unsafeCSS,
} from "@umbraco-cms/backoffice/external/lit";
import { tryExecute, UmbApiError } from "@umbraco-cms/backoffice/resources";
import { createRoot, type Root } from "react-dom/client";
import {
  getGraph,
  getUsage,
  openDataTypeInEditor,
  openTypeInEditor,
  resolveIcons,
  serverDecisions,
} from "./api.js";
import { App } from "./app/App.js";
import appStyles from "./app/styles.css?inline";
import type { SchemaGraph, UsageReport } from "./model/types.js";

type Initial = Parameters<typeof App>[0]["initial"];

/**
 * The one place that knows about Umbraco, shared by the workspace and the
 * Relationships tab. It fetches the graph, hands it to the React app as a property,
 * and takes the app's callbacks back. Everything under app/ is plain React and runs
 * unchanged in the fixture harness.
 */
export class SchemaCityElement extends UmbElementMixin(LitElement) {
  #root?: Root;
  #graph?: SchemaGraph;
  #usage?: UsageReport;
  // Until the usage request settles, either way, which the footer says.
  #usagePending = true;
  #icons?: Record<string, string>;
  #failed?: string;
  // One store for the element's life, so a redraw does not load the decisions again.
  readonly #decisions = serverDecisions(this);

  /**
   * Where the app opens. With no `initial` it reads its own query string, which is
   * the workspace's way. Not ready waits rather than opening on the wrong thing.
   */
  protected opening(): { ready: boolean; initial?: Initial } {
    return { ready: true };
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
      this.renderRoot.querySelector("#app") as HTMLElement
    );
    this.draw();
  }

  async #load() {
    const { data, error } = await tryExecute(this, getGraph());
    // The status is the one thing that tells a 401 apart from a 500 without the console.
    this.#failed = error
      ? UmbApiError.isUmbApiError(error)
        ? `The graph endpoint answered ${error.status}.`
        : "The graph endpoint did not answer."
      : undefined;
    this.#graph = data ?? undefined;
    this.draw();
    if (!this.#graph) return;

    // The roofs are worth waiting a beat for, the city is not, so the icons resolve
    // alongside usage rather than in front of the first paint. Resolved once and kept.
    if (!this.#icons) void this.#loadIcons(this.#graph);

    // Usage is the slow half, and the city is worth looking at without it, so it
    // starts only once the graph has drawn. A failure leaves `usage` undefined,
    // which is what disables the lens picker, and says so once.
    const usage = await tryExecute(this, getUsage());
    this.#usagePending = false;
    if (usage.error)
      console.warn(
        "Schema City: the usage endpoint did not answer, so the lens stays off."
      );
    this.#usage = usage.data ?? undefined;
    this.draw();
  }

  async #loadIcons(graph: SchemaGraph) {
    this.#icons = await resolveIcons(
      this,
      graph.nodes.map((node) => node.icon)
    );
    this.draw();
  }

  /** Renders the app again with what has arrived, or the loading line until then. */
  protected draw() {
    if (!this.#root) return;
    const { ready, initial } = this.opening();
    this.#root.render(
      this.#graph && ready ? (
        <App
          decisions={this.#decisions}
          graph={this.#graph}
          icons={this.#icons}
          initial={initial}
          onOpenDataType={openDataTypeInEditor}
          onOpenType={openTypeInEditor}
          usage={this.#usage}
          usagePending={this.#usagePending}
        />
      ) : (
        <p className="p-4 font-mono text-sm text-phosphor-dim">
          {this.#failed ?? "Loading…"}
        </p>
      )
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
