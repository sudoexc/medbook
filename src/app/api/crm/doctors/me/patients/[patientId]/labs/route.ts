/**
 * GET /api/crm/doctors/me/patients/[patientId]/labs — every lab result
 * associated with this patient, ordered by `receivedAt DESC`.
 *
 * This is the patient-detail / reception «Анализы» tab feed. Unlike the
 * `/labs/unread` endpoint we do NOT filter by `doctorId = me` — once a
 * patient has labs in the system, every doctor who's seen them can view
 * the timeline. Anti-leak still applies: the doctor must have at least
 * one appointment with this patient to read.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/{patientId}/labs
  const idx = parts.lastIndexOf("labs");
  if (idx <= 0) return "";
  return parts[idx - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const patientId = patientIdFromUrl(request);
    if (!patientId) return err("BadRequest", 400, { reason: "missing_patient_id" });

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "no_doctor_row" });

    const patient = await prisma.patient.findFirst({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) return err("NotFound", 404);

    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) {
      return err("Forbidden", 403, { reason: "no_appointments_with_doctor" });
    }

    const take = q.limit + 1;
    const rows = await prisma.labResult.findMany({
      where: { patientId },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        testName: true,
        testCode: true,
        value: true,
        unit: true,
        refRange: true,
        flag: true,
        notes: true,
        status: true,
        receivedAt: true,
        reviewedAt: true,
        doctorId: true,
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const total = await prisma.labResult.count({ where: { patientId } });

    return ok({
      rows: rows.map((r) => ({
        id: r.id,
        testName: r.testName,
        testCode: r.testCode,
        value: r.value,
        unit: r.unit,
        refRange: r.refRange,
        flag: r.flag,
        notes: r.notes,
        status: r.status,
        receivedAt: r.receivedAt.toISOString(),
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        // Whether the calling doctor was the ordering doctor — UI can
        // show "ваш заказ" vs "от коллеги".
        orderedByMe: r.doctorId === ctx.userId,
      })),
      nextCursor,
      total,
    });
  },
);
