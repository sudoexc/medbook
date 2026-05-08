/**
 * GET /api/crm/onboarding-status — aggregated setup progress for the clinic.
 *
 * Returns booleans for each onboarding step plus a `complete` flag so the
 * dashboard can show a progressive setup checklist while the clinic team
 * fills in the basics. "clinic.configured" means phone is filled and at
 * least one address field is non-empty — those are the minimum viable
 * contact details surfaced on the public mini-app and patient receipts.
 *
 * Phase 11 (Onboarding v2) extends the original 4 steps to 9:
 *   1. clinic            — phone + address present
 *   2. cabinets          — ≥1 active cabinet
 *   3. services          — ≥1 active service
 *   4. doctors           — ≥1 active doctor
 *   5. doctorSchedule    — ≥1 active schedule slot exists
 *   6. templates         — ≥1 notification template configured
 *   7. firstPatient      — ≥1 patient registered
 *   8. firstAppointment  — ≥1 appointment booked (any status)
 *   9. tgBotConnected    — Clinic.tgBotToken is filled
 *
 * Multi-tenant safety: every `prisma.*.count` runs inside the
 * `runWithTenant` AsyncLocalStorage scope established by
 * `createApiListHandler`, so the Prisma extension auto-scopes by `clinicId`.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const [
      clinic,
      cabinets,
      services,
      doctors,
      doctorSchedules,
      templates,
      patients,
      appointments,
    ] = await Promise.all([
      prisma.clinic.findUnique({
        where: { id: ctx.clinicId },
        select: {
          phone: true,
          addressRu: true,
          addressUz: true,
          tgBotToken: true,
        },
      }),
      prisma.cabinet.count({ where: { isActive: true } }),
      prisma.service.count({ where: { isActive: true } }),
      prisma.doctor.count({ where: { isActive: true } }),
      prisma.doctorSchedule.count({ where: { isActive: true } }),
      prisma.notificationTemplate.count({ where: { isActive: true } }),
      prisma.patient.count(),
      prisma.appointment.count(),
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
      doctorSchedule: doctorSchedules > 0,
      templates: templates > 0,
      firstPatient: patients > 0,
      firstAppointment: appointments > 0,
      tgBotConnected: Boolean(clinic.tgBotToken),
    };
    const complete = Object.values(steps).every(Boolean);

    return ok({
      steps,
      counts: {
        cabinets,
        services,
        doctors,
        doctorSchedules,
        templates,
        patients,
        appointments,
      },
      complete,
    });
  },
);
