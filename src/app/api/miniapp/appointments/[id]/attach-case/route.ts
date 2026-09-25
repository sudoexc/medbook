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
 * Only the visit the patient just booked and is filing is accepted: still
 * case-less, booked in the Mini App, BOOKED/CONFIRMED, in the future, with no
 * money on it. Anything else answers 409 (see `miniAppAttachRefusal`): both
 * branches re-price through `attachAppointmentToCase`, so a follow-up filed
 * under an open case inside the free-repeat window becomes free here exactly
 * as it would at the CRM desk (audit PT-02), and without the gate a crafted
 * call could move any of the patient's visits into an old case and zero it.
 * The eligibility read runs inside the attach transaction under the
 * per-patient case lock, so two racing picks can't both see «case-less».
 *
 * Spec: docs/TZ.md §6.10.2-6, MedicalCase task brief.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { conflict, err, notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  attachAppointmentToCase,
  auditFreeRepeats,
  lockPatientCases,
  MINIAPP_ATTACH_PAYMENT_FILTER,
  miniAppAttachRefusal,
  type CaseAttachAuditActor,
  type MiniAppAttachRefusal,
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

type AttachOutcome =
  | { kind: "not_found" }
  | { kind: "refused"; reason: MiniAppAttachRefusal }
  | { kind: "case_not_open" }
  | { kind: "created" | "attached"; caseId: string; title: string };

export const POST = createMiniAppHandler(
  { bodySchema: Body },
  async ({ request, body, ctx }) => {
    const appointmentId = appointmentIdFromUrl(request);

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

    const out = await prisma.$transaction(async (tx): Promise<AttachOutcome> => {
      await lockPatientCases(tx, ctx.patientId);

      const appt = await tx.appointment.findFirst({
        where: {
          id: appointmentId,
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
        },
        select: {
          id: true,
          doctorId: true,
          date: true,
          medicalCaseId: true,
          status: true,
          channel: true,
          payments: { where: MINIAPP_ATTACH_PAYMENT_FILTER, select: { id: true } },
        },
      });
      if (!appt) return { kind: "not_found" };
      const refusal = miniAppAttachRefusal(appt, new Date());
      if (refusal) return { kind: "refused", reason: refusal };

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
        // The gate above guarantees the visit had no case to leave.
        const results = await attachAppointmentToCase(tx, {
          appointmentId: appt.id,
          caseId: c.id,
          previousCaseId: null,
        });
        await auditFreeRepeats(tx, who, c.id, results, "miniapp_attach");
        return { kind: "created", caseId: c.id, title: c.title };
      }

      // Branch 2 — attach to an existing OPEN case the patient picked.
      const target = await tx.medicalCase.findFirst({
        where: {
          id: body.caseId!,
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
        },
        select: { id: true, title: true, status: true },
      });
      if (!target) return { kind: "not_found" };
      if (target.status !== "OPEN") return { kind: "case_not_open" };
      const results = await attachAppointmentToCase(tx, {
        appointmentId: appt.id,
        caseId: target.id,
        previousCaseId: null,
      });
      await auditFreeRepeats(tx, who, target.id, results, "miniapp_attach");
      return { kind: "attached", caseId: target.id, title: target.title };
    });

    switch (out.kind) {
      case "not_found":
        return notFound();
      case "refused":
        return conflict(out.reason);
      case "case_not_open":
        return err("case_not_open", 400, { reason: "case_not_open" });
      default:
        return ok({ caseId: out.caseId, kind: out.kind, title: out.title });
    }
  },
);
