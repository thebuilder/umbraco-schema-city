import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { dataTypeNames, dataTypeUsers } from "../model/data-types";
import { findFindings } from "../model/findings";
import { impactOf } from "../model/impact";
import { neighbourhoods } from "../model/neighbourhood";
import { reachableWithin } from "../model/reach";
import { type DecisionStore, splitReviewed } from "../model/review";
import { searchNodes } from "../model/search";
import type { SchemaGraph, UsageReport } from "../model/types";
import { citySummary, LiveRegion, plural, useHandOff } from "./a11y";
import { AppFooter, AppHeader, LAYER_LABEL, PickFirst } from "./Chrome";
import {
  ComparisonLegend,
  ComparisonTools,
  useComparison,
} from "./ComparisonTools";
import { Findings } from "./Findings";
import { Help } from "./Help";
import { Inspector } from "./Inspector";
import { TextButton } from "./InspectorChips";
import type { Grouping } from "./layout/city";
import { PresentationLayer, PresentBar, usePresentation } from "./Presentation";
import { FindingLinks, useReviewing } from "./Review";
import { DEFAULT_LAYERS, LAYERS, type Layer } from "./scene/layers";
import {
  highlightScale,
  LENS_LABEL,
  type Lens,
  type LensScale,
  lensScale,
  type Ramp,
} from "./scene/lens";
import { enterFocuses } from "./shortcuts";
import { CompareContext } from "./TypeTable";
import {
  FLAT_VIEWS,
  parseUrl,
  TYPE_PAGES,
  type UrlState,
  urlToWrite,
  type View,
  viewOf,
} from "./url";
import {
  Announcements,
  FlatView,
  focusScope,
  PAGE_TABS,
  VIEW_TABS,
} from "./Views";

/** The tag names whose own keyboard handling wins over the shortcut keys. */
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

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
  change: "bg-linear-to-r from-phosphor-dim via-amber to-azure",
};

/**
 * What colours the buildings. Show in city takes the lens's place while it is on,
 * and a lens takes the change layer's, so loading a baseline turns the lens off.
 */
const cityScale = (
  graph: SchemaGraph,
  lens: LensScale | null,
  lit: ReadonlySet<string> | null,
  layer: LensScale | null
) => (lit ? highlightScale(graph, lit) : (lens ?? layer));

/**
 * The colour key in the canvas's top-left corner: what Show in city lit, with Clear,
 * or the lens's two ends. The 2D views colour nothing by lens, so they get neither.
 */
function LensLegend({
  flat,
  highlight,
  lens,
  lensColours,
  onClear,
}: {
  flat: boolean;
  highlight: { label: string } | null;
  lens: Lens;
  lensColours: LensScale | null;
  onClear: () => void;
}) {
  if (flat) return null;
  if (highlight)
    return (
      <div className="absolute top-0 left-0 z-10 flex max-w-full flex-wrap items-center gap-x-2 border-line border-r border-b bg-background px-4 py-1.5 text-2xs text-phosphor-dim">
        <span aria-hidden className={`h-2 w-6 shrink-0 ${RAMP_BAR.binary}`} />
        <span className="font-sans text-label text-xs">
          Lit: <span className="text-prose">{highlight.label}</span>
        </span>
        <TextButton onClick={onClear}>Clear</TextButton>
      </div>
    );
  if (!lensColours) return null;
  return (
    <div className="absolute top-0 left-0 z-10 flex items-center gap-2 border-line border-r border-b bg-background px-4 py-1.5 text-2xs text-phosphor-dim">
      <span className="font-bold uppercase tracking-terminal">
        {LENS_LABEL[lens]}
      </span>
      <span>{lensColours.minLabel}</span>
      <span aria-hidden className={`h-2 w-32 ${RAMP_BAR[lensColours.ramp]}`} />
      <span>{lensColours.maxLabel}</span>
    </div>
  );
}

// three.js, fiber and drei are a third of the bundle, so they load with the scene
// rather than with the workspace element.
const Scene = lazy(() => import("./Scene"));

export function App({
  graph,
  usage,
  icons,
  onOpenType,
  onOpenDataType,
  decisions,
  initial,
  onStateChange,
  usagePending = false,
  footer,
}: {
  graph: SchemaGraph;
  /** The usage report, once it has arrived. The city never waits for it. */
  usage?: UsageReport;
  /** Whether the usage report is still on its way, which the footer says. */
  usagePending?: boolean;
  /** The host's own controls for the footer, like the harness's sample picker. */
  footer?: ReactNode;
  /**
   * Umbraco icon name to SVG string, for the roofs. The wrappers resolve these from
   * the backoffice icon registry; a name that is missing draws no icon.
   */
  icons?: Record<string, string>;
  onOpenType?: (id: string) => void;
  /** Opens a Data Type in the backoffice editor. */
  onOpenDataType?: (id: string) => void;
  /** Where review decisions are kept, the same object every render. Optional. */
  decisions?: DecisionStore;
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
    present?: boolean;
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
      // A type page needs its type, and an old link may name one with none.
      view: viewOf(state.view, found?.id ?? null),
      group: state.group ?? "structure",
      dataType: state.dataType ?? null,
      present: state.present === true,
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
  // The schema-wide view a type page goes back to, the last one that was on.
  const [back, setBack] = useState<View>(
    TYPE_PAGES.includes(start.view) ? "city" : start.view
  );
  if (!(TYPE_PAGES.includes(view) || view === back)) setBack(view);
  // Bumped when E or I is pressed with no type to open, which says so.
  const [nudge, setNudge] = useState(0);
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
  const [impactAlias, setImpactAlias] = useState<{
    text: string;
    from?: string | null;
  }>({ text: "" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(false);
  // Bumped by Home when there is no focus to leave. The scene passes it to the
  // camera rig, which flies back to the city framing and leaves the buildings alone.
  const [reframe, setReframe] = useState(0);
  const [query, setQuery] = useState("");
  const portal = useRef<HTMLDivElement>(null);
  const {
    presenting,
    details,
    setDetails,
    present,
    rootProps,
    textScale,
    panelInset,
    panelOpen,
    closeInspector,
  } = usePresentation(start.present, () => setReframe((count) => count + 1));

  // Home, and the Reset view button in the footer. Leaving focus already flies back
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
      // Presenting, Escape closes Details and then leaves presentation, keeping the
      // focus and the selection the presenter set up.
      if (event.key === "Escape" && presenting) {
        if (details) setDetails(false);
        else present(false);
      } else if (event.key === "Escape") {
        // Escape leaves focus first and clears the selection second, so the way out
        // of focus mode never also loses the node you were reading.
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
      // A view key pressed again goes back to the city, a page key to the view
      // the page was opened from.
      const key = event.key.toLowerCase();
      const tab = VIEW_TABS.find((candidate) => candidate.key === key);
      if (tab) setView((at) => (at === tab.value ? "city" : tab.value));
      const page = PAGE_TABS.find((candidate) => candidate.key === key);
      if (page) togglePage(page.value);
      if (key === "home") resetView();
      if (key === "?") setHelpOpen(true);
      if (key === "p") present(!presenting);
    };
    // Keyboard events cross the shadow boundary, so one document listener covers
    // both the backoffice and the harness.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    paletteOpen,
    helpOpen,
    selected,
    focus,
    presenting,
    details,
    view,
    back,
    impactStart,
  ]);

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
      present: presenting,
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
    presenting,
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
  const reviewing = useReviewing(decisions, graph, findings);
  const dataTypeName = useMemo(() => dataTypeNames(graph), [graph]);
  const {
    comparison,
    changes,
    compare,
    layer: changeLayer,
  } = useComparison(baseline, graph);
  // The Unused lens weighs open findings only, so a type kept unused on purpose
  // goes quiet instead of lighting up as a problem again.
  const lensColours = useMemo(
    () =>
      lensScale(
        graph,
        usage,
        lens,
        splitReviewed(findings, reviewing?.reviewOf).open
      ),
    [graph, usage, lens, findings, reviewing]
  );
  const scale = useMemo(
    () => cityScale(graph, lensColours, highlight?.ids ?? null, changeLayer),
    [graph, lensColours, highlight, changeLayer]
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
  // Where the change layer's legend holds the canvas's bottom-left corner, which the
  // caption card then sits above.
  const changeLegendShown = !flat && scale?.ramp === "change";
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
   * Done with this node: closing the inspector or the caption card, or clicking bare
   * ground, clears the selection and keeps focus. The neighbourhood is what the
   * reader set up, and a stray click on the ground should not tear it down; Leave
   * focus, Escape, Home and Show all are the ways out of it.
   */
  const putDown = () => {
    setDetails(false);
    setSelected(null);
  };

  const toggleFocus = () => {
    if (!selected) return;
    if (focus === selected) setFocus(null);
    else enterFocus(selected);
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
  const openImpact = (
    id: string | null,
    alias: { text: string; from?: string | null } = { text: "" }
  ) => {
    setImpactStart(id);
    setImpactAlias(alias);
    setView("impact");
    // The button that asked may be gone with the view it was in, the editor's
    // property rows, so the reader is put on the page's heading after the commit.
    requestAnimationFrame(() =>
      portal.current?.parentElement
        ?.querySelector<HTMLElement>("[data-impact-heading]")
        ?.focus({ preventScroll: true })
    );
  };
  // Leaving the view lets go of the type it was opened for.
  useEffect(() => {
    if (view !== "impact") setImpactStart(null);
  }, [view]);
  // The type the page on screen is about. The trace keeps its own start while a
  // click on one of its rows selects another type.
  const pageAbout = view === "impact" ? (impactStart ?? selected) : selected;
  // A type page whose type was put down goes back rather than standing empty.
  if (TYPE_PAGES.includes(view) && !pageAbout) setView(back);

  /**
   * E and I, and the inspector's Editor and Impact: the page about the selected
   * type, or, when that page is already on it, back to the view it came from. With
   * nothing selected there is nothing to open, and the hint says so.
   */
  const togglePage = (page: View) => {
    if (view === page && (!selected || pageAbout === selected)) setView(back);
    else if (!selected) setNudge((count) => count + 1);
    else if (page === "impact") openImpact(selected);
    else setView(page);
  };
  // The inspector's Impact tab: every relationship, any depth, for the selection.
  const selectedImpact = useMemo(
    () => impactOf(graph, selected ?? "", {}, usage),
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
      <FindingLinks dataTypes={dataTypeLinks} reviews={reviewing}>
        <section
          aria-label="Schema City"
          // Fixed over the window as well as full screen while presenting, for when
          // full screen is refused.
          className="flex h-full flex-col bg-background font-mono text-foreground data-present:fixed data-present:inset-0 data-present:z-[9999]"
          data-schema-city=""
          {...rootProps}
        >
          <Announcements
            focus={scope}
            layers={layers.map((layer) => LAYER_LABEL[layer])}
            lit={highlight?.label ?? null}
            nodesById={nodesById}
            presenting={presenting}
            selected={selected}
            view={view}
          />
          <AppHeader
            onSearch={() => openPalette(true)}
            onView={setView}
            view={view}
          >
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
              changes={changes}
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
            <Help onOpenChange={setHelpOpen} open={helpOpen} />
          </AppHeader>

          {/* A container, so the inspector sizes itself to the room the workspace has. */}
          <div className="@container relative min-h-0 flex-1">
            {/* First in the stage, so Tab reaches it before the city and Shift-Tab
              from the city comes back to it. */}
            {presenting ? (
              <PresentBar
                onLeave={() => present(false)}
                onSearch={() => openPalette(true)}
                onView={setView}
                view={view}
              />
            ) : null}
            {/* The overlays over the canvas share one layer, so presenting zooms
              them together and the canvas keeps every pointer they do not cover. */}
            <div className="pointer-events-none absolute inset-0 z-10 [zoom:var(--present,1)] *:pointer-events-auto">
              {/* The legend is an overlay in the corner of the canvas rather than a row
              above it. As a row it took its height out of the canvas the moment a
              lens was picked, and the scene dropped and re-fitted itself around the
              new viewport, which reads as the city flinching at a colour change.
              Anything else that only appears sometimes belongs over the canvas for
              the same reason. It covers its own box and nothing else, so the ground
              under it is the only pick the canvas loses. The list view colours
              nothing by lens, so it gets no legend over its first row. */}
              <LensLegend
                flat={flat}
                highlight={highlight}
                lens={lens}
                lensColours={lensColours}
                onClear={() => setHighlight(null)}
              />
              {changeLegendShown ? (
                <ComparisonLegend changes={changes} scale={scale} />
              ) : null}
            </div>
            {/* The scene and the label layer over it get a stacking context of
              their own, so the inspector sits above both on a plain z-10. */}
            {flat ? (
              // The inspector is an overlay, so the view is inset by its width while
              // it is open rather than sliding under it.
              <div
                className={`absolute inset-0 isolate pb-(--caption-space) outline-none [zoom:var(--present,1)] ${selectedNode ? panelInset : ""}`}
                data-focus-home
                tabIndex={-1}
              >
                <CompareContext value={compare}>
                  <FlatView
                    back={{ view: back, onBack: () => setView(back) }}
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
                      onAlias: (text) => setImpactAlias({ text }),
                      onShowInCity: showInCity,
                    }}
                    neighbourhoodById={neighbourhoodById}
                    nodesById={nodesById}
                    onImpact={(text, from) =>
                      openImpact(selected, { text, from })
                    }
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
                </CompareContext>
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
                    changes={changes}
                    comparison={comparison}
                    focus={focus}
                    focusDepth={focusDepth}
                    graph={graph}
                    grouping={group}
                    icons={icons}
                    // The caption card leaves the city the whole canvas, and Details
                    // is an overlay the presenter closes again.
                    inspectorOpen={panelOpen(
                      Boolean(selectedNode && neighbourhood)
                    )}
                    layers={layers}
                    onFocus={enterFocus}
                    onSelect={(id) =>
                      id === null ? putDown() : setSelected(id)
                    }
                    reframe={reframe}
                    scale={scale}
                    selected={selected}
                    textScale={textScale}
                    usage={usage}
                  />
                </Suspense>
              </div>
            )}

            <PresentationLayer
              card={{
                node: selectedNode,
                neighbourhood,
                usageReport: usage,
                focused: focus === selected,
                raised: changeLegendShown,
                docked: flat,
                onToggleFocus: toggleFocus,
                onDetails: () => setDetails(true),
                onClose: putDown,
              }}
              details={details}
              presenting={presenting}
            >
              {selectedNode && neighbourhood ? (
                <Inspector
                  canExpandFocus={canExpandFocus}
                  edges={graph.edges}
                  editorOpen={view === "editor"}
                  findings={findings.filter(
                    (finding) => finding.nodeId === selectedNode.id
                  )}
                  focusCount={focusCount}
                  focusDepth={focusDepth}
                  focused={focus === selectedNode.id}
                  icons={icons}
                  impact={selectedImpact}
                  impactOpen={
                    view === "impact" && pageAbout === selectedNode.id
                  }
                  neighbourhood={neighbourhood}
                  node={selectedNode}
                  nodesById={nodesById}
                  onClose={closeInspector(putDown)}
                  onEditor={() => togglePage("editor")}
                  onExpandFocus={() => setFocusDepth((depth) => depth + 1)}
                  onImpact={() => togglePage("impact")}
                  onOpenType={onOpenType}
                  onSelect={followLink}
                  onToggleFocus={toggleFocus}
                  usage={usage?.byType[selectedNode.id]}
                  usageReport={usage}
                />
              ) : null}
            </PresentationLayer>
            <PickFirst count={nudge} />
          </div>

          <AppFooter
            graph={graph}
            onPresent={() => present(true)}
            tools={
              view === "city"
                ? {
                    layers,
                    onLayer: (layer) => setLayers((on) => withLayer(on, layer)),
                    group,
                    // The comparison's baseline positions and a focus both stand
                    // on the city layout, so a new grouping starts from the whole
                    // city.
                    onGroup: (next) => {
                      setFocus(null);
                      setGroup(next);
                    },
                    lens,
                    onLens: (next) => {
                      setHighlight(null);
                      setLens(next);
                    },
                    lensReady: Boolean(usage),
                    onReset: resetView,
                  }
                : null
            }
            usage={usage}
            usagePending={usagePending}
          >
            {footer}
          </AppFooter>

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
      </FindingLinks>
    </LiveRegion>
  );
}
