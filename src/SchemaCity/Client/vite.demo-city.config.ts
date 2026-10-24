import { defineConfig } from "vite";
import { demoConfig } from "./vite.shared.ts";

// The demo's City, under /city/ in Client/dist, beside the map.
export default defineConfig(demoConfig("city"));
