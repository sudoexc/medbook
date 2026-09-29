/**
 * Wave 3c — «Что сказал врач» visit summary (Mini App).
 *
 * GET /api/miniapp/visit-summary/:appointmentId
 *
 * Returns the FINALIZED VisitNote for the patient's own (or family-linked,
 * via `?onBehalfOf=`) appointment: diagnoses, the patient-facing handout
 * markdown, follow-up date and the conclusion PDF link. DRAFT notes are
 * invisible to the patient by design — until the doctor finalizes, the
 * screen shows «заключение готовится».
 *
 * `followUpNote` is intentionally NOT returned: it is reception-internal
 * (same rule as the appointments list route). The patient sees only the
 * computed follow-up date, and whether the doctor named that very day.
 */
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import { miniAppDocumentUrl } from "@/server/miniapp/link-token";
import { parseAdditionalDiagnoses } from "@/lib/visit-diagnoses";
import { miniAppFollowUp } from "@/server/miniapp/appointment-view";

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // .../visit-summary/<appointmentId>
  const appointmentId = segments[segments.length - 1] ?? "";
  if (!appointmentId) return err("missing_appointment_id", 400);

  const onBehalfOf = url.searchParams.get("onBehalfOf");
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return err(acting.reason, 403);

  const note = await prisma.visitNote.findFirst({
    where: {
      clinicId: ctx.clinicId,
      appointmentId,
      patientId: acting.patientId,
      status: "FINALIZED",
    },
    select: {
      diagnosisName: true,
      additionalDiagnoses: true,
      patientHandoutMarkdown: true,
      followUpDays: true,
      followUpDate: true,
      finalizedAt: true,
      documentNumber: true,
      conclusionDocument: { select: { id: true } },
      doctor: {
        select: {
          id: true,
          nameRu: true,
          nameUz: true,
          specializationRu: true,
          specializationUz: true,
        },
      },
      appointment: { select: { date: true, time: true } },
    },
  });
  if (!note) return ok({ summary: null });

  return ok({
    summary: {
      appointmentId,
      date: note.appointment.date,
      time: note.appointment.time,
      finalizedAt: note.finalizedAt,
      documentNumber: note.documentNumber,
      diagnosisName: note.diagnosisName,
      // The visit's other diagnoses, by name: the patient's view never
      // carries ICD codes (same rule as the handout).
      additionalDiagnosisNames: parseAdditionalDiagnoses(
        note.additionalDiagnoses,
      ).map((d) => d.name),
      handoutMarkdown: note.patientHandoutMarkdown,
      doctor: note.doctor,
      ...miniAppFollowUp(note, note.appointment.date),
      // A link for this one conclusion, never initData (MA-07).
      conclusionUrl: note.conclusionDocument
        ? miniAppDocumentUrl({
            clinicId: ctx.clinicId,
            clinicSlug: ctx.clinicSlug,
            patientId: acting.patientId,
            documentId: note.conclusionDocument.id,
          })
        : null,
    },
  });
});
