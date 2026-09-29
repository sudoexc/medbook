/**
 * The reception desk's control-visit call (VISIT_FOLLOW_UP_DUE) kept in step
 * with the note's plan: «через N дней», an exact day, or none.
 *
 * Two writers share it, so the task cannot drift from what the patient's
 * print, PDF and Mini App say:
 *   - the medication bridge, after a signature and after a re-signature of
 *     a reverted visit (src/server/workers/visit-note-handout.ts);
 *   - a correction of the plan on a signed note inside its 24h window (the
 *     visit-notes PATCH). The bridge runs again only when the prescriptions
 *     change, so before this a moved or cleared plan never reached reception.
 *
 * A plan that is gone retires the open task instead of leaving reception to
 * call about a control visit the doctor cancelled.
 *
 * Caller MUST be inside `runWithTenant(...)` (see `upsertAction`).
 */
import type { TenantScopedPrisma } from "@/lib/prisma";
import { addTashkentDays, tashkentDateOf, tashkentDayWindow } from "@/lib/tashkent-time";
import { followUpDue } from "@/lib/visit-follow-up";
import {
  dedupeKeyFor,
  type VisitFollowUpDuePayload,
} from "@/lib/actions/types";
import { retireActions, upsertAction } from "@/server/actions/repository";
import { clinicMorningBefore } from "@/server/actions/clinic-day";
import {
  VISIT_FOLLOW_UP_GRACE_DAYS,
  VISIT_FOLLOW_UP_LEAD_DAYS,
} from "@/server/actions/config";

/** What the task is made of; the bridge's note row carries all of it. */
export type FollowUpActionNote = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  /** «Через N дней» counts from here; a note not signed yet counts from now. */
  finalizedAt: Date | null;
  followUpDays: number | null;
  followUpDate: Date | null;
  followUpNote: string | null;
  patient: { fullName: string };
  doctor: { nameRu: string } | null;
};

export type FollowUpActionSync = "upserted" | "retired" | "none";

/** Why a task is closed when the doctor removed the plan. */
const RETIRE_REASON = "follow_up_cancelled";

/**
 * The last moment the task stays in reception's list: the end of the
 * seventh clinic day after the due day, whole days being what reception
 * plans in. Counted from today instead when the due day has already gone
 * by (a note signed before finalize refused such a day, a reopened draft
 * signed after its window, a worker outage): a task born expired is swept
 * before anyone sees it, and the patient is still owed the call.
 */
export function followUpActionExpiry(dueDate: string, now: Date): Date {
  const today = tashkentDateOf(now);
  const from = dueDate < today ? today : dueDate;
  return tashkentDayWindow(addTashkentDays(from, VISIT_FOLLOW_UP_GRACE_DAYS + 1))
    .from;
}

export async function syncFollowUpAction(
  db: TenantScopedPrisma,
  note: FollowUpActionNote,
  now: Date = new Date(),
): Promise<FollowUpActionSync> {
  // The one rule every reader shares: the day the doctor named, or «через N
  // дней» counted in Tashkent calendar days from the signature.
  const due = followUpDue(note, note.finalizedAt ?? now, now);

  if (!due) {
    const dedupeKey = dedupeKeyFor({
      type: "VISIT_FOLLOW_UP_DUE",
      visitNoteId: note.id,
    } as VisitFollowUpDuePayload);
    const row = (await db.action.findUnique({
      where: { clinicId_dedupeKey: { clinicId: note.clinicId, dedupeKey } },
      select: { id: true, type: true, severity: true, status: true, outcome: true },
    })) as {
      id: string;
      type: string;
      severity: string;
      status: string;
      outcome: string | null;
    } | null;
    // A call reception already made (DONE) or waved off (DISMISSED) is
    // their record and stays; only a task still waiting to be worked goes.
    if (!row || (row.status !== "OPEN" && row.status !== "SNOOZED")) {
      return "none";
    }
    await retireActions(db, note.clinicId, [row], RETIRE_REASON);
    return "retired";
  }

  // Idempotent via the Action dedupeKey: a retry converges either way. A
  // task reception already closed is not reopened by a repeat of the same
  // plan; only a moved due day reopens it (upsertAction, audit AC-08), and
  // an EXPIRED one (a plan cleared, then set again) comes back.
  await upsertAction(
    db,
    note.clinicId,
    {
      type: "VISIT_FOLLOW_UP_DUE",
      visitNoteId: note.id,
      patientId: note.patientId,
      patientName: note.patient.fullName,
      doctorId: note.doctorId,
      doctorName: note.doctor?.nameRu ?? "—",
      dueDate: due.date,
      followUpNote: note.followUpNote?.trim() ?? "",
      // Only when true: a «через N дней» payload stays byte-identical to
      // the ones written before exact dates existed.
      ...(due.exact ? { exactDate: true } : {}),
    },
    {
      deeplinkPath: `/crm/patients/${note.patientId}`,
      // Keep the card around for a week past due, then auto-expire. The
      // explicit expiry is also what shields the row from the engine's 48h
      // sweep: nothing re-upserts it on a timer (audit AC-03).
      expiresAt: followUpActionExpiry(due.date, now),
      // Reception needs the call a week ahead of the control visit, not on
      // the day of finalize: a 30-day follow-up would otherwise sit in the
      // list for a month and get tuned out. Short intervals show at once.
      surfaceAt: clinicMorningBefore(due.date, VISIT_FOLLOW_UP_LEAD_DAYS),
    },
  );
  return "upserted";
}
