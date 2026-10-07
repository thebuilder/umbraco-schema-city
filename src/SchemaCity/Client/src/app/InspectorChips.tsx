import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { FindingSeverity } from "../model/findings";
import type { Chip, Role, Trace } from "../model/inspector";
import type { SchemaNode } from "../model/types";
import { plural } from "./a11y";

/** The app's mono, uppercase controls, set in the panel's reading type instead. */
export const READING = "font-sans font-medium normal-case tracking-normal";

export const ROLE: Record<
  Role,
  { label: string; colour: string; badge: "default" | "azure" | "amber" }
> = {
  page: { label: "Page", colour: "var(--phosphor)", badge: "default" },
  composition: {
    label: "Composition",
    colour: "var(--azure)",
    badge: "azure",
  },
  element: { label: "Element Type", colour: "var(--amber)", badge: "amber" },
};

/**
 * The role as a colour key: the swatch in the colour the city paints that role,
 * quiet enough to sit on every row of a list where a badge would shout.
 */
export function RoleKey({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-label text-xs">
      <span
        aria-hidden
        className="size-2 shrink-0"
        style={{ background: ROLE[role].colour }}
      />
      {ROLE[role].label}
    </span>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge className={READING} variant={ROLE[role].badge}>
      {ROLE[role].label}
    </Badge>
  );
}

/** The role badge, then Root and culture variance when the type has them. */
export function RoleBadges({ node, role }: { node: SchemaNode; role: Role }) {
  return (
    <>
      <RoleBadge role={role} />
      {node.allowedAsRoot ? (
        <Badge className={READING} variant="outline">
          Root
        </Badge>
      ) : null}
      {node.variesByCulture ? (
        <Badge className={READING} variant="outline">
          Varies by culture
        </Badge>
      ) : null}
    </>
  );
}

/**
 * A dot beside a name that a check flagged: pink for a problem, grey for a note.
 * The title names the checks, so a list row says why without opening the type.
 */
export function FindingDot({
  severity = "problem",
  title,
}: {
  severity?: FindingSeverity;
  title: string;
}) {
  return (
    <span
      aria-label={title}
      className={`inline-block size-1.5 shrink-0 rounded-full ${severity === "problem" ? "bg-signal" : "bg-label"}`}
      role="img"
      title={title}
    />
  );
}

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
 * One tab of a tablist that uses `roving` for its arrow keys: only the chosen tab
 * is a tab stop, and every tab names the one panel it controls.
 */
export function TabButton({
  children,
  className,
  id,
  onPick,
  panel,
  selected,
}: {
  children: ReactNode;
  className: string;
  id: string;
  onPick: () => void;
  panel: string;
  selected: boolean;
}) {
  return (
    <button
      aria-controls={panel}
      aria-selected={selected}
      className={`-mb-px flex items-center gap-1.5 border-b-2 ${className} ${
        selected
          ? "border-phosphor text-prose"
          : "border-transparent text-label hover:text-prose"
      }`}
      id={id}
      onClick={onPick}
      role="tab"
      tabIndex={selected ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * A count read as part of its control's name: "Properties, 26 properties". One that
 * stands for a problem adds a "!" so it differs from a note without its colour.
 * `tone` replaces the faint grey and the pink on a pressed or selected background,
 * where neither reaches 4.5:1.
 */
export function SpokenCount({
  count,
  spoken,
  problem = false,
  tone,
}: {
  count: number;
  spoken: string;
  problem?: boolean;
  tone?: string;
}) {
  if (count === 0) return null;
  return (
    <>
      <span className="sr-only">, {spoken}</span>
      <span
        aria-hidden
        className={`font-mono text-2xs ${tone ?? "text-faint"}`}
      >
        {count.toLocaleString()}
        {problem ? (
          <span className={`font-bold ${tone ?? "text-signal"}`}>!</span>
        ) : null}
      </span>
    </>
  );
}

/**
 * Types as chips, the first `limit` of them, with the rest behind "+ N more". The
 * count is content items for a type list and references for observed references,
 * whichever the caller passes as `unit`, which also names the number for a screen
 * reader and on hover.
 */
export function TypeChips({
  chips,
  limit,
  onSelect,
  unit = ["content item", "content items"],
}: {
  chips: Chip[];
  limit: number;
  onSelect: (id: string) => void;
  unit?: [string, string];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? chips : chips.slice(0, limit);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((chip) => {
        // A block editor still names an Element Type key that has been deleted.
        // The backend reports it rather than dropping the edge, so the panel does
        // too, with the key written out since it is all there is to search for.
        if (chip.name === null)
          return (
            <span
              className="border border-signal/50 px-1.5 py-0.5 text-signal text-xs"
              key={chip.id}
            >
              missing type{" "}
              <span className="break-all font-mono text-2xs">{chip.id}</span>
            </span>
          );
        const counted =
          chip.count === undefined
            ? undefined
            : `${chip.name}, ${plural(chip.count, ...unit)}`;
        return (
          <button
            aria-label={counted}
            className="inline-flex min-w-0 max-w-full items-baseline gap-1 border border-line bg-muted px-1.5 py-0.5 text-prose text-xs hover:border-phosphor hover:text-phosphor"
            key={chip.id}
            onClick={() => onSelect(chip.id)}
            title={counted}
            type="button"
          >
            <span className="truncate">{chip.name}</span>
            {chip.through ? (
              <span className="text-2xs text-faint">
                through {chip.through}
              </span>
            ) : null}
            {chip.count === undefined ? null : (
              <span className="font-mono text-2xs text-faint">
                {chip.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
      {chips.length > limit ? (
        <TextButton onClick={() => setAll(!all)}>
          {all ? "show fewer" : `+ ${chips.length - limit} more`}
        </TextButton>
      ) : null}
    </div>
  );
}
