import { Button } from "@/components/ui/button";

export function InspectorFocusControls({
  focused,
  onToggleFocus,
}: {
  focused: boolean;
  onToggleFocus: () => void;
}) {
  return (
    <Button
      onClick={onToggleFocus}
      size="sm"
      variant={focused ? "signal" : "outline"}
    >
      {focused ? "Leave focus" : "Focus"}
    </Button>
  );
}

export function FocusExpansionRow({
  count,
  depth,
  onExpand,
  canExpand,
}: {
  count: number;
  depth: number;
  onExpand: () => void;
  canExpand: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-line border-b px-3 py-1">
      <p className="text-3xs text-phosphor-dim">
        {count} types · up to {depth} {depth === 1 ? "step" : "steps"}
      </p>
      <Button
        disabled={!canExpand}
        onClick={onExpand}
        size="sm"
        title="Show one more relationship step"
        variant="outline"
      >
        Expand one step
      </Button>
    </div>
  );
}
