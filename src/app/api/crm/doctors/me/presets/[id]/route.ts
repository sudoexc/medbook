/**
 * PATCH /api/crm/doctors/me/presets/[id]  — edit a single preset.
 * DELETE /api/crm/doctors/me/presets/[id] — soft-delete (active=false).
 *
 * Always scoped to the calling doctor's own rows. Soft delete keeps history
 * for the audit log + allows un-archiving from the settings UI.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";

const PatchBody = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  fieldValue: z.string().trim().min(1).max(200).optional(),
  noteTemplate: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

function presetIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../doctors/me/presets/{id}
  return parts[parts.length - 1] ?? "";
}

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = presetIdFromUrl(request);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });

    const existing = await prisma.doctorPreset.findFirst({
      where: { id, doctorId: doctor.id },
      select: { id: true },
    });
    if (!existing) return notFound();

    const data: Record<string, unknown> = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.fieldValue !== undefined) data.fieldValue = body.fieldValue;
    if (body.noteTemplate !== undefined) data.noteTemplate = body.noteTemplate;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.active !== undefined) data.active = body.active;
    if (Object.keys(data).length === 0) {
      return err("BadRequest", 400, { reason: "no_fields_to_update" });
    }

    const updated = await prisma.doctorPreset.update({
      where: { id },
      data,
      select: {
        id: true,
        field: true,
        label: true,
        fieldValue: true,
        noteTemplate: true,
        sortOrder: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return ok({
      id: updated.id,
      field: updated.field,
      label: updated.label,
      fieldValue: updated.fieldValue,
      noteTemplate: updated.noteTemplate,
      sortOrder: updated.sortOrder,
      active: updated.active,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  },
);

export const DELETE = createApiHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = presetIdFromUrl(request);
    if (!id) return err("BadRequest", 400, { reason: "missing_id" });

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });

    const existing = await prisma.doctorPreset.findFirst({
      where: { id, doctorId: doctor.id },
      select: { id: true },
    });
    if (!existing) return notFound();

    // Hard delete — these are user-created config rows with no foreign-key
    // dependents and no audit-of-record semantics. The UI shows them as a
    // simple list; users expect "delete" to actually remove.
    await prisma.doctorPreset.delete({ where: { id } });

    return ok({ id, deleted: true });
  },
);
