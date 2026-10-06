import { type ReactNode, useState } from "react";
import type { Chip, Trace } from "../model/inspector";

/** The swatch beside a heading, in the colour the city draws that kind of link. */
const TRACE_SWATCH: Record<Trace, string> = {
  structure: "bg-structure",
  compositions: "bg-azure",
  blocks: "bg-amber",
  references: "bg-violet",
};

export function Heading({
  children,
  count,
  trace,
}: {
  children: ReactNode;
  count?: number;
  trace?: Trace;
}) {
  return (
    <h3 className="mb-2 flex items-center gap-2 font-semibold text-label text-xs">
      {trace ? (
        <span
          aria-hidden
          className={`size-2 shrink-0 ${TRACE_SWATCH[trace]}`}
        />
      ) : null}
      {children}
      {count === undefined ? null : (
        <span className="font-mono font-normal text-2xs text-faint">
          {count.toLocaleString()}
        </span>
      )}
    </h3>
  );
}

/** A plain-text button in the one colour the panel keeps for things to click. */
export function TextButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="px-1 py-0.5 text-phosphor text-xs hover:text-phosphor-bright hover:underline"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Types as chips, the first `limit` of them, with the rest behind "+ N more". The
 * count is content items for a type list and references for observed references,
 * whichever the caller passes.
 */
export function TypeChips({
  chips,
  limit,
  onSelect,
}: {
  chips: Chip[];
  limit: number;
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? chips : chips.slice(0, limit);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((chip) =>
        chip.name === null ? (
          // A block editor still names an Element Type key that has been deleted.
          // The backend reports it rather than dropping the edge, so the panel does too.
          <span
            className="border border-signal/50 px-1.5 py-0.5 text-signal text-xs"
            key={chip.id}
            title={chip.id}
          >
            missing type
          </span>
        ) : (
          <button
            className="inline-flex min-w-0 max-w-full items-baseline gap-1 border border-line bg-muted px-1.5 py-0.5 text-prose text-xs hover:border-phosphor hover:text-phosphor"
            key={chip.id}
            onClick={() => onSelect(chip.id)}
            type="button"
          >
            <span className="truncate">{chip.name}</span>
            {chip.count === undefined ? null : (
              <span className="font-mono text-2xs text-faint">
                {chip.count.toLocaleString()}
              </span>
            )}
          </button>
        )
      )}
      {chips.length > limit ? (
        <TextButton onClick={() => setAll(!all)}>
          {all ? "show fewer" : `+ ${chips.length - limit} more`}
        </TextButton>
      ) : null}
    </div>
  );
}
