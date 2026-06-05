/**
 * Appointment lifecycle sweep — auto-flip stale pre-arrival rows to NO_SHOW.
 *
 * Why it exists: CONFIRMED / BOOKED / SKIPPED rows whose `endDate` has passed
 * without anyone marking the patient as arrived or no-show stay in the queue
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
 * excludes NO_SHOW rows, and `canTransitionAt` is the second gate — if a
 * concurrent receptionist click moved the row to WAITING between scan and
 * update, we skip it.
 *
 * Tenant context: cross-clinic scan in SYSTEM, then audit + outbox events
 * fanned out per-row with explicit clinicId.
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

export const QUEUE_NAME = "appointment-lifecycle-sweep";
export const JOB_NAME = "scan";

/**
 * Pre-arrival statuses that can decay into NO_SHOW. WAITING is excluded —
 * the patient is already inside the clinic; that's a different problem
 * (the doctor is overdue, not the patient). IN_PROGRESS / COMPLETED /
 * CANCELLED / NO_SHOW are terminal or in-flight.
 */
const SWEEP_STATUSES: ReadonlyArray<AppointmentStatus> = [
  "BOOKED",
  "CONFIRMED",
  "SKIPPED",
];

export type SweepCandidate = {
  id: string;
  clinicId: string;
  doctorId: string;
  status: AppointmentStatus;
  date: Date;
  endDate: Date;
};

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
    if (row.endDate.getTime() < cutoff) {
      out.push(row);
    }
  }
  return out;
}

async function tick(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - AUTO_NO_SHOW_GRACE_MIN * 60_000);

  // SYSTEM context: scan across every tenant. The branch-scope extension
  // would otherwise hide rows from clinics other than the worker's (none).
  const stale = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        status: { in: SWEEP_STATUSES as unknown as AppointmentStatus[] },
        endDate: { lt: cutoff },
      },
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        status: true,
        date: true,
        endDate: true,
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
      const after = await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.appointment.update({
          where: { id: row.id },
          data: { status: "NO_SHOW" },
          select: { id: true, doctorId: true, status: true },
        }),
      );

      // Worker audit: no Request/session, write to AuditLog directly with
      // the actorLabel stamp other workers use so compliance dashboards
      // can distinguish automated transitions from receptionist clicks.
      await prisma.auditLog.create({
        data: {
          clinicId: row.clinicId,
          action: "appointment.auto-no-show",
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
          doctorId: after.doctorId,
          status: after.status,
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
