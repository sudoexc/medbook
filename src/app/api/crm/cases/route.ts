/**
 * /api/crm/cases — list + create. MedicalCase = an "episode of care" that
 * groups one or more appointments around a single complaint. See the
 * MedicalCase model in prisma/schema.prisma.
 *
 * Tenant scope: handled automatically by the Prisma extension (MedicalCase
 * carries `clinicId` and is NOT in MODELS_WITHOUT_TENANT). We still verify
 * cross-entity references (patient, primaryDoctor) belong to the active
 * clinic by relying on the same auto-scope when fetching them.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, parseQuery } from "@/server/http";
import {
  CreateMedicalCaseSchema,
  QueryMedicalCaseSchema,
} from "@/server/schemas/medical-case";

const LIST_INCLUDE = {
  _count: { select: { appointments: true } },
  primaryDoctor: {
    select: { id: true, nameRu: true, nameUz: true, color: true },
  },
  patient: {
    select: { id: true, fullName: true, phone: true },
  },
} as const;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QueryMedicalCaseSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (q.patientId) where.patientId = q.patientId;
    if (q.doctorId) where.primaryDoctorId = q.doctorId;
    if (q.status && q.status.length > 0) {
      where.status = q.status.length === 1 ? q.status[0] : { in: q.status };
    }
    if (q.q && q.q.trim().length > 0) {
      where.title = { contains: q.q.trim(), mode: "insensitive" };
    }

    const take = q.limit + 1;
    // Cursor pagination is the canonical CRM list shape (matches /patients,
    // /appointments). `offset` is also accepted for callers that prefer
    // skip/limit — they are mutually exclusive; cursor wins if both are sent.
    const rows = await prisma.medicalCase.findMany({
      where,
      orderBy: { [q.sort]: q.dir },
      take,
      ...(q.cursor
        ? { skip: 1, cursor: { id: q.cursor } }
        : q.offset
          ? { skip: q.offset }
          : {}),
      include: LIST_INCLUDE,
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const total = await prisma.medicalCase.count({ where });

    return ok({ rows, nextCursor, total });
  }
);

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"],
    bodySchema: CreateMedicalCaseSchema,
  },
  async ({ request, body }) => {
    // Verify the patient belongs to this tenant. Auto-scoped by extension.
    const patient = await prisma.patient.findUnique({
      where: { id: body.patientId },
      select: { id: true },
    });
    if (!patient) {
      return err("ValidationError", 400, { reason: "patient_not_found" });
    }

    if (body.primaryDoctorId) {
      const doc = await prisma.doctor.findUnique({
        where: { id: body.primaryDoctorId },
        select: { id: true },
      });
      if (!doc) {
        return err("ValidationError", 400, { reason: "doctor_not_found" });
      }
    }

    const created = await prisma.medicalCase.create({
      data: {
        patientId: body.patientId,
        title: body.title,
        primaryDoctorId: body.primaryDoctorId ?? null,
        primaryComplaint: body.primaryComplaint ?? null,
        diagnosisText: body.diagnosisText ?? null,
        diagnosisCode: body.diagnosisCode ?? null,
        notes: body.notes ?? null,
        status: body.status ?? "OPEN",
        // openedAt defaults to now() at the DB; createdAt/updatedAt likewise.
      } as never, // tenant-scope extension injects clinicId
      include: LIST_INCLUDE,
    });

    await audit(request, {
      action: "medical_case.create",
      entityType: "MedicalCase",
      entityId: created.id,
      meta: { after: created },
    });

    return ok(created, 201);
  }
);

// Method-not-allowed hints for verbs handled by the [id] route.
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
