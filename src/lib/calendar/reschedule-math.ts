/**
 * Phase 12 Wave 3 — calendar drag/drop reschedule math.
 *
 * Pure helpers shared by the FullCalendar `eventDrop` handler and the
 * confirmation modal. The drag/drop interaction itself lives inside
 * FullCalendar (`editable + eventStartEditable`), but the moment we
 * intercept the drop we need three things from the new slot:
 *
 *   1. The new start time (already given by FullCalendar).
 *   2. The new end time — derived by *preserving the original duration*
 *      so a 30-min visit stays 30 min after the move.
 *   3. A guard that rejects drops landing earlier than `now`.
 *
 * Server-side validation (H6, see `src/server/services/appointments.ts`)
 * is the source of truth for cross-doctor / cross-cabinet collisions; we
 * only short-circuit the obvious "in the past" case here so the user
 * doesn't see a 409 round-trip for it.
 *
 * Kept dependency-free so it can be imported in unit tests without the
 * Next.js / React ambient. Do NOT import from `@/lib/prisma` or any
 * server-only module here.
 */

export type RescheduleInput = {
  /** Original appointment start. */
  originalStart: Date;
  /** Original appointment end. */
  originalEnd: Date;
  /** New start time selected by the drop target. */
  newStart: Date;
  /** Optional doctor on the drop target's column (multi-doctor day view). */
  newDoctorId?: string;
  /** Wall-clock "now" — injected for tests. */
  now?: Date;
};

export type RescheduleResult =
  | {
      ok: true;
      /** New start ISO — sent as `date` to PATCH. */
      newStartIso: string;
      /** New end ISO — sent as `endDate` to PATCH. */
      newEndIso: string;
      /** Original duration in minutes (pinned, never edited by drag). */
      durationMin: number;
      /** Doctor id, if drop landed on another doctor's column. */
      newDoctorId?: string;
    }
  | { ok: false; reason: "in_past" | "invalid_input" };

/**
 * Compute the new (start, end) for a drag-rescheduled appointment.
 *
 * Preserves the original duration: drop only chooses a *start*; the end
 * follows. Rejects drops that land before `now` (the obvious past-time
 * case) without round-tripping the server.
 */
export function computeRescheduledSlot(
  input: RescheduleInput,
): RescheduleResult {
  const { originalStart, originalEnd, newStart, newDoctorId } = input;
  const now = input.now ?? new Date();

  const startMs = originalStart.getTime();
  const endMs = originalEnd.getTime();
  const newStartMs = newStart.getTime();

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    !Number.isFinite(newStartMs)
  ) {
    return { ok: false, reason: "invalid_input" };
  }
  if (endMs <= startMs) {
    return { ok: false, reason: "invalid_input" };
  }

  if (newStartMs < now.getTime()) {
    return { ok: false, reason: "in_past" };
  }

  const durationMs = endMs - startMs;
  const durationMin = Math.max(5, Math.round(durationMs / 60_000));
  const newEndMs = newStartMs + durationMs;

  return {
    ok: true,
    newStartIso: new Date(newStartMs).toISOString(),
    newEndIso: new Date(newEndMs).toISOString(),
    durationMin,
    newDoctorId,
  };
}
