import { Badge } from "@/components/ui/badge";
import type { SchemaChange, SchemaComparison } from "../model/snapshots";

function ChangeRow({
  change,
  onSelect,
}: {
  change: SchemaChange;
  onSelect: (id: string) => void;
}) {
  return (
    <details className="border-line border-b bg-panel-sunken px-2 py-1.5 last:border-b">
      <summary className="cursor-pointer text-phosphor text-xs">
        <span className="ml-1">{change.name}</span>
        <span className="ml-2 text-3xs text-phosphor-dim">{change.alias}</span>
      </summary>
      <div className="mt-1 pl-4 text-3xs text-phosphor-dim">
        {change.details.map((detail) => (
          <p key={detail}>{detail}</p>
        ))}
        {change.currentId ? (
          <button
            className="mt-1 text-phosphor underline-offset-2 hover:text-phosphor-bright hover:underline"
            onClick={() => onSelect(change.currentId as string)}
            type="button"
          >
            Inspect current type
          </button>
        ) : (
          <p className="mt-1 text-amber">
            Removed from the current schema; details are from the baseline
            snapshot.
          </p>
        )}
      </div>
    </details>
  );
}

export function ComparisonResults({
  comparison,
  onSelect,
}: {
  comparison: SchemaComparison;
  onSelect: (id: string) => void;
}) {
  const statuses = ["added", "removed", "changed"] as const;
  const total =
    comparison.added.length +
    comparison.removed.length +
    comparison.changed.length;
  if (total === 0)
    return (
      <p className="border border-line bg-panel-sunken px-2 py-2 text-phosphor text-xs">
        No schema changes between these snapshots.
      </p>
    );
  return (
    <>
      {statuses.map((status) => {
        const changes = comparison[status];
        return (
          <section key={status}>
            <h3 className="mb-1 flex items-center gap-2 font-bold text-3xs text-phosphor-dim uppercase tracking-terminal-xl">
              <span>{status}</span>
              <Badge
                variant={
                  status === "changed"
                    ? "outline"
                    : status === "added"
                      ? "azure"
                      : "signal"
                }
              >
                {changes.length}
              </Badge>
            </h3>
            {changes.length === 0 ? (
              <p className="px-2 text-3xs text-phosphor-dim">None</p>
            ) : (
              changes.map((change) => (
                <ChangeRow
                  change={change}
                  key={`${status}:${change.currentId ?? change.baselineId}`}
                  onSelect={onSelect}
                />
              ))
            )}
          </section>
        );
      })}
    </>
  );
}
