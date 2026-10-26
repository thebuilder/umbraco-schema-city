import type { SchemaGraph, UsageReport } from "@schema-city/core/model/types";
import type { Variant } from "@schema-city/ui/Chrome.tsx";
import type {
  HostProps,
  MountedApp,
  VariantModule,
} from "@schema-city/ui/mount.tsx";
import { UmbElementMixin } from "@umbraco-cms/backoffice/element-api";
import {
  css,
  html,
  LitElement,
  nothing,
} from "@umbraco-cms/backoffice/external/lit";
import { tryExecute, UmbApiError } from "@umbraco-cms/backoffice/resources";
import {
  getGraph,
  getSettings,
  getUsage,
  openDataTypeInEditor,
  openTypeInEditor,
  resolveIcons,
  serverDecisions,
} from "./api.js";

const isVariant = (value: unknown): value is Variant =>
  value === "clean" || value === "city";

let settings: Promise<Variant> | undefined;

/**
 * The variant appsettings opens on, asked once per page: it cannot change without a
 * restart, and the Relationships tab is created again for every Document Type
 * opened. The city plan when the endpoint cannot say.
 */
const defaultVariant = (host: SchemaCityElement) => {
  settings ??= tryExecute(host, getSettings(), {
    disableNotifications: true,
  }).then(({ data, error }) => {
    // A failed call is asked again next time rather than pinning the city plan on a
    // site that set the City.
    if (error) settings = undefined;
    return isVariant(data?.variant) ? data.variant : "clean";
  });
  return settings;
};

/**
 * Each variant's bundle, built with these entries and loaded only when asked for,
 * so the City's three.js never loads with the city plan. The bundler names and
 * wires the chunks, so they carry content hashes and resolve from this module, not
 * from the entries Umbraco requests with its `?umb__rnd=` query: the workspace and
 * the Relationships tab share one copy of each variant and its React.
 */
const VARIANTS: Record<Variant, () => Promise<VariantModule>> = {
  city: () => import("@schema-city/city"),
  clean: () => import("@schema-city/clean"),
};

/**
 * The line shown in place of the app: loading, or why the graph did not come. The
 * status is the one thing that tells a 401 apart from a 500 without the console.
 */
const statusOf = (error: unknown) => {
  if (!error) return "Loading…";
  return UmbApiError.isUmbApiError(error)
    ? `The graph endpoint answered ${error.status}.`
    : "The graph endpoint did not answer.";
};

/**
 * The one place that knows about Umbraco, shared by the workspace and the
 * Relationships tab. It fetches the graph, loads the variant the reader wants, and
 * hands the graph and its callbacks to that variant's mount(). Everything the
 * variants draw is plain React and runs unchanged in the fixture harness.
 */
export class SchemaCityElement extends UmbElementMixin(LitElement) {
  #mounted?: MountedApp;
  // The variant on screen, and the one last asked for, which wins a race between two.
  #variant?: Variant;
  #wanted?: Variant;
  #graph?: SchemaGraph;
  #usage?: UsageReport;
  // Until the usage request settles, either way, which the footer says.
  #usagePending = true;
  #icons?: Record<string, string>;
  #status = "Loading…";
  // Why a variant did not load, shown whether or not another one is on screen.
  #bundleError?: string;
  // One store for the element's life, so a redraw does not load the decisions again.
  readonly #decisions = serverDecisions(this);

  /**
   * Where the app opens. With no `initial` it reads its own query string, which is
   * the workspace's way. Not ready waits rather than opening on the wrong thing.
   */
  protected opening(): {
    ready: boolean;
    initial?: HostProps["initial"];
    skipOpening?: boolean;
  } {
    return { ready: true };
  }

  override connectedCallback() {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#unmount();
  }

  #unmount() {
    this.#mounted?.unmount();
    this.#mounted = undefined;
    this.#variant = undefined;
  }

  async #load() {
    void this.#open();

    const { data, error } = await tryExecute(this, getGraph());
    this.#status = statusOf(error);
    this.#graph = data ?? undefined;
    if (!this.#graph) return this.#lost();
    this.draw();

    // The roofs are worth waiting a beat for, the city is not, so the icons resolve
    // alongside usage rather than in front of the first paint.
    void this.#loadIcons(this.#graph);
    await this.#loadUsage();
  }

  /**
   * Starts the app again on what `opening()` now says. The app reads where it opens
   * once, so a new place to open on needs a fresh mount.
   */
  protected restart() {
    if (this.#variant) void this.#show(this.#variant);
  }

  /**
   * No graph: an app still standing from before a reconnect would go on showing the
   * old one above the status line, so it comes down and the status line says why.
   */
  #lost() {
    this.#unmount();
    this.draw();
  }

  /**
   * Opens on the variant appsettings names, for every user alike. The bundle loads
   * alongside the graph rather than after it.
   */
  async #open() {
    await this.#show(await defaultVariant(this));
  }

  /**
   * Mounts `variant` in place of whatever is on screen, once its bundle is here. A
   * bundle that did not load says so on the status line.
   */
  async #show(variant: Variant) {
    this.#wanted = variant;
    const module = await VARIANTS[variant]().catch((error: unknown) =>
      this.#failed(variant, error)
    );
    if (!module) return;
    await this.updateComplete;
    // Checked after the wait: a restart asked for meanwhile wins, and an element
    // taken off the page has already unmounted, so a root mounted now never would be.
    if (!this.isConnected || this.#wanted !== variant) return;
    this.#unmount();
    this.#mounted = module.mount(
      this.renderRoot.querySelector("#app") as HTMLElement
    );
    this.#variant = variant;
    this.#bundleError = undefined;
    this.draw();
  }

  #failed(variant: Variant, error: unknown) {
    console.error(`Schema City: the ${variant} bundle did not load.`, error);
    const name = variant === "city" ? "3D city" : "city plan";
    this.#bundleError = `The ${name} did not load. Reload the page to try again.`;
    this.requestUpdate();
  }

  /**
   * Usage is the slow half, and the city is worth looking at without it, so it
   * starts only once the graph has drawn. A failure leaves `usage` undefined, which
   * is what disables the lens picker, and says so once.
   */
  async #loadUsage() {
    const usage = await tryExecute(this, getUsage());
    this.#usagePending = false;
    if (usage.error)
      console.warn(
        "Schema City: the usage endpoint did not answer, so the lens stays off."
      );
    this.#usage = usage.data ?? undefined;
    this.draw();
  }

  /** Resolved once and kept, across reconnects too. */
  async #loadIcons(graph: SchemaGraph) {
    if (this.#icons) return;
    this.#icons = await resolveIcons(
      this,
      graph.nodes.map((node) => node.icon)
    );
    this.draw();
  }

  /** Whether the app is on screen rather than the status line. */
  get #drawn() {
    return Boolean(this.#mounted && this.#graph && this.opening().ready);
  }

  /** Renders the app again with what has arrived, or the status line until then. */
  protected draw() {
    this.requestUpdate();
    const { initial, skipOpening } = this.opening();
    if (!(this.#drawn && this.#graph && this.#variant)) return;
    this.#mounted?.render({
      decisions: this.#decisions,
      graph: this.#graph,
      icons: this.#icons,
      initial,
      onOpenDataType: openDataTypeInEditor,
      onOpenType: openTypeInEditor,
      skipOpening,
      usage: this.#usage,
      usagePending: this.#usagePending,
    });
  }

  override render() {
    const status = this.#bundleError ?? (this.#drawn ? null : this.#status);
    return html`${status === null ? nothing : html`<p class="status" role="status">${status}</p>`}<div
        id="app"
      ></div>`;
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    #app {
      flex: 1;
      min-height: 0;
    }
    .status {
      margin: 0;
      padding: var(--uui-size-space-5, 16px);
      font-size: var(--uui-type-small-size, 12px);
      color: var(--uui-color-text-alt, #68676b);
    }
  `;
}
