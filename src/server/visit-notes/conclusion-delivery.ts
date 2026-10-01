/**
 * Is the patient's CONCLUSION PDF for a visit note ready to hand out right
 * now? (audit VW-06)
 *
 * The PDF is rendered by the visit-note-handout worker on a 30 s sweep, so
 * for half a minute after the doctor signs there is no PDF yet, and after an
 * in-window edit, an amendment or a rollback the stored PDF shows the old
 * text until the next tick. «Отправить в Telegram» used to send whatever
 * was stored and report «Отправлено: 1» either way: the patient left with
 * an MRI scan and no conclusion, or with the conclusion as it was before the
 * correction, while the doctor believed it was done.
 *
 * Pure, and kept apart from the worker module so the API route does not pull
 * the PDF renderer into its bundle; the worker imports its rules from here.
 */

/**
 * Only notes finalized within this window get their first render. Bounds the
 * one-time backfill when the feature first ships (so we don't render the
 * clinic's entire history at once) while staying generous enough to catch up
 * after a worker outage.
 */
export const CONCLUSION_BACKFILL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pure predicate — does this note carry a handout we can deliver right now?
 * Only `patientHandoutMarkdown` ever reaches the patient; the clinical
 * `bodyMarkdown` never does.
 */
export function hasDeliverableHandout(note: {
  status: string;
  patientHandoutMarkdown: string | null;
}): boolean {
  if (note.status !== "FINALIZED") return false;
  return Boolean(note.patientHandoutMarkdown?.trim());
}

/**
 *   - `ready`: the stored PDF is the current one, send it.
 *   - `rendering`: the worker will (re)render it within a tick; nothing
 *     should be sent as «the conclusion» until then.
 *   - `not_signed`: the visit is not signed (a draft, or rolled back), so
 *     there is no conclusion to give, and a PDF left from before a rollback
 *     must not go out.
 *   - `missing`: signed, but no PDF will come: the handout for the patient
 *     is empty, or the visit is older than the first-render window.
 */
export type ConclusionDeliveryState = "ready" | "rendering" | "not_signed" | "missing";

export function conclusionDeliveryState(input: {
  status: string;
  patientHandoutMarkdown: string | null;
  handoutStaleAt: Date | null;
  finalizedAt: Date | null;
  hasConclusionDocument: boolean;
  now: Date;
}): ConclusionDeliveryState {
  if (input.status !== "FINALIZED") return "not_signed";
  if (!hasDeliverableHandout(input)) return "missing";
  // Same two roads into the worker's sweep: a stale mark is re-rendered
  // whatever the age, a first render only inside the window.
  if (input.handoutStaleAt != null) return "rendering";
  if (input.hasConclusionDocument) return "ready";
  const since = input.now.getTime() - CONCLUSION_BACKFILL_WINDOW_MS;
  if (input.finalizedAt && input.finalizedAt.getTime() >= since) return "rendering";
  return "missing";
}
