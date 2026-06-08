/**
 * Phase 16 Wave 2 — Post-visit NPS request worker.
 *
 * Hourly tick. For every COMPLETED appointment whose `completedAt` is
 * between `now-5h` and `now-4h`, with a TG-eligible patient, and which
 * has not yet been requested, we:
 *
 *   1. Materialise a notification through the `appointment.nps-request`
 *      trigger (TG + INAPP mirror). SMS was removed in
 *      `docs/TZ-sms-removal.md` Wave 3.
 *   2. Stamp `Appointment.npsRequestedAt = now()` to dedupe future ticks.
 *
 * The 4–5h window mirrors the pre-visit worker's design — wide enough that
 * a 60-minute tick can't miss it, narrow enough that a one-off long pause
 * in the worker process doesn't spam old appointments with NPS requests.
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

/**
 * Pure helper — does the row qualify for an NPS request right now?
 *
 * Window: completedAt in [now - 5h, now - 4h].
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
  const lower = 4 * 60 * 60 * 1000;
  const upper = 5 * 60 * 60 * 1000;
  return ms >= lower && ms <= upper;
}

export async function runPostVisitNpsTick(
  now: Date = new Date(),
): Promise<{ scanned: number; requested: number }> {
  const lower = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const upper = new Date(now.getTime() - 4 * 60 * 60 * 1000);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const rows = await prisma.appointment.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { gte: lower, lte: upper },
        npsRequestedAt: null,
        // Phase 17 Wave 1 — exclude soft-deleted patients. The marketing
        // opt-out gate is enforced per-row below.
        patient: { deletedAt: null },
      },
      select: {
        id: true,
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
    for (const row of rows) {
      const patientHasContact = Boolean(
        row.patient.telegramId || row.patient.phone,
      );
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

      try {
        await prisma.appointment.update({
          where: { id: row.id },
          data: { npsRequestedAt: now },
        });
        await onNpsRequest(row.id);
        requested += 1;
      } catch (err) {
        console.error(`[post-visit-nps] appointment ${row.id} failed`, err);
      }
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
