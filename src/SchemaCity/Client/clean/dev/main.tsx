// The backoffice's own tokens, which the clean theme reads. ?theme=dark loads
// Umbraco's dark theme instead, to check both.
import { startHarness } from "@schema-city/ui/harness";
import * as clean from "../src/index.tsx";

const theme =
  new URLSearchParams(location.search).get("theme") === "dark"
    ? import("@umbraco-ui/uui/themes/dark.css")
    : import("@umbraco-ui/uui/themes/light.css");
await theme;
startHarness(clean);
