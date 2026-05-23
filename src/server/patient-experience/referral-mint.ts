/**
 * Phase 16 Wave 3 — Referral reward minting on first COMPLETED appointment.
 *
 * Wired into the appointment-completion path (`PATCH
 * /api/crm/appointments/:id` when `body.status === "COMPLETED"`).
 *
 * Behaviour:
 *   1. Reads `Lead.referrerPatientId` for the appointment's patient
 *      (populated when the friend redeemed a referral code at sign-up
 *      via the bot or the Mini App booking flow).
 *   2. Confirms this is the patient's FIRST completed appointment in the
 *      clinic — anything later doesn't qualify (one reward per friend pair).
 *   3. Creates `ReferralReward(referrerPatientId, referredPatientId,
 *      rewardPercent, expiresAt)` with status PENDING. The unique
 *      constraint on (referrerPatientId, referredPatientId) makes the
 *      whole helper idempotent — a duplicate insert silently no-ops.
 *   4. Increments the `ReferralCode.useCount` for the redeemed code.
 *   5. Audits `REFERRAL_REWARD_EARNED` and emits a `referral.reward-earned`
 *      notification trigger so the worker pushes the referrer.
 *
 * Failure mode: any throw inside the mint is caught & logged. The
 * appointment-COMPLETED transition itself never rolls back on a referral
 * problem — the patient already showed up.
 */
import type { prisma as prismaT } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { defaultRewardExpiry } from "@/lib/patient-experience/referral-reward";
import { fireTrigger } from "@/server/notifications/triggers";

// Narrowed from `Prisma.TransactionClient | typeof prismaT` — the union
// confused TS's overload resolution (TS2349). Real callers pass the
// extended `prisma`; a transaction client would need an explicit cast at
// the call site.
type Tx = typeof prismaT;

export async function mintReferralRewardOnCompletion(opts: {
  tx: Tx;
  request: Request;
  clinicId: string;
  appointmentId: string;
  patientId: string;
}): Promise<{ minted: boolean; rewardId: string | null }> {
  const { tx, request, clinicId, appointmentId, patientId } = opts;

  // Find the lead row that records who referred this patient. If there's no
  // referrer, we're done.
  const lead = await tx.lead.findFirst({
    where: { clinicId, patientId, referrerPatientId: { not: null } },
    select: { id: true, referrerPatientId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!lead || !lead.referrerPatientId) {
    return { minted: false, rewardId: null };
  }

  // Was this the FIRST completion for this patient? Count any sibling that
  // already has a `completedAt` other than the current appointment.
  const earlierCompleted = await tx.appointment.count({
    where: {
      clinicId,
      patientId,
      id: { not: appointmentId },
      completedAt: { not: null },
    },
  });
  if (earlierCompleted > 0) {
    return { minted: false, rewardId: null };
  }

  const clinic = await tx.clinic.findUnique({
    where: { id: clinicId },
    select: { referralRewardPercent: true },
  });
  const rewardPercent = clinic?.referralRewardPercent ?? 15;
  if (rewardPercent <= 0) {
    return { minted: false, rewardId: null };
  }

  // Create the reward — unique (referrerPatientId, referredPatientId) makes
  // re-runs a no-op.
  let reward;
  try {
    reward = await tx.referralReward.create({
      data: {
        clinicId,
        referrerPatientId: lead.referrerPatientId,
        referredPatientId: patientId,
        rewardPercent,
        status: "PENDING",
        expiresAt: defaultRewardExpiry(),
      },
      select: { id: true },
    });
  } catch {
    // Most likely: unique violation. Some other path already minted; bail.
    return { minted: false, rewardId: null };
  }

  // Bump the referrer's code use-count if a code is on file.
  try {
    await tx.referralCode.updateMany({
      where: { clinicId, referrerPatientId: lead.referrerPatientId },
      data: { useCount: { increment: 1 } },
    });
  } catch {
    // Non-fatal — telemetry only.
  }

  // Audit + fire the push-side trigger. Failure here doesn't roll back the
  // reward row.
  try {
    await audit(request, {
      action: AUDIT_ACTION.REFERRAL_REWARD_EARNED,
      entityType: "ReferralReward",
      entityId: reward.id,
      meta: {
        clinicId,
        referrerPatientId: lead.referrerPatientId,
        referredPatientId: patientId,
        appointmentId,
        rewardPercent,
      },
    });
  } catch (e) {
    console.error("[referral] audit failed", e);
  }

  try {
    fireTrigger({
      kind: "referral.reward-earned",
      clinicId,
      patientId: lead.referrerPatientId,
      rewardId: reward.id,
    });
  } catch (e) {
    console.error("[referral] trigger fire failed", e);
  }

  return { minted: true, rewardId: reward.id };
}
