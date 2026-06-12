/**
 * Wave 3c — «Что сказал врач» visit summary (Mini App).
 *
 * GET /api/miniapp/visit-summary/:appointmentId
 *
 * Returns the FINALIZED VisitNote for the patient's own (or family-linked,
 * via `?onBehalfOf=`) appointment: diagnosis, the patient-facing handout
 * markdown, follow-up date and the conclusion PDF link. DRAFT notes are
 * invisible to the patient by design — until the doctor finalizes, the
 * screen shows «заключение готовится».
 *
 * `followUpNote` is intentionally NOT returned: it is reception-internal
 * (same rule as the appointments list route). The patient sees only the
 * computed follow-up date.
 */
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";

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
      patientHandoutMarkdown: true,
      followUpDays: true,
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

  const anchor = note.finalizedAt ?? note.appointment.date;
  return ok({
    summary: {
      appointmentId,
      date: note.appointment.date,
      time: note.appointment.time,
      finalizedAt: note.finalizedAt,
      documentNumber: note.documentNumber,
      diagnosisName: note.diagnosisName,
      handoutMarkdown: note.patientHandoutMarkdown,
      doctor: note.doctor,
      followUpAt:
        note.followUpDays != null && note.followUpDays > 0
          ? new Date(
              anchor.getTime() + note.followUpDays * 24 * 60 * 60 * 1000,
            ).toISOString()
          : null,
      conclusionUrl: note.conclusionDocument
        ? `/api/miniapp/documents/${note.conclusionDocument.id}/file?clinicSlug=${encodeURIComponent(ctx.clinicSlug)}`
        : null,
    },
  });
});
