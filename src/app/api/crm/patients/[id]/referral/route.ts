/**
 * /api/crm/patients/[id]/referral — Phase 16 Wave 3.
 *
 * Read-only summary of the referral state for the CRM patient card:
 *   - the patient's persistent code + useCount (or null if they never
 *     opened the Mini App refer screen)
 *   - pending / applied / expired reward counts + the most recent rows
 *   - the friend they were referred BY (if `Lead.referrerPatientId` was
 *     populated at sign-up)
 *
 * No POST — all mutations go through the Mini App or the appointment
 * route's auto-mint hook.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/referral
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();

    const code = await prisma.referralCode.findFirst({
      where: { clinicId: patient.clinicId, referrerPatientId: id },
      select: { code: true, useCount: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const rewards = await prisma.referralReward.findMany({
      where: { clinicId: patient.clinicId, referrerPatientId: id },
      select: {
        id: true,
        status: true,
        rewardPercent: true,
        createdAt: true,
        appliedAt: true,
        expiresAt: true,
        referredPatient: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Was THIS patient referred by someone? Pull from the lead row.
    const referredByLead = await prisma.lead.findFirst({
      where: {
        clinicId: patient.clinicId,
        patientId: id,
        referrerPatientId: { not: null },
      },
      select: { referrerPatientId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    let referredBy: { id: string; fullName: string } | null = null;
    if (referredByLead?.referrerPatientId) {
      const ref = await prisma.patient.findFirst({
        where: { id: referredByLead.referrerPatientId, clinicId: patient.clinicId },
        select: { id: true, fullName: true },
      });
      if (ref) referredBy = ref;
    }

    return ok({
      code: code?.code ?? null,
      useCount: code?.useCount ?? 0,
      createdAt: code?.createdAt?.toISOString() ?? null,
      pendingCount: rewards.filter((r) => r.status === "PENDING").length,
      appliedCount: rewards.filter((r) => r.status === "APPLIED").length,
      expiredCount: rewards.filter((r) => r.status === "EXPIRED").length,
      rewards: rewards.map((r) => ({
        id: r.id,
        status: r.status,
        rewardPercent: r.rewardPercent,
        createdAt: r.createdAt.toISOString(),
        appliedAt: r.appliedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt.toISOString(),
        friend: r.referredPatient,
      })),
      referredBy,
    });
  },
);
