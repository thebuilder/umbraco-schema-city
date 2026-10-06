import { useState } from "react";
import type { Finding } from "../model/findings";
import type { SchemaNode } from "../model/types";

/** A mixin can name dozens of types; past this many the rest wait behind "+N more". */
const SHOWN = 8;

export function FindingRelations({
  finding,
  nodesById,
  onSelect,
}: {
  finding: Finding;
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const related = [...new Set(finding.related ?? [])];
  if (related.length === 0) return null;
  const shown = expanded ? related : related.slice(0, SHOWN);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-3xs text-phosphor-dim">
      <span>Related:</span>
      {shown.map((id) => {
        const node = nodesById.get(id);
        return node ? (
          <button
            className="max-w-40 truncate text-phosphor hover:text-phosphor-bright hover:underline"
            key={id}
            onClick={() => onSelect(id)}
            type="button"
          >
            {node.name}
          </button>
        ) : (
          <code className="text-signal" key={id}>
            missing key {id}
          </code>
        );
      })}
      {related.length > shown.length ? (
        <button
          className="hover:text-phosphor hover:underline"
          onClick={() => setExpanded(true)}
          type="button"
        >
          +{related.length - shown.length} more
        </button>
      ) : null}
    </div>
  );
}
