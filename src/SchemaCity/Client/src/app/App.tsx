import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PortalContainer } from "@/portal";
import { neighbourhoods } from "../model/neighbourhood";
import { searchNodes } from "../model/search";
import type { SchemaGraph } from "../model/types";
import { Inspector } from "./Inspector";
import { DEFAULT_LAYERS, type Layer, LAYERS } from "./scene/layers";

const LAYER_LABEL: Record<Layer, string> = {
  structure: "Structure",
  compositions: "Compositions",
  blocks: "Blocks",
  references: "References",
};

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
          <LegendRow mark={<Tint className="bg-amber" />}>Element Type</LegendRow>
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

// three.js, fiber and drei are a third of the bundle, so they load with the scene
// rather than with the workspace element.
const Scene = lazy(() => import("./Scene"));

export function App({
  graph,
  onOpenType,
}: {
  graph: SchemaGraph;
  onOpenType?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layer[]>([...DEFAULT_LAYERS]);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
      if (paletteOpen || event.defaultPrevented) return;
      if (event.key === "Enter" && selected) setFocus(selected);
      // Escape leaves focus first and clears the selection second, so the way out
      // of focus mode never also loses the node you were reading.
      if (event.key === "Escape") {
        if (focus) setFocus(null);
        else setSelected(null);
      }
    };
    // Keyboard events cross the shadow boundary, so one document listener covers
    // both the backoffice and the harness.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paletteOpen, selected, focus]);

  const nodes = graph.nodes;
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const neighbourhoodById = useMemo(() => neighbourhoods(graph), [graph]);
  const hits = useMemo(() => searchNodes(nodes, query), [nodes, query]);
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
        <div className="flex items-center gap-3 border-line border-b px-4 py-2.5">
          <h1 className="font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
            Schema City
          </h1>
          <Badge>{nodes.length} types</Badge>

          <ToggleGroup
            aria-label="Relationship layers"
            className="ml-4"
            multiple
            onValueChange={(value) => setLayers(value as Layer[])}
            size="sm"
            value={layers}
          >
            {LAYERS.map((layer) => (
              <ToggleGroupItem key={layer} value={layer}>
                {LAYER_LABEL[layer]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="ml-auto flex items-center gap-2">
            <Popover>
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                Legend
              </PopoverTrigger>
              <PopoverContent className="w-80 text-sm">
                <Legend />
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger
                render={<Button onClick={() => openPalette(true)} size="sm" />}
              >
                Search
              </TooltipTrigger>
              <TooltipContent>
                Search every type <Kbd>⌘K</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="relative flex-1">
          {/* The scene and the label layer over it get a stacking context of
              their own, so the inspector sits above both on a plain z-10. */}
          <div className="absolute inset-0 z-0">
            <Suspense
              fallback={
                <p className="p-4 text-phosphor-dim text-sm">Loading the scene…</p>
              }
            >
              <Scene
                focus={focus}
                graph={graph}
                layers={layers}
                onFocus={enterFocus}
                onSelect={setSelected}
                selected={selected}
              />
            </Suspense>
          </div>

          {selectedNode && neighbourhood ? (
            <Inspector
              focused={focus === selectedNode.id}
              neighbourhood={neighbourhood}
              node={selectedNode}
              nodesById={nodesById}
              onClose={() => setSelected(null)}
              onOpenType={onOpenType}
              onSelect={followLink}
              onToggleFocus={() =>
                focus === selectedNode.id ? setFocus(null) : enterFocus(selectedNode.id)
              }
            />
          ) : null}
        </div>

        <CommandDialog onOpenChange={openPalette} open={paletteOpen}>
          {/* Afterglow's CommandDialog is the dialog only, so the cmdk root is ours.
              Filtering is ours too: cmdk scores its own item labels, which would
              miss the property aliases the rows do not print. */}
          <Command shouldFilter={false}>
            <CommandInput
              onValueChange={setQuery}
              placeholder="Find a type or a property alias…"
              value={query}
            />
            <CommandList>
              {query.trim() === "" ? null : hits.length === 0 ? (
                <CommandEmpty>No type matches.</CommandEmpty>
              ) : (
                hits.map((hit) => (
                  <CommandItem
                    key={hit.node.id}
                    onSelect={() => pick(hit.node.id)}
                    value={hit.node.id}
                  >
                    {hit.node.name}
                    <span className="ml-auto text-2xs text-phosphor-dim">
                      {hit.propertyAlias ?? hit.node.alias}
                    </span>
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
