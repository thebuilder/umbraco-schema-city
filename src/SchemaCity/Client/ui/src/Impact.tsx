// The impact trace: what a change to one type reaches, as a summary in the inspector
// and as a full page with its controls, the property alias check and the exports.

import {
  type AliasImpact,
  aliasImpact,
  type Direction,
  type GroupKey,
  type Impact,
  type ImpactRow,
  impactCsv,
  impactMarkdown,
  impactOf,
  pathWords,
  RELATION_LABEL,
  RELATIONS,
  type Relation,
  storedLine,
  TEMPLATES_LABEL,
  totalsLine,
} from "@schema-city/core/model/impact";
import type { Trace } from "@schema-city/core/model/inspector";
import type {
  SchemaGraph,
  SchemaNode,
  UsageReport,
} from "@schema-city/core/model/types";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import {
  plural,
  roving,
  SEARCH_KEY,
  useAnnounceChange,
  usePanelFocus,
} from "./a11y";
import { Heading, READING, TypeChips } from "./InspectorChips";
import { Muted, Section } from "./InspectorTabs";
import { saveFile } from "./save-file";
import { useStageCopy } from "./stage";
import { Scroller } from "./TypeTable";

/** The colour each group takes, the one the city draws its kind of link in. */
const TRACE: Record<GroupKey, Trace> = {
  receivers: "compositions",
  sources: "compositions",
  blockHosts: "blocks",
  blocks: "blocks",
  parents: "structure",
  orphans: "structure",
  children: "structure",
  pickers: "references",
  picks: "references",
};

/** Said wherever a trace is shown, because a list of types reads as a verdict. */
const EVIDENCE =
  "A trace lists configured relationships to review. It does not prove that a change breaks them, and code, templates and stored values outside the schema can depend on a type too.";

const DEPTHS: { value: number; label: string }[] = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: Number.POSITIVE_INFINITY, label: "All" },
];

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "dependents", label: "What a change reaches" },
  { value: "dependencies", label: "What it depends on" },
];

/** The type a row's first path arrives through, for the chip's "through" note. */
const throughOf = (row: ImpactRow) => {
  const path = row.paths[0] ?? [];
  return path.length > 1 ? path[path.length - 2]?.id : undefined;
};

/**
 * "via Curated content module", the type the first path arrives through, which says
 * how a row is reached where "indirect, 2 steps" only said how far. A longer path
 * names its step count too, since the Path column is a long way to the right.
 */
const viaLine = (row: ImpactRow, nameOf: (id: string) => string) => {
  const through = throughOf(row);
  const steps = row.paths[0]?.length ?? 0;
  if (!through) return `${steps.toString()} steps`;
  return steps > 2
    ? `via ${nameOf(through)}, ${steps.toString()} steps`
    : `via ${nameOf(through)}`;
};

/** Template names, the first `limit` of them, as the chips cut a long list. */
const templateNames = (templates: Impact["templates"], limit: number) =>
  [
    ...templates.slice(0, limit).map((template) => template.name),
    ...(templates.length > limit ? [`+ ${templates.length - limit} more`] : []),
  ].join(", ");

/**
 * The inspector's Impact tab: the totals and each group as chips, with the way to
 * the full page, which has the controls, the paths in words and the exports.
 */
export function ImpactSummary({
  impact,
  nodesById,
  onSelect,
}: {
  impact: Impact;
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <Section>
        <p className="text-prose">
          A change reaches {totalsLine(impact.types, impact.content)}, along
          every relationship at any depth.
        </p>
        {/* The full page opens from the Impact button above, the one way in. */}
        <div className="mt-1.5">
          <Muted>
            Impact, above, opens the full trace: paths in words, depth, a
            property alias and exports.
          </Muted>
        </div>
      </Section>
      {impact.groups.map((group) => (
        <Section key={group.key}>
          <Heading count={group.rows.length} trace={TRACE[group.key]}>
            {group.label}
          </Heading>
          <TypeChips
            chips={group.rows.map((row) => {
              const through = throughOf(row);
              return {
                id: row.id,
                name: row.name,
                ...(row.content === undefined ? {} : { count: row.content }),
                ...(through
                  ? { through: nodesById.get(through)?.name ?? through }
                  : {}),
              };
            })}
            limit={8}
            onSelect={onSelect}
          />
        </Section>
      ))}
      {impact.templates.length > 0 ? (
        <Section>
          <Heading count={impact.templates.length}>{TEMPLATES_LABEL}</Heading>
          <p className="text-prose text-xs">
            {templateNames(impact.templates, 8)}
          </p>
        </Section>
      ) : null}
      <p className="pt-3 text-faint text-xs">{EVIDENCE}</p>
    </>
  );
}

/** A row of mutually exclusive buttons, a radio group with arrow keys. */
function Choice<Value>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label text-xs">{label}</span>
      <div
        aria-label={label}
        className="flex w-fit items-center gap-px bg-line p-px"
        data-ui="segmented"
        onKeyDown={roving}
        role="radiogroup"
      >
        {options.map((option) => {
          const on = option.value === value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a native radio is a field, and the app's single-key shortcuts stand down inside fields.
            <button
              aria-checked={on}
              className={`h-8 px-2.5 text-xs ${on ? "bg-accent text-phosphor-bright" : "bg-secondary text-label hover:text-prose"}`}
              key={option.label}
              onClick={() => onChange(option.value)}
              role="radio"
              tabIndex={on ? 0 : -1}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Controls({
  relations,
  onRelations,
  depth,
  onDepth,
  direction,
  onDirection,
}: {
  relations: Relation[];
  onRelations: (relations: Relation[]) => void;
  depth: number;
  onDepth: (depth: number) => void;
  direction: Direction;
  onDirection: (direction: Direction) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="float-left mr-2 text-label text-xs">
          Relationships
        </legend>
        {RELATIONS.map((relation) => (
          <Toggle
            className={`${READING} text-xs`}
            key={relation}
            onPressedChange={(pressed) =>
              onRelations(
                RELATIONS.filter((one) =>
                  one === relation ? pressed : relations.includes(one)
                )
              )
            }
            pressed={relations.includes(relation)}
            size="sm"
            variant="outline"
          >
            {/* A box that fills, because with all four on by default an on toggle
                looked like any outline button and off had to be found by clicking. */}
            <span
              aria-hidden
              className={`size-2 shrink-0 border border-current ${relations.includes(relation) ? "bg-current" : ""}`}
            />
            {RELATION_LABEL[relation]}
          </Toggle>
        ))}
      </fieldset>
      <Choice label="Depth" onChange={onDepth} options={DEPTHS} value={depth} />
      <Choice
        label="Direction"
        onChange={onDirection}
        options={DIRECTIONS}
        value={direction}
      />
    </div>
  );
}

const CELL = "border-line/60 border-b px-2 py-1.5 text-left align-baseline";

/** The groups a type is in for its properties, where a block count says nothing. */
const COMPOSITION_GROUPS: GroupKey[] = ["receivers", "sources"];

/**
 * "31 items", "4 blocks" or "none of its own", one unit per row in one face. An
 * Element Type reached as a composition, like Page Meta, has no blocks because it is
 * not used as one, so "0 blocks" there read as unused while 31 pages carry it.
 */
function RowContent({ row, group }: { row: ImpactRow; group: GroupKey }) {
  if (row.content !== undefined)
    return (
      <span className={row.content === 0 ? "text-faint" : "text-prose"}>
        {plural(row.content, "item")}
      </span>
    );
  if (
    row.blocks !== undefined &&
    !(row.blocks === 0 && COMPOSITION_GROUPS.includes(group))
  )
    return (
      <span className={row.blocks === 0 ? "text-faint" : "text-prose"}>
        {plural(row.blocks, "block")}
      </span>
    );
  return <span className="text-faint">none of its own</span>;
}

function GroupTable({
  impact,
  group,
  nameOf,
  onSelect,
}: {
  impact: Impact;
  group: Impact["groups"][number];
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const headingId = useId();
  const words = (path: ImpactRow["paths"][number]) =>
    pathWords(impact.start, path, impact.direction, nameOf);
  return (
    <section aria-labelledby={headingId} className="py-3.5">
      <div id={headingId}>
        <Heading count={group.rows.length} trace={TRACE[group.key]}>
          {group.label}
        </Heading>
      </div>
      <table className="w-full table-fixed border-collapse text-xs">
        <thead>
          <tr className="text-label">
            <th className={`${CELL} w-[30%] font-medium`} scope="col">
              Type
            </th>
            <th className={`${CELL} w-[16%] font-medium`} scope="col">
              Content
            </th>
            <th className={`${CELL} font-medium`} scope="col">
              Path
            </th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <tr key={row.id}>
              <td className={CELL}>
                <button
                  className="max-w-full truncate text-left text-prose hover:text-phosphor hover:underline"
                  onClick={() => onSelect(row.id)}
                  type="button"
                >
                  {row.name}
                </button>
                <span className="block truncate font-mono text-2xs text-faint">
                  {row.alias}
                </span>
                <span className="block truncate text-2xs text-label">
                  {row.direct ? "direct" : viaLine(row, nameOf)}
                </span>
              </td>
              <td className={CELL}>
                <RowContent group={group.key} row={row} />
              </td>
              <td className={`${CELL} text-prose`}>
                {words(row.paths[0] ?? [])}
                {row.paths.slice(1).map((path) => (
                  <span className="mt-0.5 block text-label" key={words(path)}>
                    or {words(path)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Each template with how many of the traced types use it, their names on hover. */
function TemplateList({
  impact,
  nameOf,
}: {
  impact: Impact;
  nameOf: (id: string) => string;
}) {
  if (impact.templates.length === 0) return null;
  return (
    <Section>
      <Heading count={impact.templates.length}>{TEMPLATES_LABEL}</Heading>
      <ul className="space-y-0.5 text-xs">
        {impact.templates.map((template) => (
          <li key={template.id} title={template.types.map(nameOf).join(", ")}>
            <span className="text-prose">{template.name}</span>{" "}
            <span className="font-mono text-2xs text-faint">
              {template.alias}
            </span>
            <span className="text-label">
              {" "}
              used by {plural(template.types.length, "type")}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AliasCheck({
  alias,
  onAlias,
  result,
  nameOf,
  onSelect,
}: {
  alias: string;
  onAlias: (alias: string) => void;
  result: AliasImpact | null;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const hint = useId();
  return (
    <Section>
      <Heading>Property alias</Heading>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-label text-xs" htmlFor={id}>
          Planned or existing alias
        </label>
        <Input
          aria-describedby={hint}
          className="h-8 w-64 bg-secondary px-2 font-mono text-prose text-xs placeholder:text-faint focus-visible:border-phosphor md:text-xs"
          id={id}
          onChange={(event) => onAlias(event.target.value)}
          placeholder="Type an alias"
          spellCheck={false}
          type="text"
          value={alias}
        />
      </div>
      <p className="mt-1.5 text-faint text-xs" id={hint}>
        An existing alias is traced from the type that declares it. A new one is
        checked against every type it would land on.
      </p>
      {result ? (
        <div className="mt-2.5 text-xs">
          <p className="text-prose">
            {result.exists
              ? `${result.alias} is declared on ${nameOf(result.source)} and lands on ${totalsLine(result.carriers.length, result.content)}.`
              : `Added here, ${result.alias} would land on ${totalsLine(result.carriers.length, result.content)}.`}
          </p>
          {result.collisions.length === 0 ? (
            <p className="mt-1 text-label">
              None of them has {result.alias} from another source.
            </p>
          ) : (
            <>
              <p className="mt-1 text-signal">
                {plural(result.collisions.length, "collision")}: these already
                have {result.alias} from another source.
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.collisions.map((collision) => (
                  <li key={`${collision.id}:${collision.from}`}>
                    <button
                      className="text-prose hover:text-phosphor hover:underline"
                      onClick={() => onSelect(collision.id)}
                      type="button"
                    >
                      {collision.name}
                    </button>
                    <span className="text-label">
                      {" "}
                      has it from {collision.from}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </Section>
  );
}

/** How long "Copied 24 lines of Markdown" stays. */
const COPIED_MS = 4000;

/**
 * Copies the Markdown, or, where the clipboard is refused (an insecure origin, a
 * denied permission), shows it selected in a box so the keyboard copy still works.
 */
function CopyMarkdown({ text }: { text: () => string }) {
  const [fallback, setFallback] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useAnnounceChange(status || null);
  // A confirmation, not a state of the page: left up, it still said "Copied" when the
  // reader came back to a different trace. The fallback's message stays with its box.
  useEffect(() => {
    if (!status || fallback !== null) return;
    const timer = setTimeout(() => setStatus(""), COPIED_MS);
    return () => clearTimeout(timer);
  }, [status, fallback]);
  const copy = async () => {
    const markdown = text();
    try {
      await navigator.clipboard.writeText(markdown);
      setFallback(null);
      setStatus(`Copied ${markdown.split("\n").length} lines of Markdown`);
    } catch {
      setFallback(markdown);
      setStatus(
        "The clipboard is blocked here. The Markdown is selected below."
      );
      requestAnimationFrame(() => {
        box.current?.focus();
        box.current?.select();
      });
    }
  };
  return (
    <>
      <Button
        className={READING}
        onClick={() => void copy()}
        size="sm"
        variant="outline"
      >
        Copy as Markdown
      </Button>
      {status ? <span className="text-label text-xs">{status}</span> : null}
      {fallback === null ? null : (
        <textarea
          aria-label={`Markdown to copy, press ${SEARCH_KEY.startsWith("⌘") ? "Command" : "Ctrl"} C`}
          className="mt-2 h-40 w-full border border-line bg-panel-sunken p-2 font-mono text-2xs text-prose"
          readOnly
          ref={box}
          value={fallback}
        />
      )}
    </>
  );
}

export type ImpactViewProps = {
  graph: SchemaGraph;
  usage?: UsageReport;
  /** The type the trace starts from. */
  start: string | null;
  /** The alias field, and which source a property row named when it opened the view. */
  alias: { text: string; from?: string | null };
  onAlias: (alias: string) => void;
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
  onPick: () => void;
  /** Lights the start and every type it reaches in the city. */
  onShowInCity: (label: string, ids: Set<string>) => void;
};

export function ImpactView(props: ImpactViewProps) {
  const node = props.nodesById.get(props.start ?? "");
  if (!node)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center font-sans">
        <p className="font-semibold text-[17px] text-foreground">
          No type selected
        </p>
        <p className="text-label text-sm">
          Pick a Document Type to trace what a change to it reaches.
        </p>
        <Button className={READING} onClick={props.onPick} size="sm">
          Find a type
          <Kbd>{SEARCH_KEY}</Kbd>
        </Button>
      </div>
    );
  return <TracePage {...props} node={node} />;
}

const COLUMN = "mx-auto w-full max-w-240 px-4";

type TraceProps = ImpactViewProps & { node: SchemaNode };

/** The header's one line: what the trace reaches, the start's own content, stored blocks. */
function summaryLine(impact: Impact, node: SchemaNode) {
  const totals = totalsLine(impact.types, impact.content);
  const own =
    impact.own === undefined
      ? ""
      : ` ${node.name} has ${plural(impact.own, "content item")} of its own.`;
  const reach =
    impact.direction === "dependents"
      ? `A change reaches ${totals}.`
      : `It depends on ${totals}.`;
  return { reach, rest: `${own} ${storedLine(impact) ?? ""}`.trimEnd() };
}

/** Show in city, Export CSV and Copy as Markdown, all over the trace as it stands. */
function Actions({
  impact,
  aliasResult,
  graph,
  usage,
  node,
  onShowInCity,
}: Pick<TraceProps, "graph" | "usage" | "node" | "onShowInCity"> & {
  impact: Impact;
  aliasResult: AliasImpact | null;
}) {
  const reached = impact.groups.flatMap((group) =>
    group.rows.map((row) => row.id)
  );
  const verb =
    impact.direction === "dependents" ? "a change reaches" : "it depends on";
  const copy = useStageCopy();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        className={READING}
        onClick={() =>
          onShowInCity(
            `${node.name} and the ${plural(impact.types, "type")} ${verb}`,
            new Set([node.id, ...reached])
          )
        }
        size="sm"
        variant="outline"
      >
        {copy.show}
      </Button>
      <Button
        className={READING}
        onClick={() =>
          saveFile(
            impactCsv(impact, graph, usage, aliasResult),
            `schema-city-impact-${node.alias}.csv`,
            "text/csv;charset=utf-8"
          )
        }
        size="sm"
        variant="outline"
      >
        Export CSV
      </Button>
      <CopyMarkdown
        text={() => impactMarkdown(impact, graph, usage, aliasResult)}
      />
    </div>
  );
}

/**
 * The groups, or why there are none, their templates and the note on what a trace
 * can say.
 */
function Results({
  impact,
  usage,
  nameOf,
  onSelect,
}: Pick<TraceProps, "usage" | "onSelect"> & {
  impact: Impact;
  nameOf: (id: string) => string;
}) {
  const empty =
    impact.relations.length === 0
      ? "Switch on a relationship to trace it."
      : "Nothing is reached along the chosen relationships.";
  // The snapshot dates are in the exports and the Findings drawer. Here they
  // repeated under every trace, and a schema date reads as stale when it only
  // means nothing changed since.
  const counted = usage
    ? ""
    : " Usage has not loaded, so content counts are missing.";
  return (
    <>
      {impact.groups.length === 0 ? (
        <Section>
          <Muted>{empty}</Muted>
        </Section>
      ) : null}
      {impact.groups.map((group) => (
        <GroupTable
          group={group}
          impact={impact}
          key={group.key}
          nameOf={nameOf}
          onSelect={onSelect}
        />
      ))}
      <TemplateList impact={impact} nameOf={nameOf} />
      <p className="pt-3 text-faint text-xs">
        {EVIDENCE}
        {counted}
      </p>
    </>
  );
}

function TracePage(props: TraceProps) {
  const { graph, usage, node, alias, onAlias, nodesById, onSelect } = props;
  const [relations, setRelations] = useState<Relation[]>(RELATIONS);
  const [depth, setDepth] = useState(Number.POSITIVE_INFINITY);
  const [direction, setDirection] = useState<Direction>("dependents");
  const impact = useMemo(
    () => impactOf(graph, node.id, { direction, relations, depth }, usage),
    [graph, node.id, direction, relations, depth, usage]
  );
  const aliasResult = useMemo(
    () => aliasImpact(graph, node.id, alias.text, usage, alias.from),
    [graph, node.id, alias, usage]
  );
  const nameOf = (id: string) => nodesById.get(id)?.name ?? id;
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  usePanelFocus(panel, heading, node.id);
  const summary = summaryLine(impact, node);
  useAnnounceChange(summary.reach);
  useAnnounceChange(
    aliasResult &&
      `${plural(aliasResult.collisions.length, "alias collision")} for ${aliasResult.alias}`
  );

  return (
    <div
      className="flex h-full flex-col bg-background font-sans text-[13px] text-prose leading-normal"
      ref={panel}
    >
      <header className="border-line border-b pt-4 pb-3">
        <div className={COLUMN}>
          <h2
            className="font-semibold text-[17px] text-foreground leading-tight outline-none"
            data-impact-heading=""
            ref={heading}
            tabIndex={-1}
          >
            Impact of {node.name}
          </h2>
          <p className="mt-1 font-mono text-faint text-xs">{node.alias}</p>
          <p className="mt-2 text-label">
            <span className="text-prose">{summary.reach}</span>
            {summary.rest}
          </p>
          <div className="mt-3">
            <Controls
              depth={depth}
              direction={direction}
              onDepth={setDepth}
              onDirection={setDirection}
              onRelations={setRelations}
              relations={relations}
            />
          </div>
          <Actions {...props} aliasResult={aliasResult} impact={impact} />
        </div>
      </header>

      <Scroller label={`Impact of ${node.name}`}>
        <div className={`${COLUMN} pb-6`}>
          <AliasCheck
            alias={alias.text}
            nameOf={nameOf}
            onAlias={onAlias}
            onSelect={onSelect}
            result={aliasResult}
          />
          <Results
            impact={impact}
            nameOf={nameOf}
            onSelect={onSelect}
            usage={usage}
          />
        </div>
      </Scroller>
    </div>
  );
}
