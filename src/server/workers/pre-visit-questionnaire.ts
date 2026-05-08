/**
 * Phase 16 Wave 2 — Pre-visit questionnaire worker.
 *
 * Hourly tick. For every BOOKED/WAITING appointment whose `startsAt` lands
 * inside a 23–25h-from-now window, with a TG-eligible patient, and which
 * has not yet been notified or submitted, we:
 *
 *   1. Materialise a notification through the
 *      `appointment.pre-visit-questionnaire` trigger (TG/SMS + INAPP for TG
 *      patients).
 *   2. Stamp `Appointment.preVisitNotifiedAt = now()` so future ticks skip
 *      it.
 *
 * Eligibility logic is centralised in `src/lib/patient-experience/pre-visit.ts
 * → isPreVisitEligible(...)` so the unit tests can exercise the window
 * boundaries without booting Prisma.
 *
 * The worker is intentionally cheap: a single bounded `findMany` per tick
 * with `take: 500` covers a clinic that books >120 visits/day with room to
 * spare. We rely on the (status, date) Appointment index for the scan.
 *
 * Failure mode: notification materialisation is fire-and-forget — if a
 * single row throws (template missing, recipient unresolvable, etc.) we
 * log + continue so a single bad row doesn't block the whole batch.
 *
 * Phase 17 Wave 1 — consent gate is intentionally NOT applied here. The
 * pre-visit questionnaire is purely transactional / care-quality (the
 * patient has an upcoming appointment they explicitly booked; filling
 * the form helps the doctor prepare). It must continue to fire even
 * after a marketing opt-out, exactly like the appointment reminders.
 * Soft-deleted patients are excluded at the SQL layer below.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { isPreVisitEligible } from "@/lib/patient-experience/pre-visit";

import { onPreVisitQuestionnaire } from "@/server/notifications/triggers";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "patient-experience:pre-visit";
export const JOB_NAME = "pre-visit-questionnaire-tick";

/**
 * Hourly cadence — the eligibility window is 23–25h, so a 60-minute tick
 * comfortably catches every appointment without missing the band. Smaller
 * intervals would just churn idempotency checks.
 */
const TICK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Run once. Scans the appointment table, fires notifications, stamps the
 * dedupe column. Returns the count of stamps written so the caller (tests)
 * can assert against it.
 */
export async function runPreVisitTick(now: Date = new Date()): Promise<{
  scanned: number;
  notified: number;
}> {
  const lower = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const upper = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const rows = await prisma.appointment.findMany({
      where: {
        date: { gte: lower, lte: upper },
        status: { in: ["BOOKED", "WAITING"] },
        preVisitNotifiedAt: null,
        preVisitSubmittedAt: null,
        // Phase 17 Wave 1 — never poke a soft-deleted patient. Marketing
        // opt-out is intentionally NOT checked: pre-visit questionnaires
        // are transactional (see file-header comment).
        patient: { deletedAt: null },
      },
      select: {
        id: true,
        date: true,
        status: true,
        preVisitNotifiedAt: true,
        preVisitSubmittedAt: true,
        patient: {
          select: {
            telegramId: true,
            phone: true,
          },
        },
      },
      take: 500,
    });

    let notified = 0;
    for (const row of rows) {
      const patientHasContact = Boolean(
        row.patient.telegramId || row.patient.phone,
      );
      const eligible = isPreVisitEligible(
        {
          startsAt: row.date,
          status: row.status,
          preVisitNotifiedAt: row.preVisitNotifiedAt,
          preVisitSubmittedAt: row.preVisitSubmittedAt,
          patientHasContact,
        },
        now,
      );
      if (!eligible) continue;

      // Stamp first, then send. A double-tick race is harmless — the
      // template materialiser also dedupes by (appointmentId, templateId)
      // — but stamping first is cheaper than re-querying.
      try {
        await prisma.appointment.update({
          where: { id: row.id },
          data: { preVisitNotifiedAt: now },
        });
        await onPreVisitQuestionnaire(row.id);
        notified += 1;
      } catch (err) {
        console.error(
          `[pre-visit-questionnaire] appointment ${row.id} failed`,
          err,
        );
      }
    }

    return { scanned: rows.length, notified };
  });
}

/** Start the worker (idempotent — safe to call multiple times). */
export function startPreVisitQuestionnaireWorker(
  intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(QUEUE_NAME, JOB_NAME, async () => {
    try {
      await runPreVisitTick();
    } catch (err) {
      console.error("[pre-visit-questionnaire] tick failed", err);
    }
  });
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] pre-visit-questionnaire registered");
  return handle;
}

// Test-only export.
export { runPreVisitTick as _runForTests };
