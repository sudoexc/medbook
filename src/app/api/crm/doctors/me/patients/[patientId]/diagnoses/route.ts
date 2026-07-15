/**
 * /api/crm/doctors/me/patients/[patientId]/diagnoses — the patient's full
 * diagnosis history across ALL doctors in the clinic (not just the caller).
 *
 * Backs the «История диагнозов» card on the reception screen: every finalized
 * VisitNote that carries an ICD-10 code, newest first, with the code + name,
 * the visit date, and who diagnosed it. A repeat of the same code on a later
 * visit is a distinct row on purpose — this is chronological history, not the
 * deduplicated `PatientDiagnosis` problem list.
 *
 * Tenant scoping is enforced by the Prisma extension via `runWithTenant`, so a
 * patientId from another clinic falls through to an empty list. We still gate
 * on the doctor–patient relationship (≥1 appointment) so a doctor can't probe
 * arbitrary in-clinic patients — same guard as the sibling `visits` route.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type DiagnosisRow = {
  visitNoteId: string;
  appointmentId: string;
  date: string;
  diagnosisCode: string;
  diagnosisName: string | null;
  doctorName: string;
  doctorSpecialty: string | null;
};

function patientIdFromUrl(request: Request): string {
  // .../doctors/me/patients/{patientId}/diagnoses
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("diagnoses");
  if (idx <= 0) return "";
  return parts[idx - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const patientId = patientIdFromUrl(request);
    if (!patientId)
      return err("BadRequest", 400, { reason: "missing_patient_id" });

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
    if (!hasRelationship) {
      return err("Forbidden", 403, { reason: "no_appointments_with_doctor" });
    }

    const rows = await prisma.visitNote.findMany({
      where: {
        patientId,
        status: "FINALIZED",
        diagnosisCode: { not: null },
      },
      select: {
        id: true,
        appointmentId: true,
        finalizedAt: true,
        diagnosisCode: true,
        diagnosisName: true,
        doctor: { select: { nameRu: true, specializationRu: true } },
        appointment: { select: { date: true } },
      },
      orderBy: { finalizedAt: "desc" },
      take: q.limit,
    });

    const out: DiagnosisRow[] = rows.map((r) => ({
      visitNoteId: r.id,
      appointmentId: r.appointmentId,
      // Prefer the clinical date (when the visit happened); fall back to
      // finalizedAt for the rare note finalized without an appointment date.
      date: (r.appointment?.date ?? r.finalizedAt ?? new Date(0)).toISOString(),
      diagnosisCode: r.diagnosisCode ?? "",
      diagnosisName: r.diagnosisName,
      doctorName: r.doctor?.nameRu ?? "—",
      doctorSpecialty: r.doctor?.specializationRu ?? null,
    }));

    return ok({ rows: out, total: out.length });
  },
);
