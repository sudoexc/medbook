/**
 * Clinic average completed-visit price.
 *
 * Single source of truth for "how much is one booked visit worth on average
 * at this clinic, right now?" — used by the Action Center money columns
 * (no-show loss, unconfirmed pipeline, missed-request/missed-call expected
 * recovery). Pulls the trailing 90 days of `Appointment.priceFinal` where
 * `status = COMPLETED`. Returns `0` if the clinic has no paid history yet;
 * callers fall back to a constant in that case.
 *
 * All values are tiins (UZS × 100).
 */
import { prisma } from "@/lib/prisma";

const HISTORY_DAYS = 90;

export async function getClinicAvgVisitTiins(now: Date = new Date()): Promise<number> {
  const from = new Date(now);
  from.setDate(from.getDate() - HISTORY_DAYS);

  const agg = await prisma.appointment.aggregate({
    where: {
      status: "COMPLETED",
      completedAt: { gte: from, lte: now },
      priceFinal: { gt: 0 },
    },
    _avg: { priceFinal: true },
  });

  const avg = agg._avg.priceFinal ?? 0;
  return Math.round(avg);
}
