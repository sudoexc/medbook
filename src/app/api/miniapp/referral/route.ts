/**
 * Phase 16 Wave 3 — Mini App referral state.
 *
 * GET /api/miniapp/referral
 *   - Auto-creates a ReferralCode for the active patient on first visit
 *     (8-char alphabet, retry on UNIQUE conflict).
 *   - Returns:
 *       * `code`: the persistent share code
 *       * `useCount`: how many friends have already redeemed the code
 *       * `rewardPercent`: snapshot of the clinic's current
 *         `referralRewardPercent` (so the share copy can say "получите N%")
 *       * `pendingRewards`: ReferralReward rows in PENDING — these are the
 *         discounts that will auto-apply on the patient's next booking
 *       * `appliedRewards`: most recent 10 APPLIED rewards (history)
 *       * `expiredRewards` count — for the "X expired" footer
 *
 * Family on-behalf-of is intentionally NOT supported: a referral code
 * belongs to the actual TG-authenticated patient, not the family link
 * holder. Acting on behalf of a child would defeat the purpose.
 */
import { generateReferralCode } from "@/lib/patient-experience/referral-reward";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

const MAX_INSERT_RETRIES = 5;

async function ensureCode(
  clinicId: string,
  patientId: string,
  request: Request,
): Promise<{ code: string; useCount: number; isNew: boolean }> {
  const existing = await prisma.referralCode.findFirst({
    where: { clinicId, referrerPatientId: patientId },
    select: { code: true, useCount: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return {
      code: existing.code,
      useCount: existing.useCount,
      isNew: false,
    };
  }

  // Insert with retry on unique-conflict (extremely unlikely on an 8-char
  // alphabet of 30 symbols → 30^8 ≈ 6.5e11, but defence in depth costs a
  // millisecond).
  for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt += 1) {
    const code = generateReferralCode();
    try {
      const created = await prisma.referralCode.create({
        data: {
          clinicId,
          referrerPatientId: patientId,
          code,
          useCount: 0,
        },
        select: { code: true, useCount: true },
      });
      await audit(request, {
        action: AUDIT_ACTION.REFERRAL_CODE_GENERATED,
        entityType: "ReferralCode",
        entityId: code,
        meta: { clinicId, patientId, code },
      });
      return {
        code: created.code,
        useCount: created.useCount,
        isNew: true,
      };
    } catch (e) {
      // Unique violation on `code` — retry. Anything else bubbles.
      if (attempt === MAX_INSERT_RETRIES - 1) throw e;
    }
  }
  throw new Error("referral_code_generation_failed");
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const { code, useCount } = await ensureCode(
    ctx.clinicId,
    ctx.patientId,
    request,
  );

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: {
      referralRewardPercent: true,
      slug: true,
    },
  });

  const rewards = await prisma.referralReward.findMany({
    where: {
      clinicId: ctx.clinicId,
      referrerPatientId: ctx.patientId,
    },
    select: {
      id: true,
      status: true,
      rewardPercent: true,
      expiresAt: true,
      appliedAt: true,
      appliedAppointmentId: true,
      createdAt: true,
      referredPatient: {
        select: { id: true, fullName: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const pending = rewards.filter((r) => r.status === "PENDING");
  const applied = rewards.filter((r) => r.status === "APPLIED").slice(0, 10);
  const expiredCount = rewards.filter((r) => r.status === "EXPIRED").length;

  return ok({
    code,
    useCount,
    rewardPercent: clinic?.referralRewardPercent ?? 15,
    clinicSlug: clinic?.slug ?? ctx.clinicSlug,
    pendingRewards: pending.map((r) => ({
      id: r.id,
      rewardPercent: r.rewardPercent,
      expiresAt: r.expiresAt.toISOString(),
      friendName: r.referredPatient?.fullName ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    appliedRewards: applied.map((r) => ({
      id: r.id,
      rewardPercent: r.rewardPercent,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      appliedAppointmentId: r.appliedAppointmentId,
      friendName: r.referredPatient?.fullName ?? null,
    })),
    expiredCount,
  });
});
