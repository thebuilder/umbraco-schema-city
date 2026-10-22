// The Legend button and the window it opens: how to read a building and a line,
// basics first, in as few words as each mark needs. Kept out of App so the toolbar
// there only places the button.
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** What a press or a focus elsewhere sends, which leaves the window open. */
const STAYS_OPEN_ON = new Set<string>(["outside-press", "focus-out"]);

/** One edge style, drawn the way the scene draws it. */
function EdgeMark({
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

function Row({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden className="flex w-7 shrink-0 justify-center">
        {mark}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-bold text-2xs text-phosphor-bright uppercase tracking-terminal-lg">
      {children}
    </h3>
  );
}

const LIST = "mt-2 space-y-2.5 text-muted-foreground text-xs leading-snug";

/**
 * Every mark differs by shape as well as colour, so no two rows can be mistaken for
 * each other: a solid block, a glass outline, a flat board, a lit top edge, a dot.
 * The words never name a colour, since a phosphor preset can move every one of
 * them; the mark beside each row is drawn in whatever the theme makes it.
 */
function Key() {
  return (
    <div className="space-y-5">
      <section>
        <Title>Buildings</Title>
        <ul className={LIST}>
          <Row mark={<span className="size-3 bg-phosphor" />}>
            A Document Type
          </Row>
          <Row mark={<span className="h-2 w-3 bg-amber" />}>
            An Element Type, a block
          </Row>
          <Row
            mark={<span className="size-3 border border-azure bg-azure/25" />}
          >
            Glass: a composition's properties
          </Row>
          <Row mark={<span className="size-3 border-2 border-signal" />}>
            Selected
          </Row>
          <Row
            mark={
              <span className="h-2 w-6 border border-line-strong bg-panel-raised" />
            }
          >
            A board: a group of types
          </Row>
        </ul>
      </section>

      <section>
        <Title>Lines</Title>
        <ul className={LIST}>
          <Row
            mark={
              <EdgeMark
                className="text-structure"
                d="M1 6 H25 M17 2 L22 6 L17 10"
              />
            }
          >
            Can be created under
          </Row>
          <Row
            mark={<EdgeMark className="text-azure" d="M1 11 Q13 -1 25 11" />}
          >
            Composes. Paler: inherits
          </Row>
          <Row mark={<EdgeMark className="text-amber" d="M1 1 Q13 13 25 1" />}>
            Offered as a block
          </Row>
          <Row mark={<EdgeMark className="text-violet" d="M1 6 H25" dashed />}>
            Picked by a picker
          </Row>
        </ul>
        <p className="mt-2.5 text-faint text-xs leading-snug">
          Hover or select a building to light its lines.
        </p>
      </section>

      <section>
        <Title>On a building</Title>
        <ul className={LIST}>
          <Row
            mark={
              <span className="h-3 w-4 border-line border-y bg-phosphor/40" />
            }
          >
            Slab: a property group. Windows: properties
          </Row>
          <Row
            mark={
              <span className="flex h-3 w-4 items-end justify-around border-line border-b">
                <span className="h-1.5 w-px bg-phosphor" />
                <span className="h-1.5 w-px bg-phosphor" />
                <span className="h-1.5 w-px bg-phosphor" />
              </span>
            }
          >
            Pins: direct connections
          </Row>
          <Row
            mark={
              <span className="size-3 border-phosphor-bright border-t-[3px] bg-phosphor-dim" />
            }
          >
            Lit lid: has a template
          </Row>
          <Row
            mark={
              <span className="flex size-3 items-start justify-center border border-line-strong">
                <span className="mt-0.5 size-1 rounded-full bg-phosphor-bright" />
              </span>
            }
          >
            Roof dots: varies by culture, then segment
          </Row>
          <Row
            mark={<span className="h-1.5 w-6 rounded-full bg-phosphor-dim" />}
          >
            Disc: allowed at the root
          </Row>
        </ul>
        <p className="mt-2.5 text-faint text-xs leading-snug">
          Wider means more properties of its own.
        </p>
      </section>

      <section>
        <Title>On a board</Title>
        <ul className={LIST}>
          <Row mark={<span className="h-3 w-1.5 bg-[#d9b24a]/70" />}>
            Edge fingers: lines to another board
          </Row>
          <Row
            mark={
              <span className="size-2 rounded-full border-2 border-[#c8823a]/70" />
            }
          >
            Ring: a line turns a corner
          </Row>
          <Row mark={<span className="size-3 bg-phosphor-dim/40" />}>
            Patch: one block editor's Element Types
          </Row>
        </ul>
      </section>
    </div>
  );
}

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
        <div className="flex min-h-7 shrink-0 items-center justify-between border-line border-b bg-secondary px-2 py-1">
          <h2 className="font-semibold text-1xs text-phosphor-bright uppercase tracking-terminal-lg">
            Legend
          </h2>
          <PopoverPrimitive.Close
            aria-label="Close the legend"
            className="grid size-[0.9rem] place-items-center border border-line bg-panel text-phosphor-dim hover:border-line-strong hover:text-phosphor-bright"
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
          <Key />
        </div>
      </PopoverContent>
    </Popover>
  );
}
