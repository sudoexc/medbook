/**
 * GET /api/crm/onboarding-status — aggregated setup progress for the clinic.
 *
 * Returns counts and a `complete` flag so the dashboard can show a
 * progressive setup checklist while the clinic team fills the basics.
 * "clinic.configured" means phone is filled and at least one address
 * field is non-empty — those are the minimum viable contact details
 * surfaced on the public mini-app and patient receipts.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const [clinic, cabinets, services, doctors] = await Promise.all([
      prisma.clinic.findUnique({
        where: { id: ctx.clinicId },
        select: { phone: true, addressRu: true, addressUz: true },
      }),
      prisma.cabinet.count({ where: { isActive: true } }),
      prisma.service.count({ where: { isActive: true } }),
      prisma.doctor.count({ where: { isActive: true } }),
    ]);

    if (!clinic) return notFound();

    const clinicConfigured = Boolean(
      clinic.phone && (clinic.addressRu || clinic.addressUz),
    );

    const steps = {
      clinic: clinicConfigured,
      cabinets: cabinets > 0,
      services: services > 0,
      doctors: doctors > 0,
    };
    const complete = Object.values(steps).every(Boolean);

    return ok({
      steps,
      counts: { cabinets, services, doctors },
      complete,
    });
  },
);
