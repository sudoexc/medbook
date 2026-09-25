/**
 * POST /api/miniapp/appointments/[id]/attach-case?clinicSlug=…
 *
 * Patient-facing case-attach endpoint. Called from the Mini App after the
 * booking POST returned `caseAttach.kind === "needs_choice"` and the patient
 * picked an option:
 *
 *   - "Новая жалоба" / "Yangi shikoyat"          → body.create = true
 *   - "продолжение лечения" / existing case      → body.caseId = "..."
 *
 * Patient-scoped: the appointment AND the case must both belong to the
 * authenticated patient. A failure here is non-fatal client-side — the
 * appointment is already booked; the patient just won't have a case linked.
 *
 * Both branches link through `attachAppointmentToCase`, which re-prices the
 * visit and its case siblings in the same transaction: a follow-up the
 * patient files under an open case inside the free-repeat window becomes
 * free here exactly as it would at the CRM desk (audit PT-02).
 *
 * Spec: docs/TZ.md §6.10.2-6, MedicalCase task brief.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { err, notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  attachAppointmentToCase,
  auditFreeRepeats,
  type CaseAttachAuditActor,
} from "@/server/cases/attach";

const Body = z
  .object({
    caseId: z.string().min(1).optional(),
    create: z.boolean().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    primaryComplaint: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.caseId || v.create, {
    message: "caseId_or_create_required",
  });

function appointmentIdFromUrl(request: Request): string {
  // /api/miniapp/appointments/[id]/attach-case → segment[-2]
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const POST = createMiniAppHandler(
  { bodySchema: Body },
  async ({ request, body, ctx }) => {
    const appointmentId = appointmentIdFromUrl(request);

    const appt = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
      },
      select: { id: true, doctorId: true, date: true, medicalCaseId: true },
    });
    if (!appt) return notFound();

    const who: CaseAttachAuditActor = {
      clinicId: ctx.clinicId,
      actor: {
        role: "PATIENT",
        userId: null,
        patientId: ctx.patientId,
        onBehalfOfPatientId: null,
        label: `patient:${ctx.patientId}`,
      },
      surface: "MINIAPP",
    };

    // Branch 1 — create a brand-new case from the patient's wording.
    if (body.create) {
      const isUz = ctx.patient.preferredLang === "UZ";
      const dStr = appt.date.toLocaleDateString(
        isUz ? "uz-Latn-UZ" : "ru-RU",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "Asia/Tashkent",
        },
      );
      const fallbackTitle = isUz
        ? `Yangi shikoyat, ${dStr}`
        : `Новая жалоба, ${dStr}`;
      const created = await prisma.$transaction(async (tx) => {
        const c = await tx.medicalCase.create({
          data: {
            clinicId: ctx.clinicId,
            patientId: ctx.patientId,
            title: body.title?.trim() || fallbackTitle,
            primaryDoctorId: appt.doctorId,
            primaryComplaint: body.primaryComplaint?.trim() || null,
            status: "OPEN",
          },
          select: { id: true, title: true },
        });
        // Leaving another case can turn a visit left behind back into a
        // paid «first» one, so the old case is re-priced too.
        const results = await attachAppointmentToCase(tx, {
          appointmentId: appt.id,
          caseId: c.id,
          previousCaseId: appt.medicalCaseId,
        });
        await auditFreeRepeats(tx, who, c.id, results, "miniapp_attach");
        return c;
      });
      return ok({ caseId: created.id, kind: "created", title: created.title });
    }

    // Branch 2 — attach to an existing OPEN case the patient picked.
    const target = await prisma.medicalCase.findFirst({
      where: {
        id: body.caseId!,
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
      },
      select: { id: true, title: true, status: true },
    });
    if (!target) return notFound();
    if (target.status !== "OPEN") {
      return err("case_not_open", 400, { reason: "case_not_open" });
    }
    await prisma.$transaction(async (tx) => {
      const results = await attachAppointmentToCase(tx, {
        appointmentId: appt.id,
        caseId: target.id,
        previousCaseId: appt.medicalCaseId,
      });
      await auditFreeRepeats(tx, who, target.id, results, "miniapp_attach");
    });
    return ok({ caseId: target.id, kind: "attached", title: target.title });
  },
);
