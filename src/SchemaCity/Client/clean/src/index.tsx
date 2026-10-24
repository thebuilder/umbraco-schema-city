// The clean variant: the shared panels around a flat, zoomable map, in the
// backoffice's own colours and type.
import { App } from "@schema-city/ui/App.tsx";
import { mountWith } from "@schema-city/ui/mount.tsx";
import { StageContext } from "@schema-city/ui/stage.tsx";
import { lazy } from "react";
import { PLAN_COPY } from "./copy";
import styles from "./styles.css?inline";

// React Flow loads with the board rather than with the panels.
const Board = lazy(() => import("./Board"));

export const mount = mountWith(styles, ({ skipOpening: _, ...props }) => (
  <StageContext value={{ Canvas: Board, copy: PLAN_COPY, toolsOnCanvas: true }}>
    <App {...props} />
  </StageContext>
));
