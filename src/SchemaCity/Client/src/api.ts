import { umbHttpClient } from "@umbraco-cms/backoffice/http-client";
import type { SchemaGraph } from "./model/types.js";

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
