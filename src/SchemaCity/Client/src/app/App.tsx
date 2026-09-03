import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PortalContainer } from "@/portal";
import type { SchemaGraph } from "../model/types";

// three.js, fiber and drei are a third of the bundle, so they load with the scene
// rather than with the workspace element.
const Scene = lazy(() => import("./Scene"));

/** The spike puts twelve buildings on the ground. The real layout arrives in M1. */
const BUILDINGS = 12;

export function App({
  graph,
  onOpenType,
}: {
  graph: SchemaGraph;
  onOpenType?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const portal = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey))
        return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    // Keyboard events cross the shadow boundary, so one document listener covers
    // both the backoffice and the harness.
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const nodes = graph.nodes;
  const shown = nodes.slice(0, BUILDINGS);
  const selectedNode = nodes.find((node) => node.id === selected);

  return (
    <PortalContainer value={portal}>
      <div className="flex h-full flex-col bg-background font-mono text-foreground">
        <div className="flex items-center gap-3 border-line border-b px-4 py-2.5">
          <h1 className="font-bold text-phosphor-bright text-sm uppercase tracking-terminal-lg">
            Schema City
          </h1>
          <Badge>{nodes.length} types</Badge>

          <div className="ml-auto flex items-center gap-2">
            <Dialog>
              <DialogTrigger render={<Button size="sm" variant="outline" />}>
                Types
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>First 10 types</DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-64">
                  <ol className="space-y-1 text-phosphor text-sm">
                    {nodes.slice(0, 10).map((node) => (
                      <li key={node.id}>{node.name}</li>
                    ))}
                  </ol>
                </ScrollArea>
              </DialogContent>
            </Dialog>

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
                render={<Button onClick={() => setPaletteOpen(true)} size="sm" />}
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
          <Suspense
            fallback={
              <p className="p-4 text-phosphor-dim text-sm">Loading the scene…</p>
            }
          >
            <Scene nodes={shown} onSelect={setSelected} selected={selected} />
          </Suspense>

          {selectedNode ? (
            <div className="absolute top-4 right-4 w-64 border border-line-strong bg-panel-raised p-4 text-sm shadow-panel">
              <p className="font-bold text-phosphor-bright">
                {selectedNode.name}
              </p>
              <p className="text-muted-foreground">{selectedNode.alias}</p>
              <Button
                className="mt-3 w-full"
                onClick={() => onOpenType?.(selectedNode.id)}
                size="sm"
                variant="primary"
              >
                Open
              </Button>
            </div>
          ) : null}
        </div>

        <CommandDialog onOpenChange={setPaletteOpen} open={paletteOpen}>
          {/* Afterglow's CommandDialog is the dialog only, so the cmdk root is ours. */}
          <Command>
            <CommandInput placeholder="Find a type…" />
            <CommandList>
              <CommandEmpty>No type matches.</CommandEmpty>
              {nodes.map((node) => (
                <CommandItem
                  key={node.id}
                  onSelect={() => {
                    setSelected(node.id);
                    setPaletteOpen(false);
                  }}
                  value={`${node.name} ${node.alias}`}
                >
                  {node.name}
                  <span className="ml-auto text-phosphor-dim text-2xs">
                    {node.alias}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </CommandDialog>

        <div ref={portal} />
      </div>
    </PortalContainer>
  );
}
