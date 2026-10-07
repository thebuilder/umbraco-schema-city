// The Data Types view: every Data Type as a sortable table, and the chosen one as a
// page beside it with what it offers, what uses it and the blocks content stores in
// it. Below 760 px of room the page goes under the table instead.
import {
  type RefObject,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  allowedBlocks,
  type BlockChip,
  type DataTypeRow,
  type DataTypeUser,
  dataTypeIndex,
  dataTypeUsers,
  isBlockEditor,
  matchDataTypes,
  storedTotals,
} from "../model/data-types";
import type { Finding } from "../model/findings";
import { chips, contentCountOf, type Role } from "../model/inspector";
import { findingMark } from "../model/review";
import type { SchemaGraph, SchemaNode, UsageReport } from "../model/types";
import { plural, useAnnounceChange, usePanelFocus } from "./a11y";
import {
  FindingDot,
  Heading,
  READING,
  RoleKey,
  TypeChips,
} from "./InspectorChips";
import { InspectorChecks, useCheckNote } from "./InspectorDiagnostics";
import { Muted, Section, Values } from "./InspectorTabs";
import { Reviews } from "./Review";
import {
  FilterField,
  Scroller,
  SortHeaders,
  sortRows,
  useSort,
} from "./TypeTable";

type SortKey = "name" | "editor" | "properties" | "types" | "stored";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "editor", label: "Editor" },
  { key: "properties", label: "Properties", numeric: true },
  { key: "types", label: "Types", numeric: true },
  { key: "stored", label: "Stored blocks", numeric: true },
];

const CELL = "border-line/60 border-b px-2 py-1.5 text-left align-baseline";

/** What each configuration value is called on the page. */
const SETTING: Record<string, string> = {
  blocks: "Blocks offered",
  min: "Minimum",
  max: "Maximum",
  gridColumns: "Grid columns",
};

export type DataTypesProps = {
  graph: SchemaGraph;
  usage?: UsageReport;
  findings: Finding[];
  nodesById: Map<string, SchemaNode>;
  /** The chosen Data Type's key, or null for none. */
  selected: string | null;
  onChoose: (id: string) => void;
  /** Selects a type, which opens the inspector. */
  onSelect: (id: string) => void;
  onOpenDataType?: (id: string) => void;
  onShowInCity: (id: string) => void;
  roleOf: (node: SchemaNode) => Role;
};

export function DataTypes(props: DataTypesProps) {
  const { graph, usage, findings, selected, onChoose } = props;
  const [query, setQuery] = useState("");
  const [sort, toggle] = useSort<SortKey>();
  // Umbraco's own Data Types are a dozen rows every site has, so they wait behind
  // the checkbox. One a link chose stays in the list, so the page has its row.
  const [builtIn, setBuiltIn] = useState(false);
  const rows = useMemo(() => dataTypeIndex(graph, usage), [graph, usage]);
  const shown = useMemo(
    () =>
      sortRows(
        matchDataTypes(rows, query, { builtIn, keep: selected }),
        sort.key,
        sort.ascending
      ),
    [rows, query, sort, builtIn, selected]
  );
  const flagged = useMemo(() => {
    const out = new Map<string, Finding[]>();
    for (const finding of findings)
      for (const id of finding.dataTypeIds ?? [])
        out.set(id, [...(out.get(id) ?? []), finding]);
    return out;
  }, [findings]);
  const chosen = rows.find((row) => row.id === selected);
  // A link from elsewhere chooses a row that can be far down the list.
  const list = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (selected)
      list.current
        ?.querySelector('[aria-current="true"]')
        ?.scrollIntoView({ block: "center" });
  }, [selected]);

  useAnnounceChange(`${shown.length} of ${rows.length} Data Types`);
  useAnnounceChange(chosen ? `${chosen.name} Data Type selected` : null);

  const columns = usage?.blocks
    ? COLUMNS
    : COLUMNS.filter((column) => column.key !== "stored");

  return (
    <div className="@container flex h-full flex-col bg-background font-sans text-[13px] text-prose leading-normal">
      <ListToolbar
        builtIn={builtIn}
        hasBuiltIn={rows.some((row) => row.isBuiltIn)}
        listsAll={Boolean(graph.dataTypes)}
        onBuiltIn={setBuiltIn}
        onQuery={setQuery}
        query={query}
        shown={shown.length}
        total={rows.length}
      />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] @min-[760px]:grid-cols-2 @min-[760px]:grid-rows-1">
        <Scroller label="Data Type list">
          <table className="w-full border-collapse" ref={list}>
            <caption className="sr-only">
              Every Data Type in the schema. Choosing a row shows it beside the
              list.
            </caption>
            <SortHeaders columns={columns} onSort={toggle} sort={sort} />
            <tbody>
              {shown.map((row) => (
                <ListRow
                  findings={flagged.get(row.id) ?? []}
                  key={row.id}
                  on={row.id === selected}
                  onChoose={onChoose}
                  row={row}
                  stored={Boolean(usage?.blocks)}
                />
              ))}
            </tbody>
          </table>
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-faint text-xs">
              No Data Type matches “{query}”.
            </p>
          ) : null}
        </Scroller>
        <section
          aria-label="Data Type details"
          className="min-h-0 overflow-auto border-line border-t bg-panel focus-visible:outline-offset-[-2px] @min-[760px]:border-t-0 @min-[760px]:border-l"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region has to be reachable by keyboard.
          tabIndex={0}
        >
          {chosen ? (
            <Detail
              {...props}
              dataType={chosen}
              findings={flagged.get(chosen.id) ?? []}
            />
          ) : (
            <p className="px-4 py-6 text-label text-xs">
              Choose a Data Type to see its editor, what it offers, what uses it
              and the blocks content stores in it.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** The filter, the count, the built-in switch, and a note for a graph with no list. */
function ListToolbar({
  query,
  onQuery,
  shown,
  total,
  builtIn,
  onBuiltIn,
  hasBuiltIn,
  listsAll,
}: {
  query: string;
  onQuery: (query: string) => void;
  shown: number;
  total: number;
  builtIn: boolean;
  onBuiltIn: (on: boolean) => void;
  hasBuiltIn: boolean;
  listsAll: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-line border-b px-4 py-2">
      <FilterField
        onQuery={onQuery}
        placeholder="Filter Data Types"
        query={query}
      />
      <p className="text-label text-xs">
        <span className="font-mono">{shown}</span> of{" "}
        <span className="font-mono">{total}</span> Data Types
      </p>
      {hasBuiltIn ? (
        <label className="flex items-center gap-1.5 text-label text-xs">
          <input
            checked={builtIn}
            className="accent-phosphor"
            onChange={(event) => onBuiltIn(event.target.checked)}
            type="checkbox"
          />
          Show built-in
        </label>
      ) : null}
      {listsAll ? null : (
        <p className="text-label text-xs">
          This schema lists only the Data Types its properties use.
        </p>
      )}
    </div>
  );
}

/**
 * One Data Type in the list, with a dot for its findings: pink when an open one is
 * a problem, grey for open notes only, a hollow ring when all are reviewed, and
 * the kinds on hover.
 */
function ListRow({
  row,
  on,
  onChoose,
  findings,
  stored,
}: {
  row: DataTypeRow;
  on: boolean;
  onChoose: (id: string) => void;
  findings: Finding[];
  stored: boolean;
}) {
  const mark = findingMark(findings, use(Reviews)?.reviewOf);
  // On the selected row's background faint falls below 4.5:1, so it steps up.
  const count = (value: number | null) => (
    <td
      className={`${CELL} text-right font-mono text-xs ${value ? "text-prose" : on ? "text-label" : "text-faint"}`}
    >
      {value?.toLocaleString()}
    </td>
  );
  return (
    <tr
      className={on ? "bg-accent" : "hover:bg-accent/50"}
      onClick={() => onChoose(row.id)}
    >
      <th className={`${CELL} font-normal`} scope="row">
        <span className="flex items-center gap-1.5">
          <button
            aria-current={on ? "true" : undefined}
            className={`text-left hover:text-phosphor hover:underline ${on ? "text-phosphor-bright" : "text-prose"}`}
            onClick={() => onChoose(row.id)}
            type="button"
          >
            {row.name}
          </button>
          {row.isBuiltIn ? (
            <span className={`text-2xs ${on ? "text-label" : "text-faint"}`}>
              built-in
            </span>
          ) : null}
          {mark ? <FindingDot {...mark} /> : null}
        </span>
      </th>
      <td className={`${CELL} text-label text-xs`}>{row.editor}</td>
      {count(row.properties)}
      {count(row.types)}
      {stored ? count(row.stored) : null}
    </tr>
  );
}

type DetailProps = DataTypesProps & { dataType: DataTypeRow };

/** The chosen Data Type's page. Each section says nothing when it has nothing. */
function Detail(props: DetailProps) {
  const { dataType, graph, usage, findings, nodesById, onSelect } = props;
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  usePanelFocus(panel, heading, dataType.id);
  const users = useMemo(
    () => dataTypeUsers(graph, dataType.id),
    [graph, dataType.id]
  );
  const countOf = useMemo(
    () => contentCountOf(usage, nodesById, graph.edges ?? []),
    [usage, nodesById, graph.edges]
  );
  const checks = useCheckNote(findings);

  return (
    <article aria-labelledby={headingId} ref={panel}>
      <DetailHeader
        {...props}
        heading={heading}
        headingId={headingId}
        users={users.length}
      />
      <div className="px-4 pb-4">
        <AllowedBlocks {...props} />
        <AllowedTypes {...props} countOf={countOf} />
        <Section>
          <Heading count={users.length}>Used by</Heading>
          <UsedBy {...props} countOf={countOf} users={users} />
        </Section>
        {isBlockEditor(dataType) ? (
          <Section>
            <Heading>Stored blocks</Heading>
            <StoredBlocks id={dataType.id} usage={usage} />
          </Section>
        ) : null}
        <Configuration dataType={dataType} />
        <Section>
          <Heading count={checks.open} note={checks.note}>
            Findings
          </Heading>
          <InspectorChecks
            empty="No checks flagged this Data Type."
            findings={findings}
            nodesById={nodesById}
            onSelect={onSelect}
            subjects
          />
        </Section>
      </div>
    </article>
  );
}

function DetailHeader({
  dataType,
  heading,
  headingId,
  users,
  onOpenDataType,
  onShowInCity,
}: DetailProps & {
  heading: RefObject<HTMLHeadingElement | null>;
  headingId: string;
  users: number;
}) {
  return (
    <header className="border-line border-b px-4 pt-4 pb-3">
      {/* Focusable from script only, so choosing a Data Type puts the reader on
          its name, as opening a type does in the inspector. */}
      <h2
        className="break-words font-semibold text-[17px] text-foreground leading-tight outline-none"
        data-data-type-heading=""
        id={headingId}
        ref={heading}
        tabIndex={-1}
      >
        {dataType.name}
      </h2>
      <p className="mt-1 text-label text-xs">
        {dataType.editor}{" "}
        <span className="font-mono text-faint">{dataType.editorAlias}</span>
      </p>
      <p className="mt-0.5 break-all font-mono text-2xs text-faint">
        {dataType.id}
        {dataType.folder ? ` · in ${dataType.folder}` : ""}
        {dataType.isBuiltIn ? " · built-in" : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          className={READING}
          disabled={users === 0}
          onClick={() => onShowInCity(dataType.id)}
          size="sm"
          variant="outline"
        >
          Show in city
        </Button>
        <Button
          className={`ml-auto ${READING} font-semibold`}
          onClick={() => onOpenDataType?.(dataType.id)}
          size="sm"
          variant="primary"
        >
          Open in editor
        </Button>
      </div>
    </header>
  );
}

/** What a block editor offers, as content and settings, with what content stores. */
function AllowedBlocks({ dataType, usage, nodesById, onSelect }: DetailProps) {
  const blocks = allowedBlocks(dataType, usage, nodesById);
  if (
    blocks.content.length +
      blocks.settings.length +
      blocks.notOffered.length ===
    0
  )
    return null;
  return (
    <Section>
      <Heading trace="blocks">Allowed blocks</Heading>
      <BlockGroup chips={blocks.content} label="Content" onSelect={onSelect} />
      <BlockGroup
        chips={blocks.settings}
        label="Settings"
        onSelect={onSelect}
      />
      <BlockGroup
        chips={blocks.notOffered}
        label="Stored but no longer offered"
        onSelect={onSelect}
      />
      {usage?.blocks ? null : (
        <Muted>Stored counts appear once content usage has loaded.</Muted>
      )}
    </Section>
  );
}

/** The Document Types a picker allows, as the inspector's type chips. */
function AllowedTypes({
  dataType,
  nodesById,
  onSelect,
  countOf,
}: DetailProps & { countOf: (id: string) => number | undefined }) {
  const ids = [
    ...new Set(
      dataType.targets
        .filter((target) => target.role === "picker")
        .map((target) => target.nodeId)
    ),
  ];
  if (ids.length === 0) return null;
  return (
    <Section>
      <Heading count={ids.length} trace="references">
        Allowed types
      </Heading>
      <TypeChips
        chips={chips(ids, nodesById, countOf)}
        limit={12}
        onSelect={onSelect}
      />
    </Section>
  );
}

function Configuration({ dataType }: { dataType: DataTypeRow }) {
  const settings = Object.entries(dataType.configuration ?? {});
  if (settings.length === 0) return null;
  return (
    <Section>
      <Heading>Configuration</Heading>
      <Values
        rows={settings.map(([key, value]) => [SETTING[key] ?? key, `${value}`])}
      />
    </Section>
  );
}

/**
 * Element Types as chips with what content stores of each, the way the inspector
 * draws types. A key that resolves to nothing is a missing type, and one with no
 * stored block has a dashed edge and says so.
 */
function BlockGroup({
  label,
  chips: list,
  onSelect,
}: {
  label: string;
  chips: BlockChip[];
  onSelect: (id: string) => void;
}) {
  if (list.length === 0) return null;
  return (
    <div className="mb-2.5 last:mb-0">
      <p className="mb-1 text-label text-xs">{label}</p>
      <div className="flex flex-wrap items-center gap-1">
        {list.map((chip) => (
          <BlockChipButton chip={chip} key={chip.id} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

const storedWords = (count: number | null) => {
  if (count === null) return "";
  return count === 0 ? "none stored" : `${count.toLocaleString()} stored`;
};

function BlockChipButton({
  chip,
  onSelect,
}: {
  chip: BlockChip;
  onSelect: (id: string) => void;
}) {
  if (chip.name === null)
    return (
      <span className="border border-signal/50 px-1.5 py-0.5 text-signal text-xs">
        missing type{" "}
        <span className="break-all font-mono text-2xs">{chip.id}</span>
        {chip.stored ? `, ${storedWords(chip.stored)}` : ""}
      </span>
    );
  return (
    <button
      aria-label={[chip.name, storedWords(chip.stored)]
        .filter(Boolean)
        .join(", ")}
      className={`inline-flex min-w-0 max-w-full items-baseline gap-1 border bg-muted px-1.5 py-0.5 text-prose text-xs hover:border-phosphor hover:text-phosphor ${chip.stored === 0 ? "border-label border-dashed" : "border-line"}`}
      onClick={() => onSelect(chip.id)}
      type="button"
    >
      <span className="truncate">{chip.name}</span>
      {chip.stored === null ? null : (
        <span className="shrink-0 font-mono text-2xs text-label">
          {storedWords(chip.stored)}
        </span>
      )}
    </button>
  );
}

/**
 * Every type with a property on the Data Type, its own properties and the composed
 * ones with the composition they come from. Clicking a type opens it.
 */
function UsedBy({
  dataType,
  users,
  nodesById,
  countOf,
  onSelect,
  roleOf,
}: DetailProps & {
  users: DataTypeUser[];
  countOf: (id: string) => number | undefined;
}) {
  const others =
    dataType.otherUses > 0
      ? `${plural(dataType.otherUses, "Media or Member Type property or collection view uses", "Media or Member Type properties and collection views use")} it as well.`
      : "";
  if (users.length === 0)
    return <Muted>No Document Type property uses it. {others}</Muted>;
  return (
    <>
      <ul>
        {users.map(({ node, properties }) => (
          <li
            className="border-line/40 border-t py-1.5 first:border-t-0"
            key={node.id}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <button
                className="text-left text-prose hover:text-phosphor hover:underline"
                onClick={() => onSelect(node.id)}
                type="button"
              >
                {node.name}
              </button>
              <RoleKey role={roleOf(node)} />
              <ContentCount count={countOf(node.id)} />
            </div>
            <ul className="mt-0.5 pl-3">
              {properties.map((property) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-2 text-xs"
                  key={`${property.fromCompositionId ?? ""}:${property.alias}`}
                >
                  <span className="font-mono text-label">{property.alias}</span>
                  <span className="text-faint">{property.name}</span>
                  {property.fromCompositionId ? (
                    <span className="text-azure">
                      from{" "}
                      {nodesById.get(property.fromCompositionId)?.name ??
                        "a deleted type"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {others ? <Muted>{others}</Muted> : null}
    </>
  );
}

function ContentCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="ml-auto font-mono text-2xs text-label">
      {plural(count, "content item")}
    </span>
  );
}

/** The block totals for one Data Type, and how sure they are. */
function StoredBlocks({ id, usage }: { id: string; usage?: UsageReport }) {
  if (!usage) return <Muted>Content usage has not loaded yet.</Muted>;
  const { blocks } = usage;
  if (!blocks)
    return <Muted>This usage report has no stored block counts.</Muted>;
  const totals = storedTotals(usage).get(id);
  return (
    <>
      {totals ? (
        <Values
          rows={[
            ["Blocks", totals.blocks.toLocaleString()],
            ["As content", totals.content.toLocaleString()],
            ["As settings", totals.settings.toLocaleString()],
            ["Content items", totals.items.toLocaleString()],
            ["Values read", totals.values.toLocaleString()],
          ]}
        />
      ) : (
        <Muted>Content stores no blocks in it.</Muted>
      )}
      <p className="mt-2 text-faint text-xs">
        Counted in the latest version of every document outside the recycle bin,
        published or draft.
      </p>
      {blocks.partial ? (
        <p className="mt-1.5 text-amber text-xs">
          The count stopped early, at its row cap or time budget, so these
          numbers are a lower bound.
        </p>
      ) : null}
      {blocks.unreadable > 0 ? (
        <p className="mt-1.5 text-amber text-xs">
          {plural(blocks.unreadable, "stored value was", "stored values were")}{" "}
          not valid JSON and could not be read.
        </p>
      ) : null}
    </>
  );
}
