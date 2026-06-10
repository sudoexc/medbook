/**
 * GET /api/crm/visit-notes/[id]/previous — Ф7 copy-forward source.
 *
 * Возвращает последний FINALIZED VisitNote этого пациента у этого врача
 * (диагноз, чипы complaints/anamnesis, структурные назначения) либо
 * { previous: null }. Сессия приёма решает по нему сразу три вещи: показать
 * ли кнопку «Продолжить от прошлого визита», показать ли сегмент динамики
 * и что копировать.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, forbidden, notFound } from "@/server/http";
import { findPreviousFinalizedVisit } from "@/server/visit-notes/previous-visit";

function idFromUrl(request: Request): string {
  // .../visit-notes/[id]/previous — id at segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const note = await prisma.visitNote.findUnique({
      where: { id },
      select: { id: true, patientId: true, doctorId: true, finalizedAt: true },
    });
    if (!note) return notFound();

    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || doctor.id !== note.doctorId) return forbidden();
    }

    const previous = await findPreviousFinalizedVisit(note);
    return ok({ previous });
  },
);
