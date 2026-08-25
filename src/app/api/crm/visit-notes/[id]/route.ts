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
import { ok, err, forbidden, notFound, conflict } from "@/server/http";
import { UpdateVisitNoteSchema } from "@/server/schemas/visit-note";
import { isEditWindowExpired } from "@/server/visit-notes/edit-window";
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
      // 24h post-finalization edit window. Beyond that the note is locked —
      // corrections switch to the append-only amendment flow (see
      // .../amendments/route.ts for the medico-legal rationale).
      if (isEditWindowExpired(before.finalizedAt)) {
        return err("Forbidden", 403, { reason: "edit_window_expired" });
      }
    }

    // Optimistic locking — the same note can be open in the reception editor
    // and in /doctor/conclusions/[id] at once. Without a version check the
    // slower window silently erases the faster one (worst failure class for a
    // clinical document). When the client sends the `updatedAt` it last saw,
    // reject the write if the row moved on; the client shows the doctor an
    // explicit "changed in another window" message instead of overwriting.
    // Compare on epoch millis: Prisma serialises DateTime via toISOString(),
    // so a round-tripped token is millisecond-exact.
    if (body.expectedUpdatedAt != null) {
      const expectedMs = Date.parse(body.expectedUpdatedAt);
      if (expectedMs !== before.updatedAt.getTime()) {
        return conflict("version_conflict", {
          currentUpdatedAt: before.updatedAt.toISOString(),
        });
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
    if (body.dynamics !== undefined) data.dynamics = body.dynamics;
    if (body.dynamicsNote !== undefined) data.dynamicsNote = body.dynamicsNote;
    // Ф8 — replace-all, как visitPrescriptions; очистка = пустой массив
    // (plain null в Json-колонку Prisma не принимает).
    if (body.bodyMap !== undefined) data.bodyMap = body.bodyMap;

    const changedFields = Object.keys(data);
    const rxRows = body.visitPrescriptions;
    if (rxRows !== undefined) changedFields.push("visitPrescriptions");

    // A finalized note already has its CONCLUSION PDF rendered (the patient
    // sees it in the Mini App and via the QR link), so an accepted in-window
    // edit makes that file stale. Stamp the convergence anchor; the handout
    // worker sweeps it up and re-renders IN PLACE — same MinIO key, same
    // verifyToken, same documentNumber — so the printed QR keeps resolving.
    // Deliberately after changedFields is captured: the anchor is a technical
    // field and must not appear in the audit/event field list.
    if (before.status === "FINALIZED" && changedFields.length > 0) {
      data.handoutStaleAt = new Date();
    }

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
