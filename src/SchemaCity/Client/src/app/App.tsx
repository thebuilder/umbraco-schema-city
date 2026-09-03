import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
      if (paletteOpen) return;
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

          <div className="ml-auto flex items-center gap-2">
            <Popover>
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                Legend
              </PopoverTrigger>
              <PopoverContent className="text-sm">
                <p className="text-phosphor-bright">Building height</p>
                <p className="text-muted-foreground">
                  One floor per property, own and composed together.
                </p>
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
          {/* drei's Html labels carry a z-index near 2^24, so the scene gets a
              stacking context of its own and the inspector sits above it on a
              plain z-10 instead of having to outbid that number. */}
          <div className="absolute inset-0 z-0">
            <Suspense
              fallback={
                <p className="p-4 text-phosphor-dim text-sm">Loading the scene…</p>
              }
            >
              <Scene
                focus={focus}
                graph={graph}
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
