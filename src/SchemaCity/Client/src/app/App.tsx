import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { dataTypeNames, dataTypeUsers } from "../model/data-types";
import { findFindings } from "../model/findings";
import { impactOf } from "../model/impact";
import { neighbourhoods } from "../model/neighbourhood";
import { reachableWithin } from "../model/reach";
import { searchNodes } from "../model/search";
import { compareSchemas } from "../model/snapshots";
import type { SchemaGraph, UsageReport } from "../model/types";
import {
  citySummary,
  LiveRegion,
  plural,
  SEARCH_KEY,
  useHandOff,
} from "./a11y";
import { ComparisonLegend, ComparisonTools } from "./ComparisonTools";
import { Findings } from "./Findings";
import { Help } from "./Help";
import { INSPECTOR_INSET, Inspector } from "./Inspector";
import { DataTypeLinks, TextButton } from "./InspectorChips";
import { Legend } from "./Legend";
import type { Grouping } from "./layout/city";
import { DEFAULT_LAYERS, LAYERS, type Layer } from "./scene/layers";
import {
  highlightScale,
  LENS_LABEL,
  LENSES,
  type Lens,
  lensScale,
  type Ramp,
} from "./scene/lens";
import { enterFocuses } from "./shortcuts";
import {
  FLAT_VIEWS,
  parseUrl,
  type UrlState,
  urlToWrite,
  type View,
} from "./url";
import {
  Announcements,
  FlatView,
  focusScope,
  VIEW_TABS,
  ViewSwitcher,
} from "./Views";

/** The tag names whose own keyboard handling wins over the shortcut keys. */
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "structure", label: "Structure" },
  { value: "folders", label: "Folders" },
];

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
  LAYERS.filter((name) =>
    name === layer ? !on.includes(name) : on.includes(name)
  );

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
  onOpenDataType,
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
  /** Opens a Data Type in the backoffice editor. */
  onOpenDataType?: (id: string) => void;
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
    group?: Grouping;
    dataType?: string | null;
  };
  /** Given, the host owns the address bar and the app writes nothing. */
  onStateChange?: (state: UrlState) => void;
}) {
  const [start] = useState(() => {
    const state =
      initial ??
      parseUrl(
        window.location.search,
        graph.nodes.map((node) => node.alias)
      );
    const found =
      graph.nodes.find((candidate) => candidate.id === state.type) ??
      graph.nodes.find((candidate) => candidate.alias === state.type);
    return {
      id: found?.id ?? null,
      focus: state.focus === true,
      layers: state.layers ?? [...DEFAULT_LAYERS],
      lens: state.lens ?? "none",
      view: state.view ?? "city",
      group: state.group ?? "structure",
      dataType: state.dataType ?? null,
    };
  });
  const [selected, setSelected] = useState<string | null>(start.id);
  const [focus, setFocus] = useState<string | null>(
    start.focus ? start.id : null
  );
  const [focusDepth, setFocusDepth] = useState(1);
  const [baseline, setBaseline] = useState<SchemaGraph | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [layers, setLayers] = useState<Layer[]>(start.layers);
  const [lens, setLens] = useState<Lens>(start.lens);
  const [view, setView] = useState<View>(start.view);
  const [group, setGroup] = useState<Grouping>(start.group);
  const [dataType, setDataType] = useState<string | null>(start.dataType);
  // What Show in city lights up, from a Data Type page or an impact trace, until
  // Clear or a lens. The label finishes "Lit: ", as "types using Textstring".
  const [highlight, setHighlight] = useState<{
    label: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  // The type the Impact view traces when it was opened for one, and the property
  // alias it checks. Clicking a row there selects that type without moving the
  // trace; anywhere else the view traces the selection.
  const [impactStart, setImpactStart] = useState<string | null>(null);
  const [impactAlias, setImpactAlias] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(false);
  // Bumped by Home when there is no focus to leave. The scene passes it to the
  // camera rig, which flies back to the city framing and leaves the buildings alone.
  const [reframe, setReframe] = useState(0);
  const [query, setQuery] = useState("");
  const portal = useRef<HTMLDivElement>(null);

  // Home, and the Reset view button over the city. Leaving focus already flies back
  // to the whole city, so it only asks for a fresh framing with no focus to leave.
  const resetView = () => {
    if (focus) setFocus(null);
    else setReframe((count) => count + 1);
  };

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
      const [from] = event.composedPath();
      if (
        from instanceof HTMLElement &&
        (from.isContentEditable ||
          FIELD.test(from.tagName) ||
          from.closest('[role="dialog"]'))
      ) {
        return;
      }
      if (selected && enterFocuses(event)) {
        setFocusDepth(1);
        setFocus(selected);
      }
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
      // A view key pressed again goes back to the city.
      const key = event.key.toLowerCase();
      const tab = VIEW_TABS.find((candidate) => candidate.key === key);
      if (tab) setView((at) => (at === tab.value ? "city" : tab.value));
      if (key === "home") resetView();
      if (key === "?") setHelpOpen(true);
    };
    // Keyboard events cross the shadow boundary, so one document listener covers
    // both the backoffice and the harness.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paletteOpen, helpOpen, selected, focus]);

  const { nodes } = graph;
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  );
  const neighbourhoodById = useMemo(() => neighbourhoods(graph), [graph]);
  const aliasById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.alias])),
    [nodes]
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
      type: at ? (aliasById.get(at) ?? null) : null,
      focus: focus !== null,
      layers,
      lens,
      view,
      group,
      dataType,
    };
    mirror.current?.(state);
    if (hostOwnsUrl) return;
    const url = urlToWrite(state, mountedAt, window.location.pathname);
    if (url !== null) window.history.replaceState(null, "", url);
  }, [
    selected,
    focus,
    layers,
    lens,
    view,
    group,
    dataType,
    aliasById,
    hostOwnsUrl,
    mountedAt,
  ]);
  // The palette opens on the whole schema rather than on nothing, so it reads as a
  // list of every type that a query narrows, not as a box that waits to be fed.
  const byName = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes]
  );
  const hits = useMemo(
    () =>
      query.trim() === ""
        ? byName.map((node) => ({ node, propertyAlias: null }))
        : searchNodes(nodes, query, nodes.length),
    [byName, nodes, query]
  );
  // The district each type would stand in, from the graph alone: the palette has no
  // placements, and this is the same three-way split the layout makes. A type nothing
  // can create and nothing points at is detached, which is the dim swatch.
  const swatchOf = useMemo(() => {
    const placeable = new Set(
      (graph.edges ?? [])
        .filter((edge) => edge.kind === "allowedChild")
        .map((edge) => edge.to)
    );
    return (node: (typeof nodes)[number]) =>
      node.isElement
        ? "bg-amber"
        : node.allowedAsRoot || placeable.has(node.id)
          ? "bg-phosphor"
          : "bg-phosphor-dim";
  }, [graph.edges]);
  const findings = useMemo(() => findFindings(graph, usage), [graph, usage]);
  const dataTypeName = useMemo(() => dataTypeNames(graph), [graph]);
  // Show in city takes the lens's place on the buildings while it is on.
  const scale = useMemo(
    () =>
      highlight
        ? highlightScale(graph, highlight.ids)
        : lensScale(graph, usage, lens, findings),
    [graph, usage, lens, findings, highlight]
  );
  const comparison = useMemo(
    () => (baseline ? compareSchemas(baseline, graph) : null),
    [baseline, graph]
  );
  // The focused neighbourhood, which the 2D views narrow to as the city does.
  const scope = useMemo(
    () => focusScope(graph, focus, focusDepth),
    [graph, focus, focusDepth]
  );
  const focusCount = useMemo(
    () => (focus ? reachableWithin(graph, focus, focusDepth).size : 0),
    [graph, focus, focusDepth]
  );
  const canExpandFocus = useMemo(
    () =>
      focus
        ? reachableWithin(graph, focus, focusDepth + 1).size > focusCount
        : false,
    [graph, focus, focusDepth, focusCount]
  );
  const selectedNode = selected ? nodesById.get(selected) : undefined;
  const flat = FLAT_VIEWS.includes(view);
  const neighbourhood = selectedNode && neighbourhoodById.get(selectedNode.id);

  const openPalette = (open: boolean) => {
    setPaletteOpen(open);
    if (!open) setQuery("");
  };

  const enterFocus = (id: string) => {
    setFocusDepth(1);
    setSelected(id);
    setFocus(id);
  };

  /**
   * Done with this node: closing the inspector and clicking bare ground both leave
   * focus and clear the selection in one step, because either one is the reader
   * putting the type down. Escape keeps its two steps, which is how you leave focus
   * and go on reading the type you were focused on.
   */
  const done = () => {
    setFocus(null);
    setSelected(null);
  };

  // Following a link, from the inspector or the palette, while focused moves the
  // whole layout with it. The lists you are reading are what you fly between.
  const followLink = (id: string) => (focus ? enterFocus(id) : setSelected(id));

  // Every Data Type name in the app links here: its page, with the drawers that
  // can hold such a link closed so the page is what you see.
  const dataTypeLinks = useMemo(
    () => ({
      open: (id: string) => {
        setFindingsOpen(false);
        setComparisonOpen(false);
        setDataType(id);
        setView("datatypes");
      },
      nameOf: (id: string) => dataTypeName.get(id),
    }),
    [dataTypeName]
  );

  const showInCity = (label: string, ids: ReadonlySet<string>) => {
    setHighlight({ label, ids });
    setView("city");
  };

  // The Impact view on one type, and on one of its property aliases when given.
  const openImpact = (id: string | null, alias = "") => {
    setImpactStart(id);
    setImpactAlias(alias);
    setView("impact");
  };
  // Leaving the view lets go of the type it was opened for, so coming back with I
  // or the switcher traces whatever is selected then.
  useEffect(() => {
    if (view !== "impact") setImpactStart(null);
  }, [view]);
  // The inspector's Impact tab: every relationship, any depth, for the selection.
  const selectedImpact = useMemo(
    () => (selected ? impactOf(graph, selected, {}, usage) : null),
    [graph, selected, usage]
  );

  // A chosen row opens the inspector, so focus goes to its heading, not back to
  // the Search button.
  const handOff = useHandOff(portal);
  const pick = (id: string) => {
    handOff.chose();
    followLink(id);
    openPalette(false);
  };

  return (
    <LiveRegion portal={portal}>
      <DataTypeLinks value={dataTypeLinks}>
        <section
          aria-label="Schema City"
          className="flex h-full flex-col bg-background font-mono text-foreground"
          data-schema-city=""
        >
          <Announcements
            focus={scope}
            layers={layers.map((layer) => LAYER_LABEL[layer])}
            lit={highlight?.label ?? null}
            nodesById={nodesById}
            selected={selected}
            view={view}
          />
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
                    onCheckedChange={() =>
                      setLayers((on) => withLayer(on, layer))
                    }
                  >
                    {LAYER_LABEL[layer]}
                    <DropdownMenuShortcut>{index + 1}</DropdownMenuShortcut>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Structure follows what an editor can create where, Folders the
              folders the schema files its types in. Only the city is grouped. */}
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the Select this label names is its child, one JSX level below what the rule reads. */}
            <label className="flex shrink-0 items-center gap-1.5 font-bold text-2xs text-phosphor-dim uppercase tracking-terminal">
              Group
              <Select
                disabled={view !== "city"}
                items={GROUPINGS}
                onValueChange={(value) => {
                  // The comparison's baseline positions and a focus both stand on the
                  // city layout, so a new grouping starts from the whole city.
                  setFocus(null);
                  setGroup(value as Grouping);
                }}
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

            <ViewSwitcher onView={setView} view={view} />

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* A disabled trigger swallows its own pointer events, and with them
                the hover the tooltip needs, so the tooltip wraps the label. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    // biome-ignore lint/a11y/noLabelWithoutControl: the Select this label names is its child, one JSX level below what the rule reads.
                    <label className="flex shrink-0 items-center gap-1.5 font-bold text-2xs text-phosphor-dim uppercase tracking-terminal" />
                  }
                >
                  Lens
                  <Select
                    disabled={!usage}
                    items={LENSES.map((name) => ({
                      label: LENS_LABEL[name],
                      value: name,
                    }))}
                    onValueChange={(value) => {
                      setHighlight(null);
                      setLens(value as Lens);
                    }}
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
                  <TooltipContent>
                    The usage endpoint did not answer, so the lens is off.
                  </TooltipContent>
                )}
              </Tooltip>

              <Findings
                findings={findings}
                graph={graph}
                nodesById={nodesById}
                onOpenChange={setFindingsOpen}
                onSelect={followLink}
                open={findingsOpen}
                usage={usage}
              />

              <ComparisonTools
                baseline={baseline}
                comparison={comparison}
                graph={graph}
                onBaselineChange={(next) => {
                  setBaseline(next);
                  setFocus(null);
                  if (next) setLens("none");
                }}
                onOpenChange={setComparisonOpen}
                onSelect={(id) => {
                  setComparisonOpen(false);
                  followLink(id);
                }}
                open={comparisonOpen}
              />

              <Legend />

              <Help onOpenChange={setHelpOpen} open={helpOpen} />

              {/* No tooltip on a control that opens a dialog: the tooltip's exit
                animation plays over the dialog opening, which reads as the label
                flying away. The shortcut goes in the button instead. */}
              <Button data-trigger onClick={() => openPalette(true)} size="sm">
                Search
                <Kbd>{SEARCH_KEY}</Kbd>
              </Button>
            </div>
          </div>

          {/* A container, so the inspector sizes itself to the room the workspace has. */}
          <div className="@container relative min-h-0 flex-1">
            {/* The legend is an overlay in the corner of the canvas rather than a row
              above it. As a row it took its height out of the canvas the moment a
              lens was picked, and the scene dropped and re-fitted itself around the
              new viewport, which reads as the city flinching at a colour change.
              Anything else that only appears sometimes belongs over the canvas for
              the same reason. It covers its own box and nothing else, so the ground
              under it is the only pick the canvas loses. The list view colours
              nothing by lens, so it gets no legend over its first row. */}
            {highlight && !flat ? (
              <div className="absolute top-0 left-0 z-10 flex max-w-full flex-wrap items-center gap-x-2 border-line border-r border-b bg-background px-4 py-1.5 text-2xs text-phosphor-dim">
                <span
                  aria-hidden
                  className={`h-2 w-6 shrink-0 ${RAMP_BAR.binary}`}
                />
                <span className="font-sans text-label text-xs">
                  Lit: <span className="text-prose">{highlight.label}</span>
                </span>
                <TextButton onClick={() => setHighlight(null)}>
                  Clear
                </TextButton>
              </div>
            ) : scale && !flat ? (
              <div className="absolute top-0 left-0 z-10 flex items-center gap-2 border-line border-r border-b bg-background px-4 py-1.5 text-2xs text-phosphor-dim">
                <span className="font-bold uppercase tracking-terminal">
                  {LENS_LABEL[lens]}
                </span>
                <span>{scale.minLabel}</span>
                <span
                  aria-hidden
                  className={`h-2 w-32 ${RAMP_BAR[scale.ramp]}`}
                />
                <span>{scale.maxLabel}</span>
              </div>
            ) : null}
            {/* The scene and the label layer over it get a stacking context of
              their own, so the inspector sits above both on a plain z-10. */}
            {flat ? null : <ComparisonLegend comparison={comparison} />}
            {flat ? (
              // The inspector is an overlay, so the view is inset by its width while
              // it is open rather than sliding under it.
              <div
                className={`absolute inset-0 outline-none ${selectedNode ? INSPECTOR_INSET : ""}`}
                data-focus-home
                tabIndex={-1}
              >
                <FlatView
                  dataTypes={{
                    selected: dataType,
                    onChoose: setDataType,
                    onOpenDataType,
                    onShowInCity: (id) =>
                      showInCity(
                        `types using ${dataTypeName.get(id) ?? "the Data Type"}`,
                        new Set(
                          dataTypeUsers(graph, id).map((user) => user.node.id)
                        )
                      ),
                  }}
                  findings={findings}
                  graph={graph}
                  impact={{
                    start: impactStart ?? selected,
                    alias: impactAlias,
                    onAlias: setImpactAlias,
                    onShowInCity: showInCity,
                  }}
                  neighbourhoodById={neighbourhoodById}
                  nodesById={nodesById}
                  onImpact={(alias) => openImpact(selected, alias)}
                  onPick={() => setPaletteOpen(true)}
                  onQuery={setQuery}
                  onSelect={setSelected}
                  onShowAll={() => setFocus(null)}
                  query={query}
                  scope={scope}
                  selected={selected}
                  usage={usage}
                  view={view}
                />
              </div>
            ) : nodes.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-8 text-center">
                <p className="font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
                  No Document Types yet
                </p>
                <p className="text-muted-foreground text-xs">
                  Create one under Settings, Document Types, and it turns up
                  here as a building.
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 z-0">
                <p className="sr-only">{citySummary(graph, group)}</p>
                <Suspense
                  fallback={
                    <p className="p-4 text-phosphor-dim text-sm">
                      Loading the scene…
                    </p>
                  }
                >
                  <Scene
                    baseline={baseline}
                    comparison={comparison}
                    focus={focus}
                    focusDepth={focusDepth}
                    graph={graph}
                    grouping={group}
                    icons={icons}
                    inspectorOpen={Boolean(selectedNode && neighbourhood)}
                    layers={layers}
                    onFocus={enterFocus}
                    onReset={resetView}
                    onSelect={(id) => (id === null ? done() : setSelected(id))}
                    reframe={reframe}
                    scale={scale}
                    selected={selected}
                    usage={usage}
                  />
                </Suspense>
              </div>
            )}

            {selectedNode && neighbourhood && selectedImpact ? (
              <Inspector
                canExpandFocus={canExpandFocus}
                edges={graph.edges}
                editorLayoutOpen={view === "editor"}
                findings={findings.filter(
                  (finding) => finding.nodeId === selectedNode.id
                )}
                focusCount={focusCount}
                focusDepth={focusDepth}
                focused={focus === selectedNode.id}
                icons={icons}
                impact={selectedImpact}
                neighbourhood={neighbourhood}
                node={selectedNode}
                nodesById={nodesById}
                onClose={done}
                onEditorLayout={() => setView("editor")}
                onExpandFocus={() => setFocusDepth((depth) => depth + 1)}
                onOpenImpact={() => openImpact(selectedNode.id)}
                onOpenType={onOpenType}
                onSelect={followLink}
                onToggleFocus={() =>
                  focus === selectedNode.id
                    ? setFocus(null)
                    : enterFocus(selectedNode.id)
                }
                usage={usage?.byType[selectedNode.id]}
                usageReport={usage}
              />
            ) : null}
          </div>

          {/* One height whatever the query matches, so the panel never jumps while
            you type and the list scrolls inside it. */}
          <CommandDialog
            className="h-[60vh] min-h-80 sm:max-w-xl"
            description="Type a name, an alias or a property alias, then choose a type to open it in the inspector."
            finalFocus={handOff.finalFocus}
            onOpenChange={openPalette}
            open={paletteOpen}
            title="Search types"
          >
            {/* Afterglow's CommandDialog is the dialog only, so the cmdk root is ours.
              Filtering is ours too: cmdk scores its own item labels, which would
              miss the property aliases the rows do not print. */}
            <Command
              label="Find a type or a property alias"
              shouldFilter={false}
            >
              <CommandInput
                onValueChange={setQuery}
                placeholder="Find a type or a property alias…"
                trailing={<Kbd className="shrink-0">Esc</Kbd>}
                value={query}
              />
              <div className="flex justify-end border-line border-b px-3 py-1 font-bold text-3xs text-label uppercase tracking-terminal">
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
                  hits.map((hit) => {
                    const detail =
                      hit.propertyAlias ??
                      plural(
                        hit.node.ownPropertyCount +
                          hit.node.composedPropertyCount,
                        "property",
                        "properties"
                      );
                    return (
                      <CommandItem
                        // One sentence for a screen reader, without the Enter glyph.
                        aria-label={`${hit.node.name}, alias ${hit.node.alias}, ${hit.propertyAlias ? `property ${hit.propertyAlias}` : detail}`}
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
                          <span className="block truncate text-xs">
                            {hit.node.name}
                          </span>
                          <span className="block truncate text-3xs text-label">
                            {hit.node.alias}
                          </span>
                        </span>
                        <span className="shrink-0 text-2xs text-label">
                          {detail}
                        </span>
                        <Kbd
                          aria-hidden
                          className="shrink-0 opacity-0 group-data-[selected=true]:opacity-100"
                          glyph
                        >
                          ↵
                        </Kbd>
                      </CommandItem>
                    );
                  })
                )}
              </CommandList>
            </Command>
          </CommandDialog>

          <div ref={portal} />
        </section>
      </DataTypeLinks>
    </LiveRegion>
  );
}
