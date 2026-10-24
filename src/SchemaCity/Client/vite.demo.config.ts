import { defineConfig } from "vite";
import { demoConfig } from "./vite.shared.ts";

// The demo's map, at the root of Client/dist. vite.demo-city.config.ts adds the City.
export default defineConfig(demoConfig("clean"));
