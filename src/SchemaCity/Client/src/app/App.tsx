import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PortalContainer } from "@/portal";
import { findFindings } from "../model/findings";
import { neighbourhoods } from "../model/neighbourhood";
import { searchNodes } from "../model/search";
import type { SchemaGraph, UsageReport } from "../model/types";
import { Findings } from "./Findings";
import { Help } from "./Help";
import { Inspector, INSPECTOR_WIDTH } from "./Inspector";
import { TypeTable } from "./TypeTable";
import { DEFAULT_LAYERS, type Layer, LAYERS } from "./scene/layers";
import { type Lens, LENS_LABEL, LENSES, lensScale, type Ramp } from "./scene/lens";
import { parseUrl, type UrlState, urlToWrite, type View } from "./url";

const LAYER_LABEL: Record<Layer, string> = {
  structure: "Structure",
  compositions: "Compositions",
  blocks: "Blocks",
  references: "References",
};

/**
 * `layers` with one layer switched. Rebuilt from LAYERS rather than pushed onto, so
 * the URL writes its layers in toolbar order however they were switched on.
 */
const withLayer = (on: Layer[], layer: Layer): Layer[] =>
  LAYERS.filter((name) => (name === layer ? !on.includes(name) : on.includes(name)));

/** One edge style, drawn the way the scene draws it. */
function EdgeMark({
  className,
  d,
  dashed = false,
  width = 1.25,
}: {
  className: string;
  d: string;
  dashed?: boolean;
  width?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="12"
      viewBox="0 0 26 12"
      width="26"
    >
      <path
        d={d}
        stroke="currentColor"
        strokeDasharray={dashed ? "2 3" : undefined}
        strokeWidth={width}
      />
    </svg>
  );
}

function LegendRow({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex w-7 shrink-0 justify-center">{mark}</span>
      {children}
    </li>
  );
}

function LegendTitle({ children }: { children: ReactNode }) {
  return (
    <p className="font-bold text-2xs text-phosphor-bright uppercase tracking-terminal-lg">
      {children}
    </p>
  );
}

const Tint = ({ className }: { className: string }) => (
  <span className={`size-3 ${className}`} />
);

function Legend() {
  return (
    <div className="space-y-3.5">
      <section>
        <LegendTitle>Buildings</LegendTitle>
        <ul className="mt-2 space-y-1.5 text-muted-foreground text-xs">
          <LegendRow mark={<Tint className="bg-phosphor" />}>Own property group</LegendRow>
          <LegendRow mark={<Tint className="bg-phosphor/45" />}>Composed group</LegendRow>
          <LegendRow mark={<Tint className="bg-amber" />}>
            Element Type, until a lens is on
          </LegendRow>
          <LegendRow mark={<Tint className="bg-phosphor-dim" />}>Root plaza</LegendRow>
          <LegendRow mark={<Tint className="bg-signal" />}>Selected</LegendRow>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          One floor per property group, and a wider footprint for more own properties.
        </p>
      </section>

      <section>
        <LegendTitle>Layers</LegendTitle>
        <ul className="mt-2 space-y-1.5 text-muted-foreground text-xs">
          <LegendRow
            mark={
              <EdgeMark className="text-phosphor-dim" d="M1 6 H25 M13 3 L17 6 L13 9" />
            }
          >
            Allowed child, in the arrow's direction
          </LegendRow>
          <LegendRow mark={<EdgeMark className="text-azure" d="M1 11 Q13 -1 25 11" />}>
            Composition
          </LegendRow>
          <LegendRow
            mark={<EdgeMark className="text-azure" d="M1 11 Q13 -1 25 11" width={3} />}
          >
            Inheritance
          </LegendRow>
          <LegendRow mark={<EdgeMark className="text-amber" d="M1 1 Q13 13 25 1" />}>
            Block target, dipping to the Element district
          </LegendRow>
          <LegendRow mark={<EdgeMark className="text-violet" d="M1 6 H25" dashed />}>
            Picker reference
          </LegendRow>
        </ul>
      </section>
    </div>
  );
}

/** The legend's colour bar, the same two ends the scene mixes its buildings between. */
const RAMP_BAR: Record<Ramp, string> = {
  sequential: "bg-linear-to-r from-amber to-azure",
  diverging: "bg-linear-to-r from-amber via-phosphor-dim to-azure",
  binary: "bg-linear-to-r from-phosphor-dim to-signal",
};

// three.js, fiber and drei are a third of the bundle, so they load with the scene
// rather than with the workspace element.
const Scene = lazy(() => import("./Scene"));

export function App({
  graph,
  usage,
  icons,
  onOpenType,
  initial,
  onStateChange,
}: {
  graph: SchemaGraph;
  /** The usage report, once it has arrived. The city never waits for it. */
  usage?: UsageReport;
  /**
   * Umbraco icon name to SVG string, for the roofs. The wrappers resolve these from
   * the backoffice icon registry; a name that is missing draws no icon.
   */
  icons?: Record<string, string>;
  onOpenType?: (id: string) => void;
  /**
   * Where to start. Left out, the app reads its own query string. `type` is a node
   * id or an alias, because the Document Type editor knows the key it is on and a
   * link knows the alias.
   */
  initial?: {
    type?: string | null;
    focus?: boolean;
    layers?: Layer[];
    lens?: Lens;
    view?: View;
  };
  /** Given, the host owns the address bar and the app writes nothing. */
  onStateChange?: (state: UrlState) => void;
}) {
  const [start] = useState(() => {
    const state =
      initial ?? parseUrl(window.location.search, graph.nodes.map((node) => node.alias));
    const node =
      graph.nodes.find((candidate) => candidate.id === state.type) ??
      graph.nodes.find((candidate) => candidate.alias === state.type);
    return {
      id: node?.id ?? null,
      focus: state.focus === true,
      layers: state.layers ?? [...DEFAULT_LAYERS],
      lens: state.lens ?? "none",
      view: state.view ?? "city",
    };
  });
  const [selected, setSelected] = useState<string | null>(start.id);
  const [focus, setFocus] = useState<string | null>(start.focus ? start.id : null);
  const [layers, setLayers] = useState<Layer[]>(start.layers);
  const [lens, setLens] = useState<Lens>(start.lens);
  const [view, setView] = useState<View>(start.view);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Bumped by Home when there is no focus to leave. The scene passes it to the
  // camera rig, which flies back to the city framing and leaves the buildings alone.
  const [reframe, setReframe] = useState(0);
  const [query, setQuery] = useState("");
  const portal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // The palette owns the keyboard while it is open, including its own Escape.
      // Picking a row closes it inside the same keystroke, and React has swapped
      // this listener for one that reads the palette as closed by the time the
      // event reaches the document, so the Enter that chose a type would focus it
      // too. cmdk calls preventDefault on the key it consumed, which is the tell.
      if (paletteOpen || helpOpen || event.defaultPrevented) return;
      // The event that crossed a shadow boundary reports the host as its target, so
      // ask the path where it actually started. A field being typed into keeps every
      // letter below, and so does anything inside a dialog or a drawer.
      const from = event.composedPath()[0];
      if (
        from instanceof HTMLElement &&
        (from.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName) ||
          from.closest('[role="dialog"]'))
      ) {
        return;
      }
      if (event.key === "Enter" && selected) setFocus(selected);
      // Escape leaves focus first and clears the selection second, so the way out
      // of focus mode never also loses the node you were reading.
      if (event.key === "Escape") {
        if (focus) setFocus(null);
        else setSelected(null);
      }
      // The single-key bindings below. A modifier means the key belongs to the
      // browser or to the backoffice around us, not to the city. Shift is the
      // exception, because "?" is Shift and a slash.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Number, not an index into "1234": a key that is the empty string, which is
      // what a synthetic event without one carries, is at index 0 of any string and
      // would switch the first layer off.
      const digit = Number(event.key);
      if (digit >= 1 && digit <= 4) {
        const layer = LAYERS[digit - 1];
        setLayers((on) => withLayer(on, layer));
        return;
      }
      // Turning either view off goes back to the city, the way the toolbar's two
      // toggles do.
      const key = event.key.toLowerCase();
      if (key === "l") setView((at) => (at === "list" ? "city" : "list"));
      if (key === "e") setView((at) => (at === "explore" ? "city" : "explore"));
      // Leaving focus already flies back to the whole city, so Home only asks for a
      // fresh framing when there is no focus to leave.
      if (key === "home") {
        if (focus) setFocus(null);
        else setReframe((count) => count + 1);
      }
      if (key === "?") setHelpOpen(true);
    };
    // Keyboard events cross the shadow boundary, so one document listener covers
    // both the backoffice and the harness.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paletteOpen, helpOpen, selected, focus]);

  const nodes = graph.nodes;
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const neighbourhoodById = useMemo(() => neighbourhoods(graph), [graph]);
  const aliasById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.alias])),
    [nodes],
  );

  // A host that placed the app somewhere, like the Relationships tab on the
  // Document Type editor, owns that address: it hears about the state through the
  // callback, and writing to the query string would put ours on Umbraco's route.
  // Read once, because a wrapper re-rendering with a fresh object literal must not
  // change who owns the URL, and kept in a ref so a new callback each render does
  // not make this effect run again.
  const [hostOwnsUrl] = useState(() => Boolean(initial || onStateChange));
  // The route the app was mounted under. Anything else in the address bar means the host
  // has navigated, and writing then would land our query on someone else's route.
  const [mountedAt] = useState(() => window.location.pathname);
  const mirror = useRef(onStateChange);
  mirror.current = onStateChange;

  useEffect(() => {
    // The type in the link is the one the view is about, which in focus mode is
    // the focused node even when a click inside its neighbourhood selected
    // another. That selection is the one thing here a link cannot carry back.
    const at = focus ?? selected;
    const state: UrlState = {
      type: at ? aliasById.get(at) ?? null : null,
      focus: focus !== null,
      layers,
      lens,
      view,
    };
    mirror.current?.(state);
    if (hostOwnsUrl) return;
    const url = urlToWrite(state, mountedAt, window.location.pathname);
    if (url !== null) window.history.replaceState(null, "", url);
  }, [selected, focus, layers, lens, view, aliasById, hostOwnsUrl, mountedAt]);
  // The palette opens on the whole schema rather than on nothing, so it reads as a
  // list of every type that a query narrows, not as a box that waits to be fed.
  const byName = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );
  const hits = useMemo(
    () =>
      query.trim() === ""
        ? byName.map((node) => ({ node, propertyAlias: null }))
        : searchNodes(nodes, query, nodes.length),
    [byName, nodes, query],
  );
  // The district each type would stand in, from the graph alone: the palette has no
  // placements, and this is the same three-way split the layout makes. A type nothing
  // can create and nothing points at is detached, which is the dim swatch.
  const swatchOf = useMemo(() => {
    const placeable = new Set(
      (graph.edges ?? []).filter((edge) => edge.kind === "allowedChild").map((edge) => edge.to),
    );
    return (node: (typeof nodes)[number]) =>
      node.isElement
        ? "bg-amber"
        : node.allowedAsRoot || placeable.has(node.id)
          ? "bg-phosphor"
          : "bg-phosphor-dim";
  }, [graph.edges]);
  const findings = useMemo(() => findFindings(graph, usage), [graph, usage]);
  const scale = useMemo(() => lensScale(graph, usage, lens), [graph, usage, lens]);
  const selectedNode = selected ? nodesById.get(selected) : undefined;
  const neighbourhood = selectedNode && neighbourhoodById.get(selectedNode.id);

  const openPalette = (open: boolean) => {
    setPaletteOpen(open);
    if (!open) setQuery("");
  };

  const enterFocus = (id: string) => {
    setSelected(id);
    setFocus(id);
  };

  // Following a link, from the inspector or the palette, while focused moves the
  // whole layout with it. The lists you are reading are what you fly between.
  const followLink = (id: string) => (focus ? enterFocus(id) : setSelected(id));

  const pick = (id: string) => {
    followLink(id);
    openPalette(false);
  };

  return (
    <PortalContainer value={portal}>
      <div className="flex h-full flex-col bg-background font-mono text-foreground">
        {/* Wrapping, not a breakpoint: the toolbar folds when its own contents stop
            fitting, which is 848 px with the lens picker reading None and earlier
            once a longer lens name widens it. The backoffice is narrower than the
            harness, and a media query would have to guess by how much. ml-auto still
            holds the right group against the right edge on whichever row it lands.

            shrink-0 so the column below can never trade the second row away, and
            relative z-10 with a background of its own because the scene under it is
            a positioned layer: a positioned box paints over a plain sibling's text
            whatever the source order, so the toolbar has to be on a layer too. */}
        <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-line border-b bg-background px-4 py-2.5">
          <h1 className="shrink-0 font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
            Schema City
          </h1>

          {/* One button rather than four, because the backoffice is narrower than
              the harness and four of them ran off the edge. The count is on the
              label so the toolbar still says how much of the city is drawn.
              ponytail: base-ui's Menu is 6.9 kB gzipped of vendor that nothing else
              here uses. Four checkbox rows in the Popover already in the bundle
              would be free, at the cost of writing the roving focus and the
              typeahead this gets for nothing. Swap it if the bundle gets tight. */}
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
                  onCheckedChange={() => setLayers((on) => withLayer(on, layer))}
                >
                  {LAYER_LABEL[layer]}
                  <DropdownMenuShortcut>{index + 1}</DropdownMenuShortcut>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* The camera is always one of the two, so it is a segmented pair rather
              than a lone Explore toggle: one toggle says what Explore is and never
              what it is instead, which is a fixed isometric angle. List is its own
              toggle still, because the table is not a third camera, and turning it
              off goes back to whichever camera the pair is on.

              Picking a camera from the list leaves the list, the way turning
              Explore on used to. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="font-bold text-2xs text-phosphor-dim uppercase tracking-terminal">
              Camera
            </span>
            <ToggleGroup
              aria-label="Camera"
              onValueChange={(value) =>
                setView(value[0] === "free" ? "explore" : "city")
              }
              size="sm"
              value={[view === "explore" ? "free" : "iso"]}
              variant="outline"
            >
              <ToggleGroupItem value="iso">Iso</ToggleGroupItem>
              <ToggleGroupItem value="free">Free</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Toggle
            onPressedChange={(on) => setView(on ? "list" : "city")}
            pressed={view === "list"}
            size="sm"
            variant="outline"
          >
            List
          </Toggle>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* A disabled trigger swallows its own pointer events, and with them
                the hover the tooltip needs, so the tooltip wraps the label. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <label className="flex shrink-0 items-center gap-1.5 font-bold text-2xs text-phosphor-dim uppercase tracking-terminal" />
                }
              >
                Lens
                <Select
                  disabled={!usage}
                  items={LENSES.map((name) => ({ label: LENS_LABEL[name], value: name }))}
                  onValueChange={(value) => setLens(value as Lens)}
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
              {usage ? null : (
                <TooltipContent>The usage endpoint did not answer, so the lens is off.</TooltipContent>
              )}
            </Tooltip>

            <Findings findings={findings} nodesById={nodesById} onSelect={followLink} />

            <Popover>
              <PopoverTrigger
                render={<Button data-trigger size="sm" variant="outline" />}
              >
                Legend
              </PopoverTrigger>
              <PopoverContent className="w-80 text-sm">
                <Legend />
              </PopoverContent>
            </Popover>

            <Help onOpenChange={setHelpOpen} open={helpOpen} />

            {/* No tooltip on a control that opens a dialog: the tooltip's exit
                animation plays over the dialog opening, which reads as the label
                flying away. The shortcut goes in the button instead. */}
            <Button data-trigger onClick={() => openPalette(true)} size="sm">
              Search
              <Kbd>⌘K</Kbd>
            </Button>
          </div>
        </div>

        {scale ? (
          <div className="relative z-10 flex shrink-0 items-center gap-2 border-line border-b bg-background px-4 py-1.5 text-2xs text-phosphor-dim">
            <span className="font-bold uppercase tracking-terminal">{LENS_LABEL[lens]}</span>
            <span>{scale.minLabel}</span>
            <span aria-hidden className={`h-2 w-32 ${RAMP_BAR[scale.ramp]}`} />
            <span>{scale.maxLabel}</span>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1">
          {/* The scene and the label layer over it get a stacking context of
              their own, so the inspector sits above both on a plain z-10. */}
          {view === "list" ? (
            // The inspector is an overlay, so the table is inset by its width while
            // it is open rather than sliding under it.
            <div className={`absolute inset-0 ${selectedNode ? "pr-80" : ""}`}>
              <TypeTable
                graph={graph}
                onQuery={setQuery}
                onSelect={setSelected}
                query={query}
                selected={selected}
                usage={usage}
              />
            </div>
          ) : nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-8 text-center">
              <p className="font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
                No Document Types yet
              </p>
              <p className="text-muted-foreground text-xs">
                Create one under Settings, Document Types, and it turns up here as a building.
              </p>
            </div>
          ) : (
            <div className="absolute inset-0 z-0">
              <Suspense
                fallback={
                  <p className="p-4 text-phosphor-dim text-sm">Loading the scene…</p>
                }
              >
                <Scene
                  explore={view === "explore"}
                  focus={focus}
                  graph={graph}
                  icons={icons}
                  inspectorWidth={selectedNode && neighbourhood ? INSPECTOR_WIDTH : 0}
                  layers={layers}
                  onFocus={enterFocus}
                  onSelect={setSelected}
                  reframe={reframe}
                  scale={scale}
                  selected={selected}
                  usage={usage}
                />
              </Suspense>
            </div>
          )}

          {selectedNode && neighbourhood ? (
            <Inspector
              focused={focus === selectedNode.id}
              icons={icons}
              neighbourhood={neighbourhood}
              node={selectedNode}
              nodesById={nodesById}
              onClose={() => setSelected(null)}
              onOpenType={onOpenType}
              onSelect={followLink}
              onToggleFocus={() =>
                focus === selectedNode.id ? setFocus(null) : enterFocus(selectedNode.id)
              }
              usage={usage?.byType[selectedNode.id]}
            />
          ) : null}
        </div>

        {/* One height whatever the query matches, so the panel never jumps while
            you type and the list scrolls inside it. */}
        <CommandDialog
          className="h-[60vh] min-h-80 sm:max-w-xl"
          onOpenChange={openPalette}
          open={paletteOpen}
        >
          {/* Afterglow's CommandDialog is the dialog only, so the cmdk root is ours.
              Filtering is ours too: cmdk scores its own item labels, which would
              miss the property aliases the rows do not print. */}
          <Command shouldFilter={false}>
            <CommandInput
              onValueChange={setQuery}
              placeholder="Find a type or a property alias…"
              trailing={<Kbd className="shrink-0">Esc</Kbd>}
              value={query}
            />
            <div className="flex justify-end border-line border-b px-3 py-1 font-bold text-3xs text-phosphor-dim uppercase tracking-terminal">
              {hits.length} of {nodes.length} types
            </div>
            <CommandList
              /* cmdk puts a sizer div between the list and its rows, so the empty
                 state can only fill the box if that div is a column too. */
              className="max-h-none flex-1 [&_[cmdk-list-sizer]]:flex [&_[cmdk-list-sizer]]:h-full [&_[cmdk-list-sizer]]:flex-col"
            >
              {hits.length === 0 ? (
                <CommandEmpty className="flex flex-1 items-center justify-center py-0">
                  No type or property matches
                </CommandEmpty>
              ) : (
                hits.map((hit) => (
                  <CommandItem
                    className="group"
                    key={hit.node.id}
                    onSelect={() => pick(hit.node.id)}
                    value={hit.node.id}
                  >
                    <span
                      aria-hidden
                      className={`size-2.5 shrink-0 ${swatchOf(hit.node)}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{hit.node.name}</span>
                      <span className="block truncate text-3xs text-phosphor-dim">
                        {hit.node.alias}
                      </span>
                    </span>
                    <span className="shrink-0 text-2xs text-phosphor-dim">
                      {hit.propertyAlias ??
                        `${hit.node.ownPropertyCount + hit.node.composedPropertyCount} properties`}
                    </span>
                    <Kbd
                      className="shrink-0 opacity-0 group-data-[selected=true]:opacity-100"
                      glyph
                    >
                      ↵
                    </Kbd>
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </CommandDialog>

        <div ref={portal} />
      </div>
    </PortalContainer>
  );
}
