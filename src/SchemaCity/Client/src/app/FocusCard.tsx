import { Button } from "@/components/ui/button";
import type { SchemaNode } from "../model/types";

/**
 * The type the focus card names: the focused one, once nothing is selected. A 2D view
 * says the same with its own Show all line, so it gets no card.
 */
export function focusCardNode(
  focus: string | null,
  selected: string | null,
  flat: boolean,
  nodesById: ReadonlyMap<string, SchemaNode>
): SchemaNode | undefined {
  if (focus === null || selected !== null || flat) return;
  return nodesById.get(focus);
}

/**
 * What stays on screen of a focus once its type is put down. Closing the inspector or
 * clicking bare ground clears the selection and keeps the focus, which left the
 * neighbourhood standing with nothing that said whose it was or how to leave it. The
 * name selects the type again; Leave focus goes back to the whole city.
 */
export function FocusCard({
  node,
  onSelect,
  onFocus,
}: {
  node: SchemaNode | undefined;
  onSelect: (id: string) => void;
  /** Sets the focus, which Leave focus clears. */
  onFocus: (id: string | null) => void;
}) {
  if (!node) return null;
  return (
    <aside
      aria-label="Focus"
      className="absolute top-3 right-3 flex items-center gap-3 border border-line-strong bg-panel py-2 pr-2 pl-3 font-sans text-sm shadow-panel"
    >
      <div className="min-w-0">
        <p className="text-label text-xs">Focused on</p>
        <button
          className="block max-w-full truncate font-semibold text-foreground hover:text-phosphor-bright hover:underline"
          onClick={() => onSelect(node.id)}
          type="button"
        >
          {node.name}
        </button>
      </div>
      <Button onClick={() => onFocus(null)} size="sm" variant="outline">
        Leave focus
      </Button>
    </aside>
  );
}
