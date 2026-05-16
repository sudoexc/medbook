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

    const updated = await prisma.visitNote.update({
      where: { id },
      data: data as never,
    });

    await audit(request, {
      action: "visit_note.update",
      entityType: "VisitNote",
      entityId: id,
      meta: { fields: Object.keys(data) },
    });

    return ok(updated);
  },
);
