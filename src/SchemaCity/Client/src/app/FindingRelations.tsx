import type { Finding } from "../model/findings";
import type { SchemaNode } from "../model/types";

export function FindingRelations({
  finding,
  nodesById,
  onSelect,
}: {
  finding: Finding;
  nodesById: Map<string, SchemaNode>;
  onSelect: (id: string) => void;
}) {
  const related = [...new Set(finding.related ?? [])];
  if (related.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1 text-3xs text-phosphor-dim">
      <span>Related:</span>
      {related.map((id) => {
        const node = nodesById.get(id);
        return node ? (
          <button
            className="text-phosphor hover:text-phosphor-bright hover:underline"
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
    </div>
  );
}
