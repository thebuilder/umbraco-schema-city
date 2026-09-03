import { UMB_EDIT_DOCUMENT_TYPE_WORKSPACE_PATH_PATTERN } from "@umbraco-cms/backoffice/document-type";
import { umbHttpClient } from "@umbraco-cms/backoffice/http-client";
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
      UMB_EDIT_DOCUMENT_TYPE_WORKSPACE_PATH_PATTERN.generateAbsolute({ unique }),
      document.baseURI,
    ),
  );
