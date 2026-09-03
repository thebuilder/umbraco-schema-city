import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

type Row = { keys: string[]; does: string };

/**
 * Every binding the city has, printed by the city. The toolbar prints the one
 * shortcut a first-time reader needs, Search, and the button that opens this page is
 * drawn as the key that opens it. The rest live here rather than competing with the
 * view.
 */
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Mouse",
    rows: [
      { keys: ["Drag"], does: "Orbit around the centre of the view" },
      { keys: ["Right-drag"], does: "Pan the view" },
      { keys: ["Scroll"], does: "Zoom in and out" },
      {
        keys: ["Click"],
        does: "Select a building, or clear the selection by clicking bare ground",
      },
      { keys: ["Double click"], does: "Focus a building" },
    ],
  },
  {
    title: "Keys",
    rows: [
      { keys: ["Enter"], does: "Focus the selected building" },
      { keys: ["Esc"], does: "Leave focus, then clear the selection" },
      { keys: ["⌘K", "Ctrl K"], does: "Search types and property aliases" },
      {
        keys: ["1", "2", "3", "4"],
        does: "Toggle Structure, Compositions, Blocks, References",
      },
      { keys: ["L"], does: "List view" },
      { keys: ["E"], does: "Explore camera" },
      { keys: ["Home"], does: "Reframe the city" },
      { keys: ["?"], does: "Show this page" },
    ],
  },
  {
    title: "Objects",
    rows: [
      {
        keys: ["Focus"],
        does: "The inspector's Focus button lays the neighbourhood out around a type",
      },
      { keys: ["Open in editor"], does: "Opens the Document Type editor" },
      { keys: ["Findings"], does: "Opens the drawer of problems and notes" },
      { keys: ["Lens"], does: "Recolours the city by usage" },
    ],
  },
];

/**
 * The control reference, and the toolbar button that opens it. Controlled, because
 * `?` opens it from the app's keyboard handler as well as this button.
 *
 * No tooltip on the button, for the reason the Search button has none: a tooltip's
 * exit animation plays over the dialog opening.
 */
export function Help({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* An icon button, because the backoffice toolbar is narrow and a word plus a
          key costs four times the width of the glyph. The ? is both the label and
          the key that opens the same dialog. */}
      <DialogTrigger
        aria-label="Control reference"
        render={<Button className="text-xs" size="icon-sm" variant="outline" />}
      >
        ?
      </DialogTrigger>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl" showCloseButton={false}>
        <div className="flex items-center justify-between gap-4 border-line border-b px-4 py-3">
          <DialogTitle className="text-sm uppercase tracking-terminal-lg">
            Schema City · Control reference
          </DialogTitle>
          {/* The key that closes it, drawn as the key it is. The Kbd inside takes no
              pointer events, so the click lands on the button around it. */}
          <DialogClose
            aria-label="Close the control reference"
            className="shrink-0 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor-bright"
          >
            <Kbd>ESC</Kbd>
          </DialogClose>
        </div>

        {/* Focusable because it scrolls: a pane a mouse can reach a keyboard must
            too. Borrowed from fsn's help screen, along with the group rules. */}
        <div
          className="max-h-[60vh] overflow-y-auto bg-panel-sunken px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-phosphor-bright"
          tabIndex={0}
        >
          {GROUPS.map((group) => (
            <section className="mt-5 first:mt-0" key={group.title}>
              <h3 className="mb-1.5 font-bold text-3xs text-phosphor uppercase tracking-terminal-xl">
                <span aria-hidden className="text-phosphor-dim">
                  ──{" "}
                </span>
                {group.title}
              </h3>
              <dl className="grid grid-cols-1 gap-x-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                {group.rows.map((row) => (
                  <Fragment key={row.does}>
                    {/* The keys wrap as a group rather than stretching the column:
                        four of them are still one binding. */}
                    <dt className="flex flex-wrap items-start gap-1 pt-1.5">
                      {row.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </dt>
                    <dd className="pb-1.5 text-muted-foreground text-xs leading-relaxed sm:pt-1.5">
                      {row.does}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
