/**
 * /api/crm/doctors/me/patients/[patientId]/prescriptions — list of
 * prescriptions for this patient that the calling doctor is allowed to see.
 *
 * Anti-leak: caller must have had at least one appointment with the patient.
 * Visibility scope: `Prescription.doctorId === me` (we don't expose another
 * doctor's prescription, even within the same case). The patient's full
 * medication list is intentionally elsewhere — this view is the "what I
 * prescribed to them" subset for the reception session-tab + patient
 * detail page.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // Defaults to ACTIVE+PAUSED only. Pass `status=all` to include COMPLETED
  // / CANCELLED.
  status: z.enum(["all", "active"]).default("active"),
});

type PrescriptionRow = {
  id: string;
  drugName: string;
  dosage: string;
  schedule: unknown;
  notes: string | null;
  status: string;
  remindersEnabled: boolean;
  caseId: string | null;
  createdAt: string;
  updatedAt: string;
};

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("prescriptions");
  if (idx <= 0) return "";
  return parts[idx - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const patientId = patientIdFromUrl(request);
    if (!patientId) {
      return err("BadRequest", 400, { reason: "missing_patient_id" });
    }

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) return notFound();

    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) return notFound();

    const statusFilter =
      q.status === "all" ? {} : { status: { in: ["ACTIVE", "PAUSED"] } };

    const take = q.limit + 1;
    const rows = await prisma.prescription.findMany({
      where: {
        patientId,
        doctorId: doctor.id,
        ...statusFilter,
      },
      select: {
        id: true,
        drugName: true,
        dosage: true,
        schedule: true,
        notes: true,
        status: true,
        remindersEnabled: true,
        caseId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const out: PrescriptionRow[] = rows.map((p) => ({
      id: p.id,
      drugName: p.drugName,
      dosage: p.dosage,
      schedule: p.schedule,
      notes: p.notes,
      status: p.status,
      remindersEnabled: p.remindersEnabled,
      caseId: p.caseId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return ok({ rows: out, nextCursor });
  },
);
