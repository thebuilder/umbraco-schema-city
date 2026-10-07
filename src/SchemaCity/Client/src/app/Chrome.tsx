// The app's own chrome: the header over the view and the footer under it. The header
// holds what works on the whole schema; the footer says how fresh the snapshot is and
// holds the City's own tools, which mean nothing over a list.
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SchemaGraph, UsageReport } from "../model/types";
import { plural, SEARCH_KEY, useAnnounce } from "./a11y";
import { snapshotDate } from "./Findings";
import { Legend } from "./Legend";
import type { Grouping } from "./layout/city";
import { LAYERS, type Layer } from "./scene/layers";
import { LENS_LABEL, LENSES, type Lens } from "./scene/lens";
import type { View } from "./url";
import { ViewSwitcher } from "./Views";

export const LAYER_LABEL: Record<Layer, string> = {
  structure: "Structure",
  compositions: "Compositions",
  blocks: "Blocks",
  references: "References",
};

const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "structure", label: "Structure" },
  { value: "folders", label: "Folders" },
];

const FIELD_LABEL =
  "flex shrink-0 items-center gap-1.5 font-bold text-2xs text-phosphor-dim uppercase tracking-terminal";

/**
 * The header: the name, the views over the whole schema, Search and the drawers.
 * Wrapping rather than a breakpoint, so it folds when its own contents stop fitting;
 * below 560 px of its own width the name goes to the screen reader alone, which
 * keeps it to two rows at a phone's width.
 *
 * relative z-10 with a background of its own because the scene under it is a
 * positioned layer, which paints over a plain sibling whatever the source order.
 * Hidden rather than unmounted while presenting, so its drawers keep their state.
 */
export function AppHeader({
  view,
  onView,
  onSearch,
  children,
}: {
  view: View;
  onView: (view: View) => void;
  onSearch: () => void;
  /** Findings, Compare and Help, which App wires to its own state. */
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Schema City header"
      className="@container relative z-10 shrink-0 border-line border-b bg-background in-data-present:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <h1 className="shrink-0 font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg @max-[560px]:sr-only">
          Schema City
        </h1>
        <ViewSwitcher onView={onView} view={view} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button data-trigger onClick={onSearch} size="sm">
            Search
            <Kbd className="@max-[560px]:hidden">{SEARCH_KEY}</Kbd>
          </Button>
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * "08:41" on the day the snapshot was taken, which in the backoffice is nearly
 * always, since it is read when the workspace opens, and "2026-09-01" on any other.
 * The Findings drawer has both halves when the exact minute matters.
 */
const stamp = (iso: string | undefined, today: string) => {
  const at = snapshotDate(iso);
  if (!at) return null;
  return at.startsWith(today) ? at.slice(11) : at.slice(0, 10);
};

/**
 * What the footer says about the snapshot the city is drawn from, as "86 types",
 * "schema read 09:12" and "usage 09:13". A date a snapshot does not really have is
 * left out, and usage says when it is still on its way or never came.
 */
export function snapshotParts(
  graph: SchemaGraph,
  usage: UsageReport | undefined,
  pending: boolean,
  today = snapshotDate(new Date().toISOString())?.slice(0, 10) ?? ""
) {
  const read = stamp(graph.generatedAt, today);
  const counted = stamp(usage?.generatedAt, today);
  const usageText = usage
    ? counted && `usage ${counted}`
    : pending
      ? "usage loading"
      : "usage unavailable";
  return [
    plural(graph.nodes.length, "type"),
    read && `schema read ${read}`,
    usageText,
  ].filter(Boolean);
}

function SnapshotStatus({
  graph,
  usage,
  usagePending = false,
}: {
  graph: SchemaGraph;
  usage?: UsageReport;
  usagePending?: boolean;
}) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-2xs text-label">
      {snapshotParts(graph, usage, usagePending).join(" · ")}
      {usage?.blocks?.partial ? (
        <span className="text-amber">
          Block counts stopped early, so they are lower bounds
        </span>
      ) : null}
    </p>
  );
}

type CityToolProps = {
  layers: Layer[];
  onLayer: (layer: Layer) => void;
  group: Grouping;
  onGroup: (group: Grouping) => void;
  lens: Lens;
  onLens: (lens: Lens) => void;
  /** False until the usage report arrives, which is what the lens reads. */
  lensReady: boolean;
  onReset: () => void;
};

/** Layers, Group, Lens, Legend and Reset view: what only the City draws. */
function CityTools({
  layers,
  onLayer,
  group,
  onGroup,
  lens,
  onLens,
  lensReady,
  onReset,
}: CityToolProps) {
  return (
    <>
      {/* One button rather than four, with the count on the label so the bar
        still says how much of the city is drawn.
        ponytail: base-ui's Menu is 6.9 kB gzipped of vendor that nothing else
        here uses. Four checkbox rows in the Popover already in the bundle would
        be free, at the cost of writing the roving focus and the typeahead this
        gets for nothing. Swap it if the bundle gets tight. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button data-trigger size="sm" variant="outline" />}
        >
          Layers {layers.length}/{LAYERS.length}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {LAYERS.map((layer, index) => (
            <DropdownMenuCheckboxItem
              checked={layers.includes(layer)}
              key={layer}
              onCheckedChange={() => onLayer(layer)}
            >
              {LAYER_LABEL[layer]}
              <DropdownMenuShortcut>{index + 1}</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Structure follows what an editor can create where, Folders the folders
        the schema files its types in. */}
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Select this label names is its child, one JSX level below what the rule reads. */}
      <label className={FIELD_LABEL}>
        Group
        <Select
          items={GROUPINGS}
          onValueChange={(value) => onGroup(value as Grouping)}
          value={group}
        >
          <SelectTrigger
            aria-label="Group the city by"
            className="text-2xs uppercase tracking-terminal"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPINGS.map(({ value, label }) => (
              <SelectItem
                className="text-2xs uppercase tracking-terminal"
                key={value}
                value={value}
              >
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {/* A disabled trigger swallows its own pointer events, and with them the
        hover the tooltip needs, so the tooltip wraps the label. */}
      <Tooltip>
        <TooltipTrigger
          render={
            // biome-ignore lint/a11y/noLabelWithoutControl: the Select this label names is its child, one JSX level below what the rule reads.
            <label className={FIELD_LABEL} />
          }
        >
          Lens
          <Select
            disabled={!lensReady}
            items={LENSES.map((name) => ({
              label: LENS_LABEL[name],
              value: name,
            }))}
            onValueChange={(value) => onLens(value as Lens)}
            value={lens}
          >
            <SelectTrigger
              aria-label="Usage lens"
              className="text-2xs uppercase tracking-terminal"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENSES.map((name) => (
                <SelectItem
                  className="text-2xs uppercase tracking-terminal"
                  key={name}
                  value={name}
                >
                  {LENS_LABEL[name]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipTrigger>
        {lensReady ? null : (
          <TooltipContent>
            The usage endpoint has not answered, so the lens is off.
          </TooltipContent>
        )}
      </Tooltip>

      <Legend />

      {/* What Home does, for the laptops that have no Home key. */}
      <Button
        aria-keyshortcuts="Home"
        aria-label="Reset view, framing the whole city again"
        onClick={onReset}
        size="sm"
        variant="outline"
      >
        Reset view
      </Button>
    </>
  );
}

/**
 * The footer: the snapshot's status on the left, then whatever the host puts there,
 * then the City's tools while the City is on and Present everywhere. Below 960 px of
 * its own width the City's tools fold into one menu, which keeps the bar to one row
 * where a narrow backoffice workspace would wrap it.
 */
export function AppFooter({
  graph,
  usage,
  usagePending,
  city,
  tools,
  onPresent,
  children,
}: {
  graph: SchemaGraph;
  usage?: UsageReport;
  usagePending?: boolean;
  /** Whether the City is on, the one view its tools mean anything in. */
  city: boolean;
  tools: CityToolProps;
  onPresent: () => void;
  /** The host's own controls, like the harness's sample picker. */
  children?: ReactNode;
}) {
  return (
    <section
      aria-label="Status and city tools"
      className="@container relative z-10 shrink-0 border-line border-t bg-background in-data-present:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <SnapshotStatus
          graph={graph}
          usage={usage}
          usagePending={usagePending}
        />
        {children}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {city ? (
            <>
              <div className="hidden flex-wrap items-center gap-2 @min-[960px]:flex">
                <CityTools {...tools} />
              </div>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      className="@min-[960px]:hidden"
                      data-trigger
                      size="sm"
                      variant="outline"
                    />
                  }
                >
                  City tools
                </PopoverTrigger>
                <PopoverContent
                  aria-label="City tools"
                  className="flex w-64 flex-col items-start gap-3 p-3"
                >
                  <CityTools {...tools} />
                </PopoverContent>
              </Popover>
            </>
          ) : null}
          {/* No tooltip on a control that changes the whole screen: its exit
            animation plays over the change. The shortcut is in the name instead. */}
          <Button
            aria-keyshortcuts="P"
            onClick={onPresent}
            size="sm"
            variant="outline"
          >
            Present
          </Button>
        </div>
      </div>
    </section>
  );
}

/** How long the hint stays when E or I has no type to open. */
const NUDGE_MS = 2500;

/**
 * The hint E and I give with nothing selected, rather than opening an empty page:
 * a line over the bottom of the view, and the same words in the live region. It
 * takes no focus and no clicks. `count` is how many times it was asked for, so
 * pressing the key again says it again.
 */
export function PickFirst({ count }: { count: number }) {
  const announce = useAnnounce();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (count === 0) return;
    announce("Pick a type first");
    setShown(true);
    const timer = setTimeout(() => setShown(false), NUDGE_MS);
    return () => clearTimeout(timer);
  }, [count, announce]);
  if (!shown) return null;
  return (
    <p className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 border border-line-strong bg-panel px-3 py-2 font-sans text-prose text-xs shadow-panel">
      Pick a type first: click a building or a row, or Search{" "}
      <Kbd>{SEARCH_KEY}</Kbd>
    </p>
  );
}
