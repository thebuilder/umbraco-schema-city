// The comparison as a list of causes: each type with an edit of its own, a box to
// mark it planned, and a button that opens its edits and the side effects they had
// on other types. Marking causes planned and showing only the unplanned ones is how
// a review after a deployment finds the change nobody asked for.
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type ChangeCause,
  type ChangeEffect,
  type ChangeGroups,
  causeLine,
  changeSummary,
  plannedFromAliases,
} from "../model/changes";
import type { ChangeDetail, SchemaChange } from "../model/snapshots";
import { plural, useAnnounceChange } from "./a11y";
import { DataTypeLink, TextButton } from "./InspectorChips";

/** A cause's colour role, the same the city's change layer gives its building. */
const TONE: Record<SchemaChange["status"], { border: string; text: string }> = {
  added: { border: "border-azure", text: "text-azure" },
  removed: { border: "border-signal", text: "text-signal" },
  changed: { border: "border-amber", text: "text-amber" },
};

const LINK =
  "px-1 py-0.5 text-phosphor text-xs hover:text-phosphor-bright hover:underline";

function Lines({ details }: { details: ChangeDetail[] }) {
  return (
    <ul className="space-y-0.5 text-label text-xs">
      {details.map((detail, index) => (
        // The same line can repeat for a block offered as content and as settings.
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
        <li className="break-words" key={`${index}:${detail.text}`}>
          {detail.text}
        </li>
      ))}
    </ul>
  );
}

/** One type a cause changed, with a link to it while it still exists. */
function Effect({
  effect,
  onSelect,
}: {
  effect: ChangeEffect;
  onSelect: (id: string) => void;
}) {
  const { change } = effect;
  const id = change.currentId;
  return (
    <li className="border-line/60 border-l pl-2">
      <p className="text-xs">
        {id ? (
          <button
            className="text-left text-phosphor hover:text-phosphor-bright hover:underline"
            onClick={() => onSelect(id)}
            type="button"
          >
            {change.name}
          </button>
        ) : (
          <span className="text-prose">{change.name}</span>
        )}
        {effect.alsoCause ? (
          <span className="ml-2 text-amber">also a cause</span>
        ) : null}
      </p>
      <Lines details={effect.details} />
    </li>
  );
}

/** The Data Types a cause's properties moved onto, and the way to the type. */
function OwnLinks({
  change,
  onSelect,
}: {
  change: SchemaChange;
  onSelect: (id: string) => void;
}) {
  const id = change.currentId;
  return (
    <>
      {change.dataTypeIds ? (
        <p className="flex flex-wrap gap-x-2 text-label text-xs">
          Data Types now:
          {change.dataTypeIds.map((dataType) => (
            <DataTypeLink
              className="text-phosphor"
              id={dataType}
              key={dataType}
            />
          ))}
        </p>
      ) : null}
      {id ? (
        <TextButton onClick={() => onSelect(id)}>
          Inspect {change.name}
        </TextButton>
      ) : (
        <p className="text-label text-xs">
          Removed from the current schema; these lines come from the baseline
          snapshot.
        </p>
      )}
    </>
  );
}

/** What an open cause shows: its own edits, then its side effects. */
function CausePanel({
  cause,
  id,
  onSelect,
}: {
  cause: ChangeCause;
  id: string;
  onSelect: (id: string) => void;
}) {
  const { change, effects } = cause;
  return (
    <div
      className="space-y-2 border-line/40 border-t bg-panel px-3 py-2 pl-8"
      id={id}
    >
      <Lines details={cause.details} />
      <OwnLinks change={change} onSelect={onSelect} />
      {effects.length > 0 ? (
        <section aria-label={`Side effects of ${change.name}`}>
          <h4 className="mt-1 mb-1 font-medium text-label text-xs">
            Side effects
          </h4>
          <ul className="space-y-1.5">
            {effects.map((effect) => (
              <Effect
                effect={effect}
                key={effect.change.currentId ?? effect.change.baselineId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Cause({
  cause,
  planned,
  open,
  onPlanned,
  onOpen,
  onSelect,
}: {
  cause: ChangeCause;
  planned: boolean;
  open: boolean;
  onPlanned: (planned: boolean) => void;
  onOpen: () => void;
  onSelect: (id: string) => void;
}) {
  const panel = useId();
  const { change } = cause;
  const tone = TONE[change.status];
  return (
    <li className={`border-l-2 bg-muted ${tone.border}`}>
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1">
        <button
          aria-controls={panel}
          aria-expanded={open}
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left"
          onClick={onOpen}
          type="button"
        >
          <span aria-hidden className="w-3 shrink-0 text-faint">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-semibold text-prose">{change.name}</span>
          <span className="font-mono text-2xs text-faint">{change.alias}</span>
          <span className={`text-xs ${tone.text}`}>{change.status}</span>
        </button>
        <label className="flex shrink-0 items-center gap-1.5 text-label text-xs">
          <input
            checked={planned}
            className="accent-phosphor"
            data-plan
            onChange={(event) => onPlanned(event.target.checked)}
            type="checkbox"
          />
          Planned<span className="sr-only">: {change.name}</span>
        </label>
      </div>
      <p className="px-3 pb-2 pl-8 text-faint text-xs">{causeLine(cause)}</p>
      {open ? (
        <CausePanel cause={cause} id={panel} onSelect={onSelect} />
      ) : null}
    </li>
  );
}

/** Mark causes planned from a pasted list of type aliases. */
function PastePlan({
  changes,
  onMark,
}: {
  changes: ChangeGroups;
  onMark: (keys: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const keys = plannedFromAliases(changes, text);
        onMark(keys);
        setResult(`${plural(keys.length, "cause")} marked as planned.`);
      }}
    >
      <label className="block text-label text-xs" htmlFor={id}>
        Type aliases from the plan, separated by commas or new lines
      </label>
      <textarea
        className="block h-16 w-full border border-line bg-secondary px-2 py-1 font-mono text-prose text-xs focus-visible:border-phosphor"
        id={id}
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" variant="outline">
          Mark as planned
        </Button>
        <p className="text-label text-xs" role="status">
          {result}
        </p>
      </div>
    </form>
  );
}

/**
 * Where focus goes when a Planned box takes its own cause out of the filtered
 * list: to the box that took its place, or to the filter once the list ran out.
 * `after(index)` is called with the box's place just before it goes.
 */
function useRefocus(
  list: RefObject<HTMLUListElement | null>,
  fallback: RefObject<HTMLInputElement | null>
) {
  const at = useRef<number | null>(null);
  useEffect(() => {
    if (at.current === null) return;
    const boxes =
      list.current?.querySelectorAll<HTMLInputElement>("input[data-plan]") ??
      [];
    (
      boxes[Math.min(at.current, boxes.length - 1)] ?? fallback.current
    )?.focus();
    at.current = null;
  });
  return (index: number) => {
    at.current = index;
  };
}

/** Show unplanned only, Mark all as planned, and the way to paste a plan. */
function PlanControls({
  changes,
  allPlanned,
  unplannedOnly,
  filter,
  onUnplannedOnly,
  onMark,
}: {
  changes: ChangeGroups;
  allPlanned: boolean;
  unplannedOnly: boolean;
  filter: RefObject<HTMLInputElement | null>;
  onUnplannedOnly: (on: boolean) => void;
  onMark: (keys: string[], on: boolean) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const every = changes.causes.map((cause) => cause.key);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-1.5 text-prose text-xs">
          <input
            checked={unplannedOnly}
            className="accent-phosphor"
            onChange={(event) => onUnplannedOnly(event.target.checked)}
            ref={filter}
            type="checkbox"
          />
          Show unplanned only
        </label>
        <TextButton onClick={() => onMark(every, !allPlanned)}>
          {allPlanned ? "Clear the plan" : "Mark all as planned"}
        </TextButton>
        <button
          aria-expanded={pasting}
          className={LINK}
          onClick={() => setPasting(!pasting)}
          type="button"
        >
          Paste a plan
        </button>
      </div>
      {pasting ? (
        <PastePlan changes={changes} onMark={(keys) => onMark(keys, true)} />
      ) : null}
    </>
  );
}

/** The totals, and what the filter leaves, said aloud whenever it changes. */
function Summary({
  changes,
  unplanned,
  unplannedOnly,
}: {
  changes: ChangeGroups;
  unplanned: number;
  unplannedOnly: boolean;
}) {
  const total = changes.causes.length;
  useAnnounceChange(
    unplannedOnly
      ? `${unplanned} of ${plural(total, "cause")} shown, unplanned only`
      : `All ${plural(total, "cause")} shown`
  );
  return (
    <p className="text-prose">
      {changeSummary(changes)},{" "}
      <span className={unplanned > 0 ? "text-amber" : ""}>
        {unplanned} unplanned
      </span>
    </p>
  );
}

const toggled = (set: ReadonlySet<string>, key: string, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
};

export function ComparisonResults({
  changes,
  planned,
  onPlanned,
  onSelect,
}: {
  changes: ChangeGroups;
  planned: ReadonlySet<string>;
  onPlanned: (planned: ReadonlySet<string>) => void;
  onSelect: (id: string) => void;
}) {
  const [unplannedOnly, setUnplannedOnly] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLUListElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const refocus = useRefocus(list, filter);

  const { causes } = changes;
  const unplanned = causes.filter((cause) => !planned.has(cause.key));
  const shown = unplannedOnly ? unplanned : causes;

  const mark = (keys: string[], on: boolean) =>
    onPlanned(keys.reduce((set, key) => toggled(set, key, on), planned));

  return (
    <div className="space-y-3">
      <Summary
        changes={changes}
        unplanned={unplanned.length}
        unplannedOnly={unplannedOnly}
      />
      <PlanControls
        allPlanned={unplanned.length === 0}
        changes={changes}
        filter={filter}
        onMark={mark}
        onUnplannedOnly={setUnplannedOnly}
        unplannedOnly={unplannedOnly}
      />
      <ul aria-label="Causes" className="space-y-2" ref={list}>
        {shown.map((cause, index) => (
          <Cause
            cause={cause}
            key={cause.key}
            onOpen={() =>
              setOpen(toggled(open, cause.key, !open.has(cause.key)))
            }
            onPlanned={(on) => {
              if (unplannedOnly) refocus(index);
              mark([cause.key], on);
            }}
            onSelect={onSelect}
            open={open.has(cause.key)}
            planned={planned.has(cause.key)}
          />
        ))}
      </ul>
      <p className="text-faint text-xs empty:hidden">
        {shown.length === 0 ? "Every cause is marked as planned." : ""}
      </p>
    </div>
  );
}
