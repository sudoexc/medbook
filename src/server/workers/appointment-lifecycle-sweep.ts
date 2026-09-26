/**
 * Appointment lifecycle sweep — auto-flip stale pre-arrival rows to NO_SHOW.
 *
 * Why it exists: CONFIRMED / BOOKED rows whose `endDate` has passed without
 * anyone marking the patient as arrived or no-show stay in the queue
 * forever, deflate the no-show metric, and clutter the table for reception.
 * Reception eventually reconciles them by eye, but that work is wasted: if
 * an hour has passed since the scheduled end and no one acted, the patient
 * didn't show. Make it official so dashboards, reactivation flows, and the
 * doctor surface all see the truth.
 *
 * Definition of "stale" lives in `src/lib/appointments/overdue.ts` — same
 * module the CRM table reads — so the UI badge and this worker can never
 * drift apart. The grace is `AUTO_NO_SHOW_GRACE_MIN` (60 min, vs. 15 min for
 * the UI "Просрочена" badge).
 *
 * Idempotency: re-running the tick is safe. The Prisma `where` already
 * excludes NO_SHOW rows, and the write is conditional on the status the scan
 * saw: if a receptionist moved the row to WAITING between scan and update,
 * the write matches nothing and the row is skipped.
 *
 * Audit Q-14, two rules the auto no-show must keep:
 *   - Both status columns move together. The sweep used to write `status`
 *     alone; reception lays its lanes out by `queueStatus`, so the auto
 *     no-show stayed in «Записи» as «Подтверждена» with a «Пришёл» button
 *     while the doctor saw a no-show.
 *   - Walk-ins are never swept. A live-queue row has no appointment time:
 *     its `endDate` is registration + 30 min, a technical window. A walk-in
 *     who waited 90 minutes and was skipped while in the corridor became a
 *     NO_SHOW on the next tick and got «вы не пришли» in Telegram while
 *     standing at the desk.
 *   - Nor is any row that already joined the live queue. SKIPPED is reached
 *     only from WAITING, so it means the patient came: a phone booking
 *     checked in at 09:00 and skipped while she was at the ECG used to
 *     become NO_SHOW at 10:30, dropped out of reception's lanes, and
 *     «Вызвать» / «Пришёл» refused it. The queue column is checked as well,
 *     so a row whose `status` drifted behind a WAITING `queueStatus` is
 *     left alone too.
 *
 * The flip is a guess, not a verdict: a patient who walks in later the same
 * clinic day can still be checked in with «Пришёл», which the audit row
 * written below makes possible (`canArriveAfterAutoNoShow`).
 *
 * Tenant context: cross-clinic scan in SYSTEM, then audit + outbox events
 * fanned out per-row with explicit clinicId.
 *
 * Second job (audit Q-13): IN_PROGRESS visits left over from an earlier
 * clinic day are closed as COMPLETED, see `closeStaleInProgressVisits`.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";
import { publishEventSafe } from "@/server/realtime/publish";
import {
  canTransitionAt,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import {
  AUTO_NO_SHOW_GRACE_MIN,
  isRunningLate,
  minutesPastStart,
} from "@/lib/appointments/overdue";
import { fireTrigger } from "@/server/notifications/triggers";
import { tashkentDayBounds } from "@/lib/booking-validation";
import {
  staleInProgressWhere,
  staleVisitCompletedAt,
} from "@/server/appointments/stale-visit";
import { refreshPatientVisitStats } from "@/server/patient/last-contacted";
import { AUDIT_ACTION } from "@/lib/audit-actions";

export const QUEUE_NAME = "appointment-lifecycle-sweep";
export const JOB_NAME = "scan";

/**
 * Pre-arrival statuses that can decay into NO_SHOW. WAITING and SKIPPED are
 * excluded: the patient already came to the clinic (SKIPPED is reached only
 * from WAITING), so a late call is the queue's problem, not a no-show.
 * IN_PROGRESS / COMPLETED / CANCELLED / NO_SHOW are terminal or in-flight.
 */
const SWEEP_STATUSES: ReadonlyArray<AppointmentStatus> = [
  "BOOKED",
  "CONFIRMED",
];

export type SweepCandidate = {
  id: string;
  clinicId: string;
  doctorId: string;
  status: AppointmentStatus;
  date: Date;
  endDate: Date;
  /** WALKIN rows are live-queue patients and never decay into NO_SHOW. */
  channel?: string;
  /** Reception's lane column; a row already in the queue is never swept. */
  queueStatus?: AppointmentStatus;
};

/**
 * The scan's filter, shared with the tests so the SQL and the pure selector
 * below cannot drift: scheduled bookings still waiting for their patient,
 * an hour past their end. Both status columns must say so: reception's
 * lanes read `queueStatus`, and a row it shows as waiting or skipped is a
 * patient who came.
 */
export function autoNoShowWhere(cutoff: Date) {
  return {
    status: { in: [...SWEEP_STATUSES] },
    queueStatus: { in: [...SWEEP_STATUSES] },
    channel: { not: "WALKIN" as const },
    endDate: { lt: cutoff },
  };
}

/**
 * Pure helper. Given a list of candidates and "now", return those that
 * crossed the auto-no-show grace. Strict `<` matches Prisma's `lt`
 * semantics so the worker and the SQL filter agree on the boundary.
 */
export function selectAutoNoShows<T extends SweepCandidate>(
  rows: ReadonlyArray<T>,
  now: Date,
): T[] {
  const cutoff = now.getTime() - AUTO_NO_SHOW_GRACE_MIN * 60_000;
  const out: T[] = [];
  for (const row of rows) {
    if (!SWEEP_STATUSES.includes(row.status)) continue;
    if (row.queueStatus && !SWEEP_STATUSES.includes(row.queueStatus)) continue;
    if (row.channel === "WALKIN") continue;
    if (row.endDate.getTime() < cutoff) {
      out.push(row);
    }
  }
  return out;
}

/** The slice of a stale IN_PROGRESS row the close-out needs. */
export type StaleVisitRow = {
  id: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  date: Date;
  startedAt: Date | null;
  durationMin: number;
};

/**
 * Q-13 — close IN_PROGRESS visits left over from an earlier clinic day.
 *
 * The doctor forgot to press «Завершить приём» yesterday (with 177 drafts
 * against 8 signatures this is daily, not rare). The row then stayed
 * IN_PROGRESS forever: the next morning «Вызвать» answered «уже идёт
 * приём: <вчерашний пациент>» while «Мой день» and the board, which read
 * today only, showed nobody on the table. The start guard now ignores such
 * rows (`findOtherActiveVisit` is bounded to today); this pass closes them.
 *
 * What it deliberately does NOT do: touch the conclusion. The visit becomes
 * COMPLETED exactly as when reception closes it; its draft stays a DRAFT —
 * never signed on the doctor's behalf, never deleted — and waits in
 * «Заключения → Черновики», where the doctor signs a completed visit's
 * draft (the audit row names it). No «Спасибо за визит» either: it would
 * reach the patient after midnight, a day late.
 *
 * Idempotent: the write is conditional on the row still being IN_PROGRESS,
 * so a doctor closing the visit at that very moment wins.
 */
export async function closeStaleInProgressVisits(
  now: Date = new Date(),
): Promise<{ scanned: number; closed: number }> {
  const { dayStart } = tashkentDayBounds(now);
  const stale = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: staleInProgressWhere(dayStart),
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        patientId: true,
        date: true,
        startedAt: true,
        durationMin: true,
      },
      take: 200,
      orderBy: { date: "asc" },
    }),
  )) as StaleVisitRow[];

  let closed = 0;
  for (const row of stale) {
    try {
      const completedAt = staleVisitCompletedAt(row);
      const res = await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.appointment.updateMany({
          where: { id: row.id, status: "IN_PROGRESS" },
          // Both status columns move together, like every other completion.
          data: { status: "COMPLETED", queueStatus: "COMPLETED", completedAt },
        }),
      );
      if (res.count === 0) continue;

      const draft = await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.visitNote.findFirst({
          where: { appointmentId: row.id, status: "DRAFT" },
          select: { id: true },
        }),
      );

      await prisma.auditLog.create({
        data: {
          clinicId: row.clinicId,
          action: "appointment.auto-close-stale-visit",
          entityType: "Appointment",
          entityId: row.id,
          meta: {
            from: "IN_PROGRESS",
            to: "COMPLETED",
            startedAt: row.startedAt?.toISOString() ?? null,
            completedAt: completedAt.toISOString(),
            // The conclusion the doctor still owes, if any.
            unsignedVisitNoteId: draft?.id ?? null,
          },
          actorId: null,
          actorRole: null,
          actorLabel: "system",
        },
      });

      publishEventSafe(row.clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: row.id,
          doctorId: row.doctorId,
          status: "COMPLETED",
          previousStatus: "IN_PROGRESS",
        },
      });

      // Same denormalised visit stats every completion path refreshes.
      await runWithTenant({ kind: "SYSTEM" }, () =>
        refreshPatientVisitStats(row.patientId),
      );
      closed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[lifecycle-sweep] stale visit close failed appt=${row.id} clinic=${row.clinicId} err=${msg}`,
      );
    }
  }
  return { scanned: stale.length, closed };
}

async function tick(): Promise<void> {
  const now = new Date();

  // Q-13 — independent of the no-show pass below, which returns early when
  // it has nothing to do; a failure here must not skip that pass either.
  try {
    const staleVisits = await closeStaleInProgressVisits(now);
    if (staleVisits.closed > 0) {
      console.info(
        `[lifecycle-sweep] closed stale visits ${staleVisits.closed}/${staleVisits.scanned}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[lifecycle-sweep] stale visit scan failed err=${msg}`);
  }
  const cutoff = new Date(now.getTime() - AUTO_NO_SHOW_GRACE_MIN * 60_000);

  // SYSTEM context: scan across every tenant. The branch-scope extension
  // would otherwise hide rows from clinics other than the worker's (none).
  const stale = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: autoNoShowWhere(cutoff),
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        status: true,
        queueStatus: true,
        date: true,
        endDate: true,
        channel: true,
      },
      // Bound the batch so a long outage backlog doesn't blow the event
      // loop on first tick. 500 stale rows per tick × every 10 min drains
      // a 6-hour backlog inside an hour.
      take: 500,
      orderBy: { endDate: "asc" },
    }),
  )) as SweepCandidate[];

  if (stale.length === 0) {
    return;
  }

  let flipped = 0;
  for (const row of stale) {
    // Defense in depth — a receptionist may have flipped the row between
    // the scan and now. canTransitionAt is the same gate the bulk-status
    // route uses, so the worker can never make a write the UI couldn't.
    const check = canTransitionAt(row.status, "NO_SHOW", row.date, now, 0);
    if (!check.ok) continue;

    try {
      // Conditional on the status the scan saw and on the row still being
      // outside the queue, so a receptionist's click in between wins; both
      // status columns move together (Q-14).
      const res = await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.appointment.updateMany({
          where: {
            id: row.id,
            status: row.status,
            queueStatus: { in: [...SWEEP_STATUSES] },
          },
          data: { status: "NO_SHOW", queueStatus: "NO_SHOW" },
        }),
      );
      if (res.count === 0) continue;

      // Worker audit: no Request/session, write to AuditLog directly with
      // the actorLabel stamp other workers use so compliance dashboards
      // can distinguish automated transitions from receptionist clicks.
      await prisma.auditLog.create({
        data: {
          clinicId: row.clinicId,
          // Reception's same-day «Пришёл» keys on this action to tell the
          // sweep's guess from a person's no-show (auto-no-show.ts).
          action: AUDIT_ACTION.APPOINTMENT_AUTO_NO_SHOW,
          entityType: "Appointment",
          entityId: row.id,
          meta: {
            from: row.status,
            to: "NO_SHOW",
            graceMinutes: AUTO_NO_SHOW_GRACE_MIN,
            endDate: row.endDate.toISOString(),
          },
          actorId: null,
          actorRole: null,
          actorLabel: "system",
        },
      });

      publishEventSafe(row.clinicId, {
        type: "appointment.statusChanged",
        payload: {
          appointmentId: row.id,
          doctorId: row.doctorId,
          status: "NO_SHOW",
          previousStatus: row.status,
        },
      });
      // Reception's lanes read `queueStatus`: tell the boards it moved.
      publishEventSafe(row.clinicId, {
        type: "queue.updated",
        payload: {
          appointmentId: row.id,
          doctorId: row.doctorId,
          queueStatus: "NO_SHOW",
          previousStatus: row.status,
        },
      });

      // TZ-notifications-cancel-sync §8.2 — text the patient "sorry it
      // didn't happen, want to reschedule?" Idempotent via the standard
      // NotificationSend (appointmentId, templateId) unique key, so a
      // duplicate auto-flip (impossible by status guard, but defensive)
      // can't double-send.
      fireTrigger({
        kind: "appointment.no-show",
        appointmentId: row.id,
      });

      flipped += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[lifecycle-sweep] failed appt=${row.id} clinic=${row.clinicId} err=${msg}`,
      );
    }
  }

  // TZ-notifications-cancel-sync §8.2 — running-late sub-pass. Same sweep
  // tick, separate query window: BOOKED/CONFIRMED rows that crossed the
  // 15-minute "late" threshold but haven't aged into auto-NO_SHOW yet. The
  // text nudges the patient to call ahead so reception can hold the slot.
  // We over-fetch (no template filter at SQL) and dedup downstream via
  // NotificationSend(appointmentId, templateId) — the worker can't know
  // which clinics have a running-late template seeded without an extra
  // join. The pool is small (rows in the 15–60 min window per clinic).
  const lateWindowStart = new Date(now.getTime() - 60 * 60_000);
  const lateWindowEnd = new Date(now.getTime() - 15 * 60_000);
  const lateCandidates = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        status: { in: ["BOOKED", "CONFIRMED"] as AppointmentStatus[] },
        date: { gte: lateWindowStart, lt: lateWindowEnd },
      },
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        status: true,
        date: true,
        endDate: true,
      },
      take: 500,
      orderBy: { date: "asc" },
    }),
  )) as SweepCandidate[];

  let lateFired = 0;
  for (const row of lateCandidates) {
    // Double-check via the shared helper. `isRunningLate` excludes WAITING
    // / IN_PROGRESS, and the >= 15-min gate keeps us aligned with the UI
    // "Опаздывает" badge — patient gets the text at the same moment
    // reception sees the orange chip.
    if (!isRunningLate(row, now)) continue;
    if (minutesPastStart(row, now) < 15) continue;
    fireTrigger({
      kind: "appointment.running-late",
      appointmentId: row.id,
    });
    lateFired += 1;
  }

  console.info(
    `[lifecycle-sweep] tick ok flipped=${flipped}/${stale.length} late=${lateFired}/${lateCandidates.length}`,
  );
}

/**
 * Register the sweep with the in-memory queue adapter and start the repeat
 * timer. Cadence default 10 min — twice the UI grace (15 min) so the row
 * is "Просрочена" for at least one sweep cycle before the auto-flip can
 * fire, giving reception a clear handoff window.
 */
export function startAppointmentLifecycleSweepWorker(
  intervalMs = 10 * 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(
    `[worker] appointment-lifecycle-sweep registered every ${intervalMs}ms`,
  );
  return handle;
}

export { tick as _tickForTests };
