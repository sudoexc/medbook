/**
 * Pure edits of the structured prescription list (audit VW-01).
 *
 * The list is saved replace-all: every action sends the WHOLE array. So an
 * action must be composed on top of the rows as the doctor last left them,
 * never on the snapshot the component rendered with. «Ввёл дозу, кликнул
 * „Утро“» fires two actions before the first response is back; composed
 * from the render snapshot, the second one carried the old dose and the
 * server applied it last. Callers pass the live rows (the query cache,
 * which `usePatchVisitNote` updates the moment an edit is made) and get
 * back the array to send.
 */
import type {
  VisitPrescriptionDraft,
  VisitPrescriptionRow,
  VisitPrescriptionTimeOfDay,
} from "./use-visit-note";

/** An edit of one row: fixed values, or computed from the row's live state. */
export type RowEdit =
  | Partial<VisitPrescriptionDraft>
  | ((current: VisitPrescriptionDraft) => Partial<VisitPrescriptionDraft>);

const TIME_ORDER: VisitPrescriptionTimeOfDay[] = [
  "MORNING",
  "NOON",
  "EVENING",
  "NIGHT",
];

/** Stored rows → PATCH drafts (the server assigns ids and sortOrder). */
export function toPrescriptionDrafts(
  rows: ReadonlyArray<VisitPrescriptionRow | VisitPrescriptionDraft>,
): VisitPrescriptionDraft[] {
  return rows.map((row) => {
    const {
      id: _id,
      sortOrder: _sortOrder,
      ...rest
    } = row as VisitPrescriptionRow;
    return rest;
  });
}

/** Apply `edit` to row `index`; null when there is no such row. */
export function withRowEdited(
  drafts: VisitPrescriptionDraft[],
  index: number,
  edit: RowEdit,
): VisitPrescriptionDraft[] | null {
  const current = drafts[index];
  if (!current) return null;
  const patch = typeof edit === "function" ? edit(current) : edit;
  const next = drafts.slice();
  next[index] = { ...current, ...patch };
  return next;
}

export function withRowRemoved(
  drafts: VisitPrescriptionDraft[],
  index: number,
): VisitPrescriptionDraft[] | null {
  if (!drafts[index]) return null;
  const next = drafts.slice();
  next.splice(index, 1);
  return next;
}

/** Toggle a time of day, keeping the canonical morning → night order. */
export function toggleTimeOfDay(
  times: VisitPrescriptionTimeOfDay[],
  time: VisitPrescriptionTimeOfDay,
): VisitPrescriptionTimeOfDay[] {
  return times.includes(time)
    ? times.filter((x) => x !== time)
    : TIME_ORDER.filter((x) => times.includes(x) || x === time);
}
