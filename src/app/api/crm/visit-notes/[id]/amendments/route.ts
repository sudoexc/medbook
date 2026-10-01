/**
 * /api/crm/visit-notes/[id]/amendments — append-only corrections to a
 * finalized conclusion.
 *
 * Medico-legal contract (why this is not a PATCH):
 *   - A finalized conclusion is an ISSUED document — documentNumber allocated,
 *     verifyToken QR printed on paper the patient already holds. Rewriting the
 *     row after the fact would make the database contradict that paper and
 *     destroy what the doctor originally signed.
 *   - So corrections past the 24h window are APPENDED: the original VisitNote
 *     is never touched (only the technical `handoutStaleAt` re-render anchor
 *     is stamped), and prints/PDFs show the original text plus an
 *     «Исправления» block.
 *   - Amendments are themselves immutable: no update/delete handlers exist by
 *     design. A wrong amendment is corrected by another amendment.
 *
 * Gates on POST, in order:
 *   - author only (doctor.id === note.doctorId — same rule as the PATCH edit),
 *   - note must be FINALIZED (a DRAFT is simply edited),
 *   - the 24h window must be OVER — inside it the doctor edits the note
 *     directly and the two correction regimes must never overlap.
 *
 * Reaching the patient (audit G3-03): the amendment commits together with a
 * `visit-note.amended` outbox event, so the visit screen open in the Mini App
 * refetches and shows the «Исправления» block (the visit summary carries
 * the amendments), and the patient is sent a message that the doctor
 * corrected his conclusion. Before, it existed only inside the re-rendered
 * PDF and nobody was told.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, forbidden, notFound, conflict } from "@/server/http";
import { CreateVisitNoteAmendmentSchema } from "@/server/schemas/visit-note";
import { isEditWindowExpired } from "@/server/visit-notes/edit-window";
import { queueAmendmentNotice } from "@/server/visit-notes/amendment-notice";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";

function idFromUrl(request: Request): string {
  // .../visit-notes/[id]/amendments — id is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

const AMENDMENT_SELECT = {
  id: true,
  visitNoteId: true,
  doctorId: true,
  reason: true,
  text: true,
  createdAt: true,
  doctor: { select: { nameRu: true, nameUz: true } },
} as const;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const note = await prisma.visitNote.findUnique({
      where: { id },
      select: { id: true, doctorId: true },
    });
    if (!note) return notFound();

    // Same visibility rule as GET /visit-notes/[id]: a doctor sees only their
    // own notes, an admin sees any note in the active clinic.
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || doctor.id !== note.doctorId) return forbidden();
    }

    const items = await prisma.visitNoteAmendment.findMany({
      where: { visitNoteId: id },
      orderBy: { createdAt: "asc" },
      select: AMENDMENT_SELECT,
    });
    return ok({ items });
  },
);

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateVisitNoteAmendmentSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);
    const note = await prisma.visitNote.findUnique({ where: { id } });
    if (!note) return notFound();

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor || doctor.id !== note.doctorId) return forbidden();

    const signedAt = note.firstFinalizedAt ?? note.finalizedAt;
    if (note.status !== "FINALIZED" && !signedAt) {
      // A never-signed draft has no issued artefact to protect — just edit
      // it. A draft that WAS signed (visit reverted) did issue one, and once
      // its window is closed an amendment is the only way to correct it.
      return conflict("not_finalized");
    }
    if (!isEditWindowExpired(signedAt)) {
      // Inside the window the direct PATCH edit is the correct tool; letting
      // both regimes run at once would fork the correction history.
      return conflict("edit_window_open");
    }

    const now = new Date();
    const amendment = await prisma.$transaction(async (tx) => {
      const row = await tx.visitNoteAmendment.create({
        data: {
          clinicId: note.clinicId,
          visitNoteId: note.id,
          doctorId: doctor.id,
          reason: body.reason,
          text: body.text,
        },
        select: AMENDMENT_SELECT,
      });
      // The ONLY write to the note: the technical re-render anchor, so the
      // handout worker appends this amendment to the patient's PDF. No
      // clinical field is touched — the original stays byte-for-byte intact.
      await tx.visitNote.update({
        where: { id: note.id },
        data: { handoutStaleAt: now },
      });
      await publishViaOutbox(tx, {
        type: "visit-note.amended",
        correlationId: newCorrelationId(),
        actor: {
          role: "DOCTOR",
          userId: ctx.userId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: `user:${ctx.userId}`,
        },
        surface: "DOCTOR_CABINET",
        tenantScope: {
          clinicId: note.clinicId,
          doctorId: note.doctorId,
          patientId: note.patientId,
          appointmentId: note.appointmentId,
        },
        payload: {
          visitNoteId: note.id,
          appointmentId: note.appointmentId,
          doctorId: note.doctorId,
          patientId: note.patientId,
          amendmentId: row.id,
        },
      });
      return row;
    });

    await audit(request, {
      action: "visit_note.amend",
      entityType: "VisitNoteAmendment",
      entityId: amendment.id,
      meta: { visitNoteId: note.id, reason: body.reason },
    });

    // Best-effort: the correction is issued whether or not the message goes.
    try {
      await queueAmendmentNotice({ clinicId: note.clinicId, visitNoteId: note.id });
    } catch (e) {
      console.error("[visit-notes/amendments] patient notice failed", e);
    }

    return ok(amendment, 201);
  },
);
