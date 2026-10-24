// How the shared panels talk about the City: its name, what one type is on it, the
// mouse and keys the 3D camera takes, and the legend for buildings and boards.
import {
  EdgeMark,
  LEGEND_LIST,
  LegendRow,
  LegendTitle,
} from "@schema-city/ui/Legend.tsx";
import type { StageCopy } from "@schema-city/ui/stage.tsx";

/**
 * Every mark differs by shape as well as colour, so no two rows can be mistaken for
 * each other: a solid block, a glass outline, a flat board, a lit top edge, a dot.
 * The words never name a colour, since a phosphor preset can move every one of
 * them; the mark beside each row is drawn in whatever the theme makes it.
 */
function CityLegend() {
  return (
    <div className="space-y-5">
      <section>
        <LegendTitle>Buildings</LegendTitle>
        <ul className={LEGEND_LIST}>
          <LegendRow mark={<span className="size-3 bg-phosphor" />}>
            A Document Type
          </LegendRow>
          <LegendRow mark={<span className="h-2 w-3 bg-amber" />}>
            An Element Type, a block
          </LegendRow>
          <LegendRow
            mark={<span className="size-3 border border-azure bg-azure/25" />}
          >
            Glass: a composition's properties
          </LegendRow>
          <LegendRow mark={<span className="size-3 border-2 border-signal" />}>
            Selected
          </LegendRow>
          <LegendRow
            mark={
              <span className="h-2 w-6 border border-line-strong bg-panel-raised" />
            }
          >
            A board: a group of types
          </LegendRow>
        </ul>
      </section>

      <section>
        <LegendTitle>Lines</LegendTitle>
        <ul className={LEGEND_LIST}>
          <LegendRow
            mark={
              <EdgeMark
                className="text-structure"
                d="M1 6 H25 M17 2 L22 6 L17 10"
              />
            }
          >
            Can be created under
          </LegendRow>
          <LegendRow
            mark={<EdgeMark className="text-azure" d="M1 11 Q13 -1 25 11" />}
          >
            Composes. Paler: inherits
          </LegendRow>
          <LegendRow
            mark={<EdgeMark className="text-amber" d="M1 1 Q13 13 25 1" />}
          >
            Offered as a block
          </LegendRow>
          <LegendRow
            mark={<EdgeMark className="text-violet" d="M1 6 H25" dashed />}
          >
            Picked by a picker
          </LegendRow>
        </ul>
        <p className="mt-2.5 text-faint text-xs leading-snug">
          Hover or select a building to light its lines.
        </p>
      </section>

      <section>
        <LegendTitle>On a building</LegendTitle>
        <ul className={LEGEND_LIST}>
          <LegendRow
            mark={
              <span className="h-3 w-4 border-line border-y bg-phosphor/40" />
            }
          >
            Slab: a property group. Windows: properties
          </LegendRow>
          <LegendRow
            mark={
              <span className="flex h-3 w-4 items-end justify-around border-line border-b">
                <span className="h-1.5 w-px bg-phosphor" />
                <span className="h-1.5 w-px bg-phosphor" />
                <span className="h-1.5 w-px bg-phosphor" />
              </span>
            }
          >
            Pins: direct connections
          </LegendRow>
          <LegendRow
            mark={
              <span className="size-3 border-phosphor-bright border-t-[3px] bg-phosphor-dim" />
            }
          >
            Lit lid: has a template
          </LegendRow>
          <LegendRow
            mark={
              <span className="flex size-3 items-start justify-center border border-line-strong">
                <span className="mt-0.5 size-1 rounded-full bg-phosphor-bright" />
              </span>
            }
          >
            Roof dots: varies by culture, then segment
          </LegendRow>
          <LegendRow
            mark={<span className="h-1.5 w-6 rounded-full bg-phosphor-dim" />}
          >
            Disc: allowed at the root
          </LegendRow>
        </ul>
        <p className="mt-2.5 text-faint text-xs leading-snug">
          Wider means more properties of its own.
        </p>
      </section>

      <section>
        <LegendTitle>On a board</LegendTitle>
        <ul className={LEGEND_LIST}>
          <LegendRow mark={<span className="h-3 w-1.5 bg-[#d9b24a]/70" />}>
            Edge fingers: lines to another board
          </LegendRow>
          <LegendRow
            mark={
              <span className="size-2 rounded-full border-2 border-[#c8823a]/70" />
            }
          >
            Ring: a line turns a corner
          </LegendRow>
          <LegendRow mark={<span className="size-3 bg-phosphor-dim/40" />}>
            Patch: one block editor's Element Types
          </LegendRow>
        </ul>
      </section>
    </div>
  );
}

export const CITY_COPY: StageCopy = {
  name: "City",
  noun: "city",
  where: "in the City",
  show: "Show in city",
  loading: "Loading the scene…",
  item: "building",
  kind: "3D city",
  mouse: [
    { keys: ["Drag"], does: "Orbit the camera around the city" },
    {
      keys: ["Right-drag", "Shift-drag"],
      does: "Pan along the ground. Shift-drag works on a trackpad",
    },
    {
      keys: ["Scroll"],
      does: "Move toward the point under the cursor, or away",
    },
    {
      keys: ["Hover"],
      does: "Show a type’s name and direct connections across all layers",
    },
    {
      keys: ["Click"],
      does: "Select a building, or clear the selection by clicking bare ground. Focus stays on",
    },
    { keys: ["Double click"], does: "Focus a building" },
  ],
  navigation: [
    {
      keys: ["W", "A", "S", "D"],
      does: "Pan along the ground the way the camera faces",
    },
    { keys: ["←", "↑", "↓", "→"], does: "Pan, the same as W, A, S and D" },
    { keys: ["R", "F"], does: "Rise and descend" },
    {
      keys: ["[", "]"],
      does: "Orbit left and right around the view's centre",
    },
    { keys: ["PgUp", "PgDn"], does: "Tilt the view up and down" },
    {
      keys: ["Shift"],
      does: "Hold alongside any of these to go twice as fast",
    },
    {
      keys: ["Home"],
      does: "Reframe the city, or leave focus. Reset view in the footer does the same",
    },
  ],
  legend: <CityLegend />,
};
