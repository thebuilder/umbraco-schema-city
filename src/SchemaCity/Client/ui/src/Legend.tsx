// The Legend button and the window it opens. What the window says comes from the
// stage's copy, since only the stage knows what its marks look like; the rows and
// titles here are what each stage writes its key with.
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useStageCopy } from "./stage";

/** What a press or a focus elsewhere sends, which leaves the window open. */
const STAYS_OPEN_ON = new Set<string>(["outside-press", "focus-out"]);

/** One edge style, drawn the way the scene draws it. */
export function EdgeMark({
  className,
  d,
  dashed = false,
}: {
  className: string;
  d: string;
  dashed?: boolean;
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
        strokeWidth={1.5}
      />
    </svg>
  );
}

export function LegendRow({
  mark,
  children,
}: {
  mark: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden className="flex w-7 shrink-0 justify-center">
        {mark}
      </span>
      <span>{children}</span>
    </li>
  );
}

export function LegendTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-bold text-2xs text-phosphor-bright uppercase tracking-terminal-lg">
      {children}
    </h3>
  );
}

export const LEGEND_LIST =
  "mt-2 space-y-2.5 text-muted-foreground text-xs leading-snug";

/**
 * The toolbar's Legend button and the window it opens. The window stays open while
 * you work the city, since a key is read alongside what it explains, and closes
 * only with its own button, the Legend button again, or Escape.
 */
export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      onOpenChange={(next, { reason }) => {
        if (next || !STAYS_OPEN_ON.has(reason)) setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger
        render={<Button data-trigger size="sm" variant="outline" />}
      >
        Legend
      </PopoverTrigger>
      <PopoverContent
        aria-label="Legend"
        className="flex max-h-[min(30rem,calc(100vh-8rem))] w-80 flex-col p-0"
        initialFocus={false}
      >
        <div
          className="flex min-h-7 shrink-0 items-center justify-between border-line border-b bg-secondary px-2 py-1"
          data-ui="window-head"
        >
          <h2 className="font-semibold text-1xs text-phosphor-bright uppercase tracking-terminal-lg">
            Legend
          </h2>
          <PopoverPrimitive.Close
            aria-label="Close the legend"
            // The square is drawn at the window's scale; the ::after reaches 24px so
            // the target is big enough to hit.
            className="relative grid size-[0.9rem] place-items-center border border-line bg-panel text-phosphor-dim after:absolute after:-inset-1.5 hover:border-line-strong hover:text-phosphor-bright"
          >
            <XIcon className="size-2.5" />
          </PopoverPrimitive.Close>
        </div>
        {/* Focusable because it scrolls once the window is short. */}
        <div
          className="min-h-0 overflow-y-auto p-3 focus-visible:outline-offset-[-4px]"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable pane has to be reachable by keyboard.
          tabIndex={0}
        >
          {useStageCopy().legend}
        </div>
      </PopoverContent>
    </Popover>
  );
}
