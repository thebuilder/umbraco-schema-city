// The City variant: the shared panels around a three.js city, in the afterglow look.
import { App } from "@schema-city/ui/App.tsx";
import { PhosphorMenu } from "@schema-city/ui/Chrome.tsx";
import { mountWith } from "@schema-city/ui/mount.tsx";
import { StageContext } from "@schema-city/ui/stage.tsx";
import { lazy } from "react";
import { CITY_COPY } from "./copy";
import { OpeningSkipped } from "./scene/opening";
import styles from "./styles.css?inline";

// three.js, fiber and drei are most of this bundle, so they load with the scene
// rather than with the panels.
const Scene = lazy(() => import("./Scene"));

export const mount = mountWith(styles, ({ skipOpening, ...props }) => (
  <OpeningSkipped value={skipOpening === true}>
    <StageContext
      value={{
        Canvas: Scene,
        copy: CITY_COPY,
        tools: <PhosphorMenu />,
      }}
    >
      <App {...props} />
    </StageContext>
  </OpeningSkipped>
));
