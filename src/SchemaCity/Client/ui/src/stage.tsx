// The contract between the app and the canvas it draws the schema on: the City's
// three.js scene or the clean variant's flat board. App owns every piece of state
// here and the stage only draws it and reports clicks back. The copy beside it is
// how the shared panels talk about that canvas.

import type { Grouping } from "@schema-city/core/layout/city";
import type { ChangeGroups } from "@schema-city/core/model/changes";
import type { SchemaComparison } from "@schema-city/core/model/snapshots";
import type { SchemaGraph, UsageReport } from "@schema-city/core/model/types";
import type { Layer } from "@schema-city/core/scene/layers";
import type { LensScale } from "@schema-city/core/scene/lens";
import {
  Component,
  type ComponentType,
  createContext,
  type ReactNode,
  Suspense,
  useContext,
} from "react";

export type StageProps = {
  graph: SchemaGraph;
  /** How the schema is cut into districts. */
  grouping?: Grouping;
  /** Content counts, which put a busier type's printed name ahead of a quieter one. */
  usage?: UsageReport;
  baseline?: SchemaGraph | null;
  comparison?: SchemaComparison | null;
  /** The comparison read as causes and side effects, for the change layer. */
  changes?: ChangeGroups | null;
  focusDepth?: number;
  /** Umbraco icon name to SVG, for the roofs or the cards. The harness usually passes none. */
  icons?: Record<string, string>;
  /** The lens colouring App computed. Absent or null means no lens is on. */
  scale?: LensScale | null;
  selected: string | null;
  focus: string | null;
  layers: readonly Layer[];
  /**
   * Whether the inspector covers the right of the canvas. Framing aims at the middle
   * of what it leaves rather than at the middle of the canvas, so a focused
   * neighbourhood is not half behind the panel.
   */
  inspectorOpen?: boolean;
  /**
   * How much larger the floating names are drawn and the printed ones chosen, 1.4 in
   * presentation mode so they read from the back of a meeting room.
   */
  textScale?: number;
  /**
   * Bumped to frame the whole schema again. It is a count rather than a flag because
   * the view has to answer Home a second time from wherever the reader took it.
   */
  reframe?: number;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  /** Layers, Group, Lens, Legend and Reset view, for a canvas that keeps them. */
  toolbar?: ReactNode;
};

/** One line of Help: the keys, and what they do. */
export type KeyRow = { keys: string[]; does: string };

/**
 * The words that differ between the variants, and the parts of Help and the Legend
 * only the stage can write. Each variant's mount() provides them, so a shared panel
 * can say "building" in the City and "card" on the map. Phrases are written out
 * whole rather than built from the name, since "in the city" and "on the map" do not
 * follow from "City" and "Map".
 */
export type StageCopy = {
  /** The view's name in the switcher and in "back to the city": "City" or "Plan". */
  name: string;
  /** The stage as a common noun, as in "back to the city": "city" or "plan". */
  noun: string;
  /** Where things are on the stage, as in "lit in the City": "in the City". */
  where: string;
  /** The button that lights types on the stage: "Show in city". */
  show: string;
  /** What the canvas says while its code loads: "Loading the scene…". */
  loading: string;
  /** One type on the stage: "building" or "card". */
  item: string;
  /** How the canvas's one-line reading for a screen reader starts: "3D city". */
  kind: string;
  /** Help's Mouse and Navigation groups. */
  mouse: KeyRow[];
  navigation: KeyRow[];
  /** What the Legend window holds. */
  legend: ReactNode;
};

/**
 * What a variant brings to the shared app: the canvas, the words, and its own
 * header controls. The variant's mount() provides it round App.
 */
export type Stage = {
  Canvas: ComponentType<StageProps>;
  copy: StageCopy;
  tools?: ReactNode;
  /**
   * Whether the canvas draws its own tools (StageProps.toolbar), as the flat map's
   * floating toolbar does, rather than the footer holding them.
   */
  toolsOnCanvas?: boolean;
};

export const StageContext = createContext<Stage | null>(null);

function useStage(): Stage {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("The app rendered outside a variant's mount().");
  return stage;
}

export const useStageCopy = () => useStage().copy;

export const useToolsOnCanvas = () => useStage().toolsOnCanvas === true;

/**
 * Keeps a canvas that throws, as the City does on a machine with no WebGL, from
 * taking the panels down with it: the header, and its switch to the other variant,
 * stay on screen beside the message.
 */
// biome-ignore lint/style/useReactFunctionComponents: React catches render errors only in a class component; there is no function form.
class CanvasBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <p className="p-4 text-prose text-sm" role="alert">
        The {this.props.name.toLowerCase()} could not start here:{" "}
        {error.message}
      </p>
    );
  }
}

/**
 * The variant's canvas, drawing App's state. Its code loads after the panels, so it
 * says so in the variant's words until it arrives.
 */
export function StageCanvas(props: StageProps) {
  const { Canvas, copy } = useStage();
  return (
    <CanvasBoundary name={copy.name}>
      <Suspense
        fallback={
          <p className="p-4 text-phosphor-dim text-sm">{copy.loading}</p>
        }
      >
        <Canvas {...props} />
      </Suspense>
    </CanvasBoundary>
  );
}

/** The empty schema's line, which says what a new type will turn up as. */
export function StageEmpty() {
  return (
    <p className="text-muted-foreground text-xs">
      Create one under Settings, Document Types, and it turns up here as a{" "}
      {useStage().copy.item}.
    </p>
  );
}

/** The variant's own header controls, like the City's phosphor picker. */
export function StageTools() {
  return useStage().tools ?? null;
}
