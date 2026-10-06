import { useState } from "react";
import type { Finding } from "../model/findings";
import type { SchemaNode } from "../model/types";

/** A mixin can name dozens of types; past this many the rest wait behind "+N more". */
const SHOWN = 8;

function RelatedLink({
  id,
  node,
  onSelect,
}: {
  id: string;
  node: SchemaNode | undefined;
  onSelect: (id: string) => void;
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
    <code className="text-signal">missing key {id}</code>
  );
}

export function FindingRelations({
  finding,
  nodesById,
  onSelect,
}: {
  finding: Finding;
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
}) {
  const [limit, setLimit] = useState(SHOWN);
  const related = [...new Set(finding.related ?? [])];
  if (related.length === 0) return null;
  const shown = related.slice(0, limit);
  const hidden = related.length - shown.length;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-3xs text-phosphor-dim">
      <span>Related:</span>
      {shown.map((id) => (
        <RelatedLink
          id={id}
          key={id}
          node={nodesById.get(id)}
          onSelect={onSelect}
        />
      ))}
      {hidden > 0 ? (
        <button
          className="hover:text-phosphor hover:underline"
          onClick={() => setLimit(related.length)}
          type="button"
        >
          +{hidden} more
        </button>
      ) : null}
    </div>
  );
}
