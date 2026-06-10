/**
 * /api/crm/visit-notes/[id] — GET single note, PATCH autosave.
 *
 * PATCH is hit by the reception editor with 1.5s debounce; allow only DRAFT
 * notes to be mutated by the owning doctor. FINALIZED notes are read-only
 * via this route (Phase 4 will add a 24h edit window with its own gate).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, forbidden, notFound } from "@/server/http";
import { UpdateVisitNoteSchema } from "@/server/schemas/visit-note";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const note = await prisma.visitNote.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
        appointment: { select: { id: true, date: true, status: true } },
        doctor: {
          select: {
            specializationRu: true,
            specializationUz: true,
            user: { select: { name: true } },
          },
        },
        clinic: { select: { nameRu: true, nameUz: true } },
        visitPrescriptions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!note) return notFound();

    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || doctor.id !== note.doctorId) return forbidden();
    }

    return ok(note);
  },
);

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: UpdateVisitNoteSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const id = idFromUrl(request);
    const before = await prisma.visitNote.findUnique({ where: { id } });
    if (!before) return notFound();

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor || doctor.id !== before.doctorId) return forbidden();

    if (before.status === "FINALIZED") {
      // 24h post-finalization edit window. Beyond that the note is locked.
      const finalizedAt = before.finalizedAt?.getTime() ?? null;
      const edgeMs = finalizedAt != null ? Date.now() - finalizedAt : Infinity;
      if (edgeMs > 24 * 60 * 60 * 1000) {
        return err("Forbidden", 403, { reason: "edit_window_expired" });
      }
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      "complaints",
      "anamnesis",
      "examination",
      "prescriptions",
      "advice",
    ] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.diagnosisCode !== undefined) data.diagnosisCode = body.diagnosisCode;
    if (body.diagnosisName !== undefined) data.diagnosisName = body.diagnosisName;
    if (body.bodyMarkdown !== undefined) data.bodyMarkdown = body.bodyMarkdown;
    if (body.patientHandoutMarkdown !== undefined) {
      data.patientHandoutMarkdown = body.patientHandoutMarkdown;
    }
    if (body.followUpDays !== undefined) data.followUpDays = body.followUpDays;
    if (body.followUpNote !== undefined) data.followUpNote = body.followUpNote;

    const changedFields = Object.keys(data);
    const rxRows = body.visitPrescriptions;
    if (rxRows !== undefined) changedFields.push("visitPrescriptions");
    const correlationId = newCorrelationId();
    const actorUserId = ctx.userId || null;

    const updated = await prisma.$transaction(async (tx) => {
      // Ф2 — structured prescriptions: replace-all, consistent with the
      // autosave model (the editor always sends the full current list).
      // Runs before the note update so the returned include is fresh.
      if (rxRows !== undefined) {
        await tx.visitPrescription.deleteMany({
          where: { visitNoteId: id },
        });
        if (rxRows.length > 0) {
          await tx.visitPrescription.createMany({
            data: rxRows.map((r, i) => ({
              visitNoteId: id,
              drugId: r.drugId ?? null,
              displayName: r.displayName,
              form: r.form ?? null,
              strength: r.strength ?? null,
              dose: r.dose,
              timesOfDay: r.timesOfDay,
              mealRelation: r.mealRelation,
              durationDays: r.durationDays ?? null,
              instructionRu: r.instructionRu ?? null,
              instructionUz: r.instructionUz ?? null,
              remindPatient: r.remindPatient,
              sortOrder: i,
              // clinicId is injected by the tenant extension at runtime.
            })) as never,
          });
        }
      }

      const row = await tx.visitNote.update({
        where: { id },
        data: data as never,
        include: { visitPrescriptions: { orderBy: { sortOrder: "asc" } } },
      });

      // Skip the envelope when the autosave was a no-op — the editor sends a
      // PATCH on every debounced keystroke even if nothing changed.
      if (changedFields.length > 0) {
        const envelope: EventEnvelopeInput = {
          type: "visit-note.draftSaved",
          correlationId,
          actor: {
            role: "DOCTOR",
            userId: actorUserId,
            patientId: null,
            onBehalfOfPatientId: null,
            label: actorUserId ? `user:${actorUserId}` : "user:anonymous",
          },
          surface: "DOCTOR_CABINET",
          tenantScope: {
            clinicId: before.clinicId,
            doctorId: before.doctorId,
            patientId: before.patientId,
            appointmentId: before.appointmentId ?? undefined,
          },
          payload: {
            visitNoteId: row.id,
            appointmentId: row.appointmentId ?? undefined,
            doctorId: row.doctorId,
            patientId: row.patientId,
            changedFields,
          },
        };
        await publishViaOutbox(tx, envelope);
      }
      return row;
    });

    await audit(request, {
      action: "visit_note.update",
      entityType: "VisitNote",
      entityId: id,
      meta: { fields: changedFields, correlationId },
    });

    return ok(updated);
  },
);
