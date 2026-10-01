/**
 * Phase 16 Wave 2 — Pre-visit questionnaire worker.
 *
 * Hourly tick. For every BOOKED/CONFIRMED/WAITING appointment whose
 * `startsAt` lands inside a 23–25h-from-now window, with a Telegram patient
 * (the form lives in the Mini App), and which has not yet been notified or
 * submitted, we:
 *
 *   1. Materialise a notification through the
 *      `appointment.pre-visit-questionnaire` trigger (TG + INAPP for TG
 *      patients). SMS was removed in `docs/TZ-sms-removal.md` Wave 3. The
 *      template is created for the clinic on first use.
 *   2. Stamp `Appointment.preVisitNotifiedAt = now()` so future ticks skip
 *      it, only once a row exists (audit TG-09: the stamp used to come
 *      first, so with no template every visit read «уведомлено» and nothing
 *      was ever sent).
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
import { UPCOMING_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
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
        // CONFIRMED too (audit TG-09, MA-09): phone and kiosk bookings are
        // confirmed at creation. The Mini App submit accepts the same list.
        status: { in: [...UPCOMING_VISIT_STATUSES] },
        preVisitNotifiedAt: null,
        preVisitSubmittedAt: null,
        // Phase 17 Wave 1 — never poke a soft-deleted patient. Marketing
        // opt-out is intentionally NOT checked: pre-visit questionnaires
        // are transactional (see file-header comment). Telegram only: the
        // form is a Mini App screen, nothing else can open it.
        patient: { deletedAt: null, telegramId: { not: null }, tgBlockedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
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
    const missingTemplate = new Set<string>();
    for (const row of rows) {
      const patientHasContact = Boolean(row.patient.telegramId);
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

      // Materialise first, stamp after, and only when a row exists (or was
      // already there). A switched-off template leaves the visit unstamped,
      // so turning it back on within the window still reaches the patient.
      try {
        const outcome = await onPreVisitQuestionnaire(row.id);
        if (outcome.created > 0 || outcome.reason === "already_scheduled") {
          await prisma.appointment.updateMany({
            where: { id: row.id, preVisitNotifiedAt: null },
            data: { preVisitNotifiedAt: now },
          });
          notified += 1;
        } else if (outcome.reason === "no_template") {
          missingTemplate.add(row.clinicId);
        }
      } catch (err) {
        console.error(
          `[pre-visit-questionnaire] appointment ${row.id} failed`,
          err,
        );
      }
    }

    for (const clinicId of missingTemplate) {
      console.warn(
        `[pre-visit-questionnaire] clinic ${clinicId}: template appointment.pre-visit-questionnaire is switched off, questionnaires not sent`,
      );
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
