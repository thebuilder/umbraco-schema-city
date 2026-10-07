// The comparison as a list of causes: each type with an edit of its own, a box to
// mark it planned, and a button that opens its edits and the side effects they had
// on other types. Marking causes planned and showing only the unplanned ones is how
// a review after a deployment finds the change nobody asked for.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type ChangeCause,
  type ChangeGroups,
  changeSummary,
  plannedFromAliases,
} from "../model/changes";
import type { SchemaChange } from "../model/snapshots";
import { plural, useAnnounceChange } from "./a11y";
import { DataTypeLink, TextButton } from "./InspectorChips";

/** A cause's colour role, the same the city's change layer gives its building. */
const TONE: Record<SchemaChange["status"], { border: string; text: string }> = {
  added: { border: "border-azure", text: "text-azure" },
  removed: { border: "border-signal", text: "text-signal" },
  changed: { border: "border-amber", text: "text-amber" },
};

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-0.5 text-label text-xs">
      {lines.map((text, index) => (
        // The same line can repeat for a block offered as content and as settings.
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
        <li className="break-words" key={`${index}:${text}`}>
          {text}
        </li>
      ))}
    </ul>
  );
}

/** A type's name as a link to its inspector, or plain text once it is removed. */
function TypeName({
  change,
  onSelect,
  children,
}: {
  change: SchemaChange;
  onSelect: (id: string) => void;
  children?: ReactNode;
}) {
  const id = change.currentId;
  if (!id) return <span className="text-prose">{change.name}</span>;
  return (
    <button
      className="text-left text-phosphor hover:text-phosphor-bright hover:underline"
      onClick={() => onSelect(id)}
      type="button"
    >
      {change.name}
      {children}
    </button>
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
  const { change, details, effects } = cause;
  const tone = TONE[change.status];
  const dataTypes = change.dataTypeIds ?? [];
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
      <p className="px-3 pb-2 pl-8 text-faint text-xs">
        {plural(details.length, "edit")}
        {effects.length > 0
          ? `, ${plural(effects.length, "side effect")}`
          : ", no side effects"}
        {cause.effectOf.length > 0
          ? `, and itself a side effect of ${cause.effectOf.map((root) => root.name).join(" and ")}`
          : ""}
      </p>
      {open ? (
        <div
          className="space-y-2 border-line/40 border-t bg-panel px-3 py-2 pl-8"
          id={panel}
        >
          <Lines lines={details.map((detail) => detail.text)} />
          {dataTypes.length > 0 ? (
            <p className="flex flex-wrap gap-x-2 text-label text-xs">
              Data Types now:
              {dataTypes.map((id) => (
                <DataTypeLink className="text-phosphor" id={id} key={id} />
              ))}
            </p>
          ) : null}
          {change.currentId ? (
            <TextButton onClick={() => onSelect(change.currentId as string)}>
              Inspect {change.name}
            </TextButton>
          ) : (
            <p className="text-label text-xs">
              Removed from the current schema; these lines come from the
              baseline snapshot.
            </p>
          )}
          {effects.length > 0 ? (
            <section aria-label={`Side effects of ${change.name}`}>
              <h4 className="mt-1 mb-1 font-medium text-label text-xs">
                Side effects
              </h4>
              <ul className="space-y-1.5">
                {effects.map((effect) => (
                  <li
                    className="border-line/60 border-l pl-2"
                    key={effect.change.currentId ?? effect.change.baselineId}
                  >
                    <p className="text-xs">
                      <TypeName change={effect.change} onSelect={onSelect} />
                      {effect.alsoCause ? (
                        <span className="ml-2 text-amber">also a cause</span>
                      ) : null}
                    </p>
                    <Lines
                      lines={effect.details.map((detail) => detail.text)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
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
  const [result, setResult] = useState<string | null>(null);
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
  const [pasting, setPasting] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  // Where focus was when a planned box took its cause out of the filtered list.
  const refocus = useRef<number | null>(null);

  const { causes } = changes;
  const unplanned = causes.filter((cause) => !planned.has(cause.key));
  const shown = unplannedOnly ? unplanned : causes;
  const allPlanned = unplanned.length === 0;

  useAnnounceChange(
    unplannedOnly
      ? `${shown.length} of ${plural(causes.length, "cause")} shown, unplanned only`
      : `All ${plural(causes.length, "cause")} shown`
  );

  // The box that had focus left with its cause, so focus goes to the box that
  // took its place, or to the filter when the list ran out.
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const boxes =
      list.current?.querySelectorAll<HTMLInputElement>("input[data-plan]");
    (boxes?.[Math.min(at, boxes.length - 1)] ?? filter.current)?.focus();
  });

  const mark = (keys: string[], on: boolean) => {
    const next = new Set(planned);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onPlanned(next);
  };

  if (causes.length === 0)
    return (
      <p className="border border-line bg-muted px-3 py-2 text-phosphor text-xs">
        No schema changes between these snapshots.
      </p>
    );

  return (
    <div className="space-y-3">
      <p className="text-prose">
        {changeSummary(changes)},{" "}
        <span className={allPlanned ? "" : "text-amber"}>
          {unplanned.length} unplanned
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-1.5 text-prose text-xs">
          <input
            checked={unplannedOnly}
            className="accent-phosphor"
            onChange={(event) => setUnplannedOnly(event.target.checked)}
            ref={filter}
            type="checkbox"
          />
          Show unplanned only
        </label>
        <TextButton
          onClick={() =>
            mark(
              causes.map((cause) => cause.key),
              !allPlanned
            )
          }
        >
          {allPlanned ? "Clear the plan" : "Mark all as planned"}
        </TextButton>
        <button
          aria-expanded={pasting}
          className="px-1 py-0.5 text-phosphor text-xs hover:text-phosphor-bright hover:underline"
          onClick={() => setPasting(!pasting)}
          type="button"
        >
          Paste a plan
        </button>
      </div>
      {pasting ? (
        <PastePlan changes={changes} onMark={(keys) => mark(keys, true)} />
      ) : null}
      <ul aria-label="Causes" className="space-y-2" ref={list}>
        {shown.map((cause, index) => (
          <Cause
            cause={cause}
            key={cause.key}
            onOpen={() => {
              const next = new Set(open);
              if (!next.delete(cause.key)) next.add(cause.key);
              setOpen(next);
            }}
            onPlanned={(on) => {
              if (on && unplannedOnly) refocus.current = index;
              mark([cause.key], on);
            }}
            onSelect={onSelect}
            open={open.has(cause.key)}
            planned={planned.has(cause.key)}
          />
        ))}
      </ul>
      {shown.length === 0 ? (
        <p className="text-faint text-xs">Every cause is marked as planned.</p>
      ) : null}
    </div>
  );
}
