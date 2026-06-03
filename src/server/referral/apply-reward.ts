/**
 * Referral reward auto-apply — shared kernel.
 *
 * Phase 16 Wave 3 originally lived inline in the mini-app booking handler
 * (`src/app/api/miniapp/appointments/route.ts`). Mini-app overhaul Phase M1
 * lifts it into a shared module so the CRM booking path can opt-in too and a
 * future voice-bot / native-app surface gets it for free.
 *
 * Split into two calls because pricing must know the discount before the
 * appointment row is created (priceFinal is stored, not derived):
 *
 *   1. `findApplicableReferralReward(tx, { clinicId, patientId, priceBase })`
 *      → returns the snapshot used to compute `discountPct` / `discountAmount`
 *      on the appointment row.
 *   2. `markReferralRewardApplied(tx, { rewardId, appointmentId })`
 *      → stamps the reward APPLIED *inside the same tx* so concurrent bookings
 *      cannot double-apply.
 *
 * Both calls operate on the tx callback param (`OutboxTx`) — callers must
 * already be inside `prisma.$transaction(async (tx) => …)`.
 */

import type { OutboxTx } from "@/server/realtime/outbox";

export type ReferralRewardSnapshot = {
  rewardId: string;
  rewardPercent: number;
  discountPct: number;
  discountAmount: number;
};

/**
 * Look up the oldest PENDING, non-expired reward owned by the booking patient
 * (referrer). When found and `priceBase > 0`, compute a clamped discount
 * (0..50%) and return the snapshot. Returns `null` when no reward applies.
 *
 * The 50% cap is policy — a misconfigured tier with `rewardPercent > 50`
 * still discounts at most half the bill.
 */
export async function findApplicableReferralReward(
  tx: OutboxTx,
  input: { clinicId: string; patientId: string; priceBase: number },
): Promise<ReferralRewardSnapshot | null> {
  if (input.priceBase <= 0) return null;

  const pending = await tx.referralReward.findFirst({
    where: {
      clinicId: input.clinicId,
      referrerPatientId: input.patientId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, rewardPercent: true },
  });
  if (!pending) return null;

  const discountPct = Math.max(0, Math.min(50, Math.floor(pending.rewardPercent)));
  const discountAmount = Math.round((input.priceBase * discountPct) / 100);

  return {
    rewardId: pending.id,
    rewardPercent: pending.rewardPercent,
    discountPct,
    discountAmount,
  };
}

/**
 * Stamp the reward APPLIED + bind to the freshly-created appointment so the
 * audit trail + the redeemer's view picks it up. Called after appointment row
 * insert, before tx commit.
 */
export async function markReferralRewardApplied(
  tx: OutboxTx,
  input: { rewardId: string; appointmentId: string },
): Promise<void> {
  await tx.referralReward.update({
    where: { id: input.rewardId },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      appliedAppointmentId: input.appointmentId,
    },
  });
}
