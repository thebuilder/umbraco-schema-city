import { useState } from "react";
import type { Finding } from "../model/findings";
import type { SchemaNode } from "../model/types";
import { DataTypeLink } from "./InspectorChips";

/** A mixin can name dozens of types; past this many the rest wait behind "+N more". */
const SHOWN = 8;

function RelatedLink({
  id,
  node,
  onSelect,
  quiet,
}: {
  id: string;
  node: SchemaNode | undefined;
  onSelect: (id: string) => void;
  quiet: boolean;
}) {
  return node ? (
    <button
      className="max-w-40 truncate text-phosphor hover:text-phosphor-bright hover:underline"
      onClick={() => onSelect(id)}
      type="button"
    >
      {node.name}
    </button>
  ) : (
    <code className={quiet ? "text-label" : "text-signal"}>
      missing key {id}
    </code>
  );
}

/**
 * The types and Data Types a finding names. `quiet` is for a reviewed finding: a
 * missing key keeps its words but drops the problem colour, which only open
 * findings use.
 */
export function FindingRelations({
  finding,
  nodesById,
  onSelect,
  quiet = false,
}: {
  finding: Finding;
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
  quiet?: boolean;
}) {
  const [limit, setLimit] = useState(SHOWN);
  const related = [...new Set(finding.related ?? [])];
  const dataTypes = (
    <DataTypeLinksLine
      ids={finding.nodeId ? (finding.dataTypeIds ?? []) : []}
    />
  );
  if (related.length === 0) return dataTypes;
  const shown = related.slice(0, limit);
  const hidden = related.length - shown.length;
  return (
    <>
      {dataTypes}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-faint text-xs">
        <span>Related:</span>
        {shown.map((id) => (
          <RelatedLink
            id={id}
            key={id}
            node={nodesById.get(id)}
            onSelect={onSelect}
            quiet={quiet}
          />
        ))}
        {hidden > 0 ? (
          <button
            className="text-phosphor hover:text-phosphor-bright hover:underline"
            onClick={() => setLimit(related.length)}
            type="button"
          >
            + {hidden} more
          </button>
        ) : null}
      </div>
    </>
  );
}

/** The Data Types a type's finding names, each a link to its page. */
function DataTypeLinksLine({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-faint text-xs">
      <span>Data Types:</span>
      {ids.map((id) => (
        <DataTypeLink className="max-w-40 text-phosphor" id={id} key={id} />
      ))}
    </div>
  );
}
