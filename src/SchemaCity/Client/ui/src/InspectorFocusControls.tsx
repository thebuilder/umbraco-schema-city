import { Button } from "@/components/ui/button";

export function InspectorFocusControls({
  className,
  focused,
  onToggleFocus,
}: {
  className?: string;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  return (
    <Button
      aria-pressed={focused}
      className={className}
      onClick={onToggleFocus}
      size="sm"
      // Selected, not alarming: pink in the panel is kept for problems.
      variant={focused ? "default" : "outline"}
    >
      {focused ? "Leave focus" : "Focus"}
    </Button>
  );
}

export function FocusExpansionRow({
  buttonClassName,
  count,
  depth,
  onExpand,
  canExpand,
}: {
  buttonClassName?: string;
  count: number;
  depth: number;
  onExpand: () => void;
  canExpand: boolean;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <p className="text-label text-xs">
        Focus shows <span className="font-mono">{count}</span> types, up to{" "}
        <span className="font-mono">{depth}</span>{" "}
        {depth === 1 ? "step" : "steps"} away
      </p>
      <Button
        className={buttonClassName}
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
