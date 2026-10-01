/**
 * Phase 16 Wave 2 — Post-visit NPS request worker.
 *
 * Hourly tick. For every COMPLETED appointment whose `completedAt` is
 * between `now-24h` and `now-4h`, with a TG-eligible patient, and which
 * has not yet been requested, we:
 *
 *   1. Materialise a notification through the `appointment.nps-request`
 *      trigger (TG + INAPP mirror). SMS was removed in
 *      `docs/TZ-sms-removal.md` Wave 3.
 *   2. Stamp `Appointment.npsRequestedAt = now()` to dedupe future ticks,
 *      once a row exists (the template is created on first use).
 *
 * The request goes out from 4h after the visit; in steady state the next
 * hourly tick takes it, 4 to 5 hours after. The window reaches back to 24h
 * (audit INF-12): the old one-hour [5h, 4h] window lost every visit that
 * crossed it while the worker was down for a deploy, or while a tick
 * slipped. `npsRequestedAt` keeps it to one request per visit; a visit
 * older than a day is not asked any more.
 *
 * Patients who already left a review for the same appointment are NOT
 * filtered here — that's the API endpoint's job (idempotent 409 on
 * resubmit). The NPS push can still fire for someone who already rated
 * via /crm; the cost is one extra TG message that links to a "thank you"
 * screen because the form refuses to submit.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { isAllowedToReceive } from "@/server/notifications/consent-gate";
import { onNpsRequest } from "@/server/notifications/triggers";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "patient-experience:post-visit-nps";
export const JOB_NAME = "post-visit-nps-tick";

const TICK_INTERVAL_MS = 60 * 60 * 1000;

/** How long after the visit the rating is asked, and the catch-up limit. */
const NPS_DELAY_MS = 4 * 60 * 60 * 1000;
const NPS_CATCH_UP_MS = 24 * 60 * 60 * 1000;

/**
 * Pure helper — does the row qualify for an NPS request right now?
 *
 * Window: completedAt in [now - 24h, now - 4h].
 *
 * Reused by the worker AND the unit test (so we don't have to spin up
 * Prisma for window-boundary assertions).
 */
export function isNpsEligible(
  row: {
    completedAt: Date | null;
    status: string;
    npsRequestedAt: Date | null;
    patientHasContact: boolean;
  },
  now: Date = new Date(),
): boolean {
  if (row.npsRequestedAt !== null) return false;
  if (row.status !== "COMPLETED") return false;
  if (!row.completedAt) return false;
  if (!row.patientHasContact) return false;
  const ms = now.getTime() - row.completedAt.getTime();
  return ms >= NPS_DELAY_MS && ms <= NPS_CATCH_UP_MS;
}

export async function runPostVisitNpsTick(
  now: Date = new Date(),
): Promise<{ scanned: number; requested: number }> {
  const lower = new Date(now.getTime() - NPS_CATCH_UP_MS);
  const upper = new Date(now.getTime() - NPS_DELAY_MS);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const rows = await prisma.appointment.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { gte: lower, lte: upper },
        npsRequestedAt: null,
        // Phase 17 Wave 1 — exclude soft-deleted patients. The marketing
        // opt-out gate is enforced per-row below. Telegram only: the rating
        // form is a Mini App screen.
        patient: { deletedAt: null, telegramId: { not: null }, tgBlockedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        status: true,
        completedAt: true,
        npsRequestedAt: true,
        patient: {
          select: {
            telegramId: true,
            phone: true,
            marketingOptOut: true,
            deletedAt: true,
          },
        },
      },
      take: 500,
    });

    let requested = 0;
    const missingTemplate = new Set<string>();
    for (const row of rows) {
      const patientHasContact = Boolean(row.patient.telegramId);
      const eligible = isNpsEligible(
        {
          completedAt: row.completedAt,
          status: row.status,
          npsRequestedAt: row.npsRequestedAt,
          patientHasContact,
        },
        now,
      );
      if (!eligible) continue;

      // Phase 17 Wave 1 — NPS is borderline transactional ("we just saw
      // you"), but the roadmap classifies it as marketing because the
      // patient should be able to silence "rate us" prompts without
      // losing legitimate visit reminders.
      const consent = isAllowedToReceive(row.patient, "marketing");
      if (!consent.allowed) continue;

      // Stamp only once a row exists (audit TG-09): stamping first marked
      // every visit «запрошено» while no template existed to send.
      try {
        const outcome = await onNpsRequest(row.id);
        if (outcome.created > 0 || outcome.reason === "already_scheduled") {
          await prisma.appointment.updateMany({
            where: { id: row.id, npsRequestedAt: null },
            data: { npsRequestedAt: now },
          });
          requested += 1;
        } else if (outcome.reason === "no_template") {
          missingTemplate.add(row.clinicId);
        }
      } catch (err) {
        console.error(`[post-visit-nps] appointment ${row.id} failed`, err);
      }
    }

    for (const clinicId of missingTemplate) {
      console.warn(
        `[post-visit-nps] clinic ${clinicId}: template appointment.nps-request is switched off, rating requests not sent`,
      );
    }
    return { scanned: rows.length, requested };
  });
}

/** Start the worker (idempotent). */
export function startPostVisitNpsWorker(
  intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(QUEUE_NAME, JOB_NAME, async () => {
    try {
      await runPostVisitNpsTick();
    } catch (err) {
      console.error("[post-visit-nps] tick failed", err);
    }
  });
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] post-visit-nps registered");
  return handle;
}

export { runPostVisitNpsTick as _runForTests };
