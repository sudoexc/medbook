/**
 * Doctor-personal preset chips for the reception ChipFieldCard.
 *
 *   GET  /api/crm/doctors/me/presets[?field=COMPLAINTS]   — list, ordered by sortOrder.
 *   POST /api/crm/doctors/me/presets                       — create.
 *
 * One row = one chip. Click on `/doctor/reception` adds `fieldValue` to the
 * matching structured array on VisitNote AND appends `noteTemplate` to
 * bodyMarkdown via the editor's inject channel.
 *
 * Always scoped to the authenticated doctor — `doctorId` is resolved from
 * `ctx.userId`, never trusted from the body. No audit/SSE: these are
 * personal config, not patient data.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";

const FIELDS = ["COMPLAINTS", "ANAMNESIS", "EXAMINATION", "PRESCRIPTIONS", "ADVICE"] as const;

const QuerySchema = z.object({
  field: z.enum(FIELDS).optional(),
});

const CreateBody = z.object({
  field: z.enum(FIELDS),
  label: z.string().trim().min(1).max(80),
  fieldValue: z.string().trim().min(1).max(200),
  noteTemplate: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { field } = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });

    const rows = await prisma.doctorPreset.findMany({
      where: { doctorId: doctor.id, active: true, ...(field ? { field } : {}) },
      orderBy: [{ field: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
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
      rows: rows.map((r) => ({
        id: r.id,
        field: r.field,
        label: r.label,
        fieldValue: r.fieldValue,
        noteTemplate: r.noteTemplate,
        sortOrder: r.sortOrder,
        active: r.active,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  },
);

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: CreateBody },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "no_doctor_row_for_user" });

    const created = await prisma.doctorPreset.create({
      data: {
        clinicId: ctx.clinicId,
        doctorId: doctor.id,
        field: body.field,
        label: body.label,
        fieldValue: body.fieldValue,
        noteTemplate: body.noteTemplate ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
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

    return ok(
      {
        id: created.id,
        field: created.field,
        label: created.label,
        fieldValue: created.fieldValue,
        noteTemplate: created.noteTemplate,
        sortOrder: created.sortOrder,
        active: created.active,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      201,
    );
  },
);
