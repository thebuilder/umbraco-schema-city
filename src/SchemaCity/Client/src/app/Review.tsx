// Marking a finding as intentional, and undoing it, wherever a finding is shown:
// the findings drawer, the inspector's checks and a Data Type's page.
import {
  type ComponentProps,
  createContext,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { dayOf } from "../model/dates";
import { FINDING_LABEL, type Finding } from "../model/findings";
import {
  type Decision,
  type DecisionStore,
  MAX_REASON,
  problemMarks,
  type Review,
  reviewsOf,
  subjectFingerprints,
} from "../model/review";
import type { SchemaGraph, SchemaNode } from "../model/types";
import { useAnnounce } from "./a11y";
import { DataTypeLinks, READING } from "./InspectorChips";

export type Reviewing = {
  reviewOf: (finding: Finding) => Review | undefined;
  save: (finding: Finding, reason: string) => Promise<void>;
  undo: (finding: Finding) => Promise<void>;
  /** Why the decisions did not load, or null. */
  failed: string | null;
};

/** App provides it when it has a store; without one no review controls show. */
export const Reviews = createContext<Reviewing | null>(null);

/**
 * The two things a finding needs from App, Data Type links and reviews, in one
 * provider, so App wraps its tree once.
 */
export function FindingLinks({
  dataTypes,
  reviews,
  children,
}: {
  dataTypes: ComponentProps<typeof DataTypeLinks>["value"];
  reviews: Reviewing | null;
  children: ReactNode;
}) {
  return (
    <DataTypeLinks value={dataTypes}>
      <Reviews value={reviews}>{children}</Reviews>
    </DataTypeLinks>
  );
}

/**
 * Loads the decisions once and keeps them in step with every save and undo. The
 * fingerprint sent with a save is the one this graph has, which the server checks
 * against its own.
 */
export function useReviewing(
  store: DecisionStore | undefined,
  graph: SchemaGraph,
  findings: Finding[]
): Reviewing | null {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!store) return;
    let live = true;
    store.load().then(
      (list) => live && setDecisions(list),
      (error: Error) => live && setFailed(error.message)
    );
    return () => {
      live = false;
    };
  }, [store]);
  return useMemo(() => {
    if (!store) return null;
    const reviews = reviewsOf(findings, decisions, graph);
    const fingerprintOf = subjectFingerprints(graph);
    return {
      reviewOf: (finding) => reviews.get(finding.id),
      save: async (finding, reason) => {
        const saved = await store.save(
          finding.id,
          reason,
          fingerprintOf(finding)
        );
        setDecisions((list) => [
          ...list.filter((decision) => decision.findingId !== finding.id),
          saved,
        ]);
      },
      undo: async (finding) => {
        await store.remove(finding.id);
        setDecisions((list) =>
          list.filter((decision) => decision.findingId !== finding.id)
        );
      },
      failed,
    };
  }, [store, findings, decisions, graph, failed]);
}

/**
 * The List's and Tree's problem dot per type, quiet once its problems are
 * reviewed, and following every save and undo.
 */
export function useProblemMarks(findings: Finding[]) {
  const reviewOf = use(Reviews)?.reviewOf;
  return useMemo(() => problemMarks(findings, reviewOf), [findings, reviewOf]);
}

/** The name of what a finding is about: its type, or for a Data Type finding the Data Type. */
export const subjectName = (
  finding: Finding,
  nodesById: Map<string, SchemaNode>,
  links: { nameOf: (id: string) => string | undefined } | null
) =>
  finding.nodeId
    ? (nodesById.get(finding.nodeId)?.name ?? "a deleted type")
    : (links?.nameOf(finding.dataTypeIds?.[0] ?? "") ?? "a Data Type");

/** “Kept for the old import”, Ada, 2026-10-07. The quotes set the reason apart. */
const decisionText = ({ reason, decidedBy, decidedAt }: Decision) =>
  [`“${reason}”`, decidedBy, dayOf(decidedAt)].filter(Boolean).join(", ");

const LINK =
  "px-1 py-0.5 text-phosphor text-xs hover:text-phosphor-bright hover:underline";

/**
 * A finding's review status and the one action it allows: mark as intentional with
 * a reason, or undo. Focus lands on the next action after a save, a cancel or an
 * undo, so a keyboard user stays on the row. `subject` names the type or Data Type
 * for the announcement, and `onChange` tells the drawer a row changed state.
 */
export function ReviewControl({
  finding,
  subject,
  onChange,
}: {
  finding: Finding;
  subject: string;
  onChange?: () => void;
}) {
  const reviewing = use(Reviews);
  const announce = useAnnounce();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const action = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Where focus goes once the next render has drawn the state it belongs to.
  const focusNext = useRef<"action" | "field" | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) (target === "field" ? field : action).current?.focus();
  });

  if (!reviewing) return null;
  const what = `${FINDING_LABEL[finding.kind]} on ${subject}`;

  // One request at a time. A failure keeps the form, and with it the typed reason.
  const run = async (work: () => Promise<void>, done: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
      setEditing(false);
      setError(null);
      focusNext.current = "action";
      announce(done);
      onChange?.();
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      setError(message);
      announce(message);
    } finally {
      busy.current = false;
    }
  };
  const show = (form: boolean) => {
    setEditing(form);
    setError(null);
    focusNext.current = form ? "field" : "action";
  };

  return editing ? (
    <ReasonForm
      error={error}
      field={field}
      onCancel={() => show(false)}
      onEmpty={() => setError("Write why this finding is intentional.")}
      onSave={(reason) =>
        run(
          () => reviewing.save(finding, reason),
          `${what} marked as intentional`
        )
      }
    />
  ) : (
    <ReviewStatus
      action={action}
      error={error}
      kind={finding.nodeId ? "type" : "Data Type"}
      onMark={() => show(true)}
      onUndo={() =>
        void run(() => reviewing.undo(finding), `Decision on ${what} undone`)
      }
      review={reviewing.reviewOf(finding)}
      what={what}
    />
  );
}

/**
 * The reason field with Save and Cancel. The typed reason lives here, so it stays
 * while a failed save shows its error. Escape in the field cancels the form rather
 * than closing the drawer around it.
 */
function ReasonForm({
  error,
  field,
  onSave,
  onCancel,
  onEmpty,
}: {
  error: string | null;
  field: RefObject<HTMLTextAreaElement | null>;
  onSave: (reason: string) => Promise<void>;
  onCancel: () => void;
  onEmpty: () => void;
}) {
  const [reason, setReason] = useState("");
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = reason.trim();
    if (text) void onSave(text);
    else {
      onEmpty();
      field.current?.focus();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    onCancel();
  };
  return (
    <form className="mt-2 space-y-1.5" onSubmit={submit}>
      <label className="block text-label text-xs" htmlFor={id}>
        Why is this intentional?
      </label>
      <textarea
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className="block w-full resize-y border border-input bg-panel-sunken px-2 py-1 font-sans text-prose text-xs outline-none focus-visible:border-line-strong focus-visible:shadow-glow aria-invalid:border-destructive"
        id={id}
        maxLength={MAX_REASON}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={onKeyDown}
        ref={field}
        rows={2}
        value={reason}
      />
      <Failure error={error} id={`${id}-error`} />
      <div className="flex gap-2">
        <Button className={READING} size="sm" type="submit" variant="outline">
          Save
        </Button>
        <Button
          className={READING}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Decided: the decision and Undo. Open: Mark as intentional. Reopened: the old
 * decision under a note that the subject changed, with both actions. `action` is
 * the button focus returns to.
 */
function ReviewStatus({
  review,
  kind,
  what,
  error,
  action,
  onMark,
  onUndo,
}: {
  review: Review | undefined;
  kind: string;
  what: string;
  error: string | null;
  action: RefObject<HTMLButtonElement | null>;
  onMark: () => void;
  onUndo: () => void;
}) {
  const named = <span className="sr-only">: {what}</span>;
  const undo = (ref?: RefObject<HTMLButtonElement | null>) => (
    <button className={LINK} onClick={onUndo} ref={ref} type="button">
      Undo{named}
    </button>
  );

  if (review && !review.reopened)
    return (
      <div className="mt-2 text-xs">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-label">
            <span className="text-phosphor">Intentional:</span>{" "}
            {decisionText(review.decision)}
          </p>
          {undo(action)}
        </div>
        <Failure error={error} />
      </div>
    );

  return (
    <div className="mt-2 space-y-1 text-xs">
      {review ? (
        <>
          <p className="text-amber">
            Reopened: the {kind} changed since this was decided.
          </p>
          <p className="text-label">
            Was intentional: {decisionText(review.decision)}
          </p>
        </>
      ) : null}
      <div className="-mx-1 flex gap-2">
        <button className={LINK} onClick={onMark} ref={action} type="button">
          Mark as intentional{named}
        </button>
        {review ? undo() : null}
      </div>
      <Failure error={error} />
    </div>
  );
}

/** What failed, in the problem colour, or nothing. */
const Failure = ({ error, id }: { error: string | null; id?: string }) =>
  error ? (
    <p className="text-signal text-xs" id={id}>
      {error}
    </p>
  ) : null;
