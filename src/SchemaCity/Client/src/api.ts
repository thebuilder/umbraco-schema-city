import type { UmbClassInterface } from "@umbraco-cms/backoffice/class-api";
import type { UmbControllerHost } from "@umbraco-cms/backoffice/controller-api";
import { UMB_EDIT_DATA_TYPE_WORKSPACE_PATH_PATTERN } from "@umbraco-cms/backoffice/data-type";
import { UMB_EDIT_DOCUMENT_TYPE_WORKSPACE_PATH_PATTERN } from "@umbraco-cms/backoffice/document-type";
import { loadManifestPlainJs } from "@umbraco-cms/backoffice/extension-api";
import { filter, firstValueFrom } from "@umbraco-cms/backoffice/external/rxjs";
import { umbHttpClient } from "@umbraco-cms/backoffice/http-client";
import {
  UMB_ICON_REGISTRY_CONTEXT,
  type UmbIconModule,
} from "@umbraco-cms/backoffice/icon";
import { tryExecute, UmbApiError } from "@umbraco-cms/backoffice/resources";
import {
  type Decision,
  type DecisionStore,
  failureMessage,
} from "./model/review.js";
import type { SchemaGraph, UsageReport } from "./model/types.js";

/**
 * The backoffice only attaches its bearer token when the call names the scheme, so the
 * security entry is load bearing and not documentation.
 *
 * The M0 payload leaves node groups and graph edges empty; M1 fills them in.
 */
export const getGraph = () =>
  umbHttpClient.get<{ 200: SchemaGraph }>({
    security: [{ type: "http", scheme: "bearer" }],
    url: "/umbraco/management/api/v1/schema-city/graph",
  });

/**
 * Counts, cultures and instance references, cached for a minute on the server. Pass true to make
 * the server skip that cache after an editor has changed content.
 */
export const getUsage = (refresh = false) =>
  umbHttpClient.get<{ 200: UsageReport }>({
    security: [{ type: "http", scheme: "bearer" }],
    url: `/umbraco/management/api/v1/schema-city/usage?refresh=${refresh}`,
  });

const DECISIONS = "/umbraco/management/api/v1/schema-city/decisions";

/**
 * The decisions endpoint as the app's DecisionStore. tryExecute's own notification
 * is off, because the app says what failed beside the finding, keeping the reason.
 */
export const serverDecisions = (host: UmbControllerHost): DecisionStore => {
  const call = async <D>(doing: string, request: Promise<{ data?: D }>) => {
    const { data, error } = await tryExecute(host, request, {
      disableNotifications: true,
    });
    if (error)
      throw new Error(
        UmbApiError.isUmbApiError(error)
          ? failureMessage(doing, error.status, error.problemDetails?.title)
          : failureMessage(doing)
      );
    return data;
  };
  return {
    load: () =>
      call(
        "Loading review decisions",
        umbHttpClient.get<{ 200: Decision[] }>({
          security: [{ type: "http", scheme: "bearer" }],
          url: DECISIONS,
        })
      ).then((list) => list ?? []),
    save: async (findingId, reason, fingerprint) => {
      const saved = await call(
        "Saving the decision",
        umbHttpClient.put<{ 200: Decision }>({
          security: [{ type: "http", scheme: "bearer" }],
          url: `${DECISIONS}/${encodeURIComponent(findingId)}`,
          body: { reason, fingerprint },
          headers: { "Content-Type": "application/json" },
        })
      );
      if (!saved) throw new Error("Saving the decision failed: no reply.");
      return saved;
    },
    remove: async (findingId) => {
      await call(
        "Undoing the decision",
        umbHttpClient.delete<{ 204: unknown }>({
          security: [{ type: "http", scheme: "bearer" }],
          url: `${DECISIONS}/${encodeURIComponent(findingId)}`,
        })
      );
    },
  };
};

/**
 * Both wrappers hand this to the app as `onOpenType`. The path pattern is Umbraco's own,
 * so a route change in 18 or 19 arrives with the package. It is relative to the backoffice
 * base URI, and router-slot patches history.pushState to announce the navigation, so the
 * editor opens without a page load.
 *
 * 17.6.2 exports no navigation helper, and this is how the backoffice navigates itself:
 * every call site, from the dictionary create action to the log viewer's search box, is a
 * bare history.pushState. What it also does is start an async page load that router-slot
 * cancels if it hears a second changestate, and history.replaceState raises one, so the
 * app stops writing its query the moment this has moved the pathname. See url.ts.
 */
export const openTypeInEditor = (unique: string) =>
  history.pushState(
    null,
    "",
    new URL(
      UMB_EDIT_DOCUMENT_TYPE_WORKSPACE_PATH_PATTERN.generateAbsolute({
        unique,
      }),
      document.baseURI
    )
  );

/** The same handoff for a Data Type, through Umbraco's own Data Type editor route. */
export const openDataTypeInEditor = (unique: string) =>
  history.pushState(
    null,
    "",
    new URL(
      UMB_EDIT_DATA_TYPE_WORKSPACE_PATH_PATTERN.generateAbsolute({ unique }),
      document.baseURI
    )
  );

/**
 * Umbraco icon name to SVG string, for the roof sprites. Both wrappers call this once,
 * after the graph has drawn, and never on the first paint.
 *
 * The icon registry context does not expose its UUIIconRegistry, so the public way to a
 * name's SVG is the context's own `icons` observable of definitions plus the loader the
 * registry itself uses. That is also the only way to tell an unknown name apart: the
 * registry's `getIcon` hands back a promise that never settles for a name it has no
 * definition for, because it parks the request and waits for a later manifest. Here a
 * missing definition is simply left out of the map, and the browser's module cache means
 * an icon the backoffice has already drawn costs no second request.
 */
export const resolveIcons = async (
  host: UmbClassInterface,
  names: Iterable<string>
): Promise<Record<string, string>> => {
  const context = await host
    .getContext(UMB_ICON_REGISTRY_CONTEXT)
    .catch(() => undefined);
  if (!context) return {};

  // The list starts empty and fills when the backoffice icon manifest's JS loads.
  const definitions = await firstValueFrom(
    context.icons.pipe(filter((icons) => icons.length > 0))
  );

  const entries = await Promise.all(
    [...new Set(names)].map(async (name) => {
      const definition = definitions.find((icon) => icon.name === name);
      if (!definition) return;
      const module = await loadManifestPlainJs<UmbIconModule>(definition.path);
      return module?.default ? ([name, module.default] as const) : undefined;
    })
  );

  return Object.fromEntries(entries.filter((entry) => entry !== undefined));
};
