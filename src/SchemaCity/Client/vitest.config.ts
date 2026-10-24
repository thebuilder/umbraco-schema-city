import { defineConfig } from "vitest/config";
import { uiAlias } from "./vite.shared.ts";

// One run over every package, with the alias the shared panels import through.
export default defineConfig({ resolve: { alias: uiAlias } });
