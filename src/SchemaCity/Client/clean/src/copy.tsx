// How the shared panels talk about the city plan: its name, what one type is on it,
// the mouse and keys the board takes, and the legend for cards and lines.
import {
  EdgeMark,
  LEGEND_LIST,
  LegendRow,
  LegendTitle,
} from "@schema-city/ui/Legend.tsx";
import type { StageCopy } from "@schema-city/ui/stage.tsx";

/** A card's icon tile, which is where the board puts its colour. */
const Tile = ({ className }: { className: string }) => (
  <span className={`size-3.5 rounded-sm ${className}`} />
);

const ARROW = "M1 6 H23 M18 2 L23 6 L18 10";

/**
 * Every mark is a card or a line drawn as the board draws it, and the words never
 * name a colour, since the backoffice theme sets every one of them.
 */
function PlanLegend() {
  return (
    <div className="space-y-5">
      <section>
        <LegendTitle>Cards</LegendTitle>
        <ul className={LEGEND_LIST}>
          <LegendRow
            mark={<Tile className="bg-phosphor/20 ring-1 ring-phosphor" />}
          >
            A Document Type editors can create
          </LegendRow>
          <LegendRow
            mark={
              <Tile className="bg-phosphor-dim/20 ring-1 ring-phosphor-dim" />
            }
          >
            A composition, or a type nothing creates
          </LegendRow>
          <LegendRow mark={<Tile className="bg-amber/20 ring-1 ring-amber" />}>
            An Element Type, a block
          </LegendRow>
          <LegendRow
            mark={
              <span className="flex w-6 gap-px">
                <span className="h-1 w-3 rounded-full bg-foreground/55" />
                <span className="h-1 w-1.5 rounded-full bg-foreground/55" />
                <span className="h-1 w-1 rounded-full bg-foreground/20" />
              </span>
            }
          >
            Size: a segment per property group, as long as its properties; a
            faint one comes from a composition. Past twelve groups, one solid
            bar
          </LegendRow>
          <LegendRow
            mark={<span className="size-3 rounded-sm ring-2 ring-phosphor" />}
          >
            Selected
          </LegendRow>
          <LegendRow
            mark={
              <span className="h-3 w-4 rounded-sm border border-signal border-dashed" />
            }
          >
            Removed since the baseline
          </LegendRow>
          <LegendRow
            mark={<span className="h-3 w-6 rounded-md bg-foreground/5" />}
          >
            A frame: a group of types
          </LegendRow>
        </ul>
        <p className="mt-2.5 text-faint text-xs leading-snug">
          With a lens on, the tile and a wash over the card take the lens's
          colour instead.
        </p>
      </section>
      <section>
        <LegendTitle>Lines</LegendTitle>
        <ul className={LEGEND_LIST}>
          <LegendRow mark={<EdgeMark className="text-structure" d={ARROW} />}>
            Can be created under, pointing at the child
          </LegendRow>
          <LegendRow mark={<EdgeMark className="text-azure" d={ARROW} />}>
            Composes, pointing at the composition
          </LegendRow>
          <LegendRow mark={<EdgeMark className="text-amber" d={ARROW} />}>
            Offered as a block
          </LegendRow>
          <LegendRow mark={<EdgeMark className="text-violet" d={ARROW} />}>
            Picked by a picker
          </LegendRow>
        </ul>
        <p className="mt-2.5 text-faint text-xs leading-snug">
          Select a card to light its lines, or hover one while nothing is
          selected. Zoomed out, a card shows its name alone, and further out
          only its colour.
        </p>
      </section>
    </div>
  );
}

export const PLAN_COPY: StageCopy = {
  name: "Plan",
  noun: "plan",
  where: "on the Plan",
  show: "Show on plan",
  loading: "Loading the plan…",
  item: "card",
  kind: "City plan",
  mouse: [
    { keys: ["Drag"], does: "Move the plan" },
    {
      keys: ["Scroll", "Pinch"],
      does: "Zoom toward the point under the cursor, or away",
    },
    {
      keys: ["Hover"],
      does: "With nothing selected, light a type's lines in the layers that are on",
    },
    {
      keys: ["Click"],
      does: "Select a card, or clear the selection by clicking empty space. Focus stays on",
    },
    { keys: ["Double click"], does: "Focus a card" },
    {
      keys: ["Overview"],
      does: "Drag or scroll the small plan in the corner to move around the whole schema",
    },
  ],
  navigation: [
    {
      keys: ["←", "↑", "↓", "→"],
      does: "Move the plan, unless a list, field or panel has the keyboard",
    },
    { keys: ["+", "-"], does: "Zoom in and out" },
    { keys: ["Shift"], does: "Hold with the arrows to move twice as far" },
    {
      keys: ["Home"],
      does: "Frame the whole plan, or leave focus. Reset view in the toolbar does the same",
    },
  ],
  legend: <PlanLegend />,
};
