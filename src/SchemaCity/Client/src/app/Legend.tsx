// The Legend button and what it opens: how to read a building and a line, basics
// first, for someone who has never seen the city. Kept out of App so the toolbar
// there only places the button.
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

const LIST = "mt-2 space-y-1.5 text-muted-foreground text-xs";

/**
 * Every mark differs by shape as well as colour, so no two rows can be mistaken for
 * each other: a solid block, a glass outline, a flat board, a lit top edge, a dot.
 */
function Key() {
  return (
    <div className="space-y-4">
      <section>
        <Title>Reading the city</Title>
        <ul className={LIST}>
          <Row mark={<span className="size-3 bg-phosphor" />}>
            One building is one Document Type.
          </Row>
          <Row
            mark={
              <span className="h-2 w-6 border border-line-strong bg-panel-raised" />
            }
          >
            A board is a group of types.
          </Row>
          <Row mark={<span className="h-2 w-3 bg-amber" />}>
            Gold buildings are Element Types, the blocks editors add inside
            content.
          </Row>
          <Row
            mark={<span className="size-3 border border-azure bg-azure/25" />}
          >
            Glass slabs come from compositions, shared groups of properties.
          </Row>
          <Row mark={<span className="size-3 border-2 border-signal" />}>
            A pink outline is the type you selected.
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
            White: can be created under, in the arrow's direction.
          </Row>
          <Row
            mark={<EdgeMark className="text-azure" d="M1 11 Q13 -1 25 11" />}
          >
            Blue: composes or inherits. Inheriting is the paler blue.
          </Row>
          <Row mark={<EdgeMark className="text-amber" d="M1 1 Q13 13 25 1" />}>
            Gold: offered as a block.
          </Row>
          <Row mark={<EdgeMark className="text-violet" d="M1 6 H25" dashed />}>
            Violet, dashed: picked by a picker.
          </Row>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          Hover or select a building to light up its own lines, even on layers
          that are switched off. White lines are the rules for what can be
          created, not the content tree itself.
        </p>
      </section>

      <section>
        <Title>Boards</Title>
        <ul className={LIST}>
          <Row mark={<span className="h-2 w-5 border border-phosphor-dim" />}>
            A thin outline frames each type and its printed name.
          </Row>
          <Row mark={<span className="h-3 w-1.5 bg-[#d9b24a]/70" />}>
            Gold fingers on a board's edge are lines leaving for another board,
            one finger per line.
          </Row>
          <Row
            mark={
              <span className="size-2 rounded-full border-2 border-[#c8823a]/70" />
            }
          >
            A small ring marks where a line turns a corner.
          </Row>
          <Row mark={<span className="size-3 bg-phosphor-dim/40" />}>
            A lighter patch holds the Element Types one block editor offers.
          </Row>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          Group: Structure gives each root, and everything editors can create
          under it, its own board, with each parent beside its children. Boards
          for compositions, Element Types and types no root reaches sit next to
          them. Group: Folders follows the Document Type folders instead. Names
          are printed where they fit; the full name is in the inspector.
        </p>
      </section>

      <section>
        <Title>Details</Title>
        <ul className={LIST}>
          <Row
            mark={
              <span className="h-3 w-4 border-line border-y bg-phosphor/40" />
            }
          >
            Each slab is one property group; a thin board between slabs is where
            a new tab starts. Lit windows are properties.
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
            Pins along the base count direct connections, one side each for
            allowed parents, allowed children, links out and links in.
          </Row>
          <Row
            mark={
              <span className="size-3 border-phosphor-bright border-t-[3px] bg-phosphor-dim" />
            }
          >
            A lit lid means the type has a template.
          </Row>
          <Row
            mark={
              <span className="flex size-3 items-start justify-center border border-line-strong">
                <span className="mt-0.5 size-1 rounded-full bg-phosphor-bright" />
              </span>
            }
          >
            A dot on the roof: it varies by culture. A second dot: by segment.
          </Row>
          <Row
            mark={<span className="h-1.5 w-6 rounded-full bg-phosphor-dim" />}
          >
            A flat disc under a building marks a type allowed at the root.
          </Row>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          A wider building has more properties of its own. Height is not a
          complexity score. A lens recolours every building by what it measures,
          gold ones included.
        </p>
      </section>
    </div>
  );
}

/**
 * The toolbar's Legend button. The panel scrolls inside a capped height and closes
 * with its own button or Escape, so it never has to cover the city to be read.
 */
export function Legend() {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button data-trigger size="sm" variant="outline" />}
      >
        Legend
      </PopoverTrigger>
      <PopoverContent
        aria-label="Legend"
        className="relative max-h-[min(32rem,calc(100vh-8rem))] w-80 overflow-y-auto p-0 text-sm"
      >
        <PopoverPrimitive.Close
          aria-label="Close the legend"
          className="absolute top-2 right-2 text-phosphor-dim hover:text-phosphor-bright"
        >
          <XIcon className="size-4" />
        </PopoverPrimitive.Close>
        {/* Focusable because it scrolls once the window is short. */}
        <div
          className="p-4 pr-8 focus-visible:outline-offset-[-4px]"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable pane has to be reachable by keyboard.
          tabIndex={0}
        >
          <Key />
        </div>
      </PopoverContent>
    </Popover>
  );
}
