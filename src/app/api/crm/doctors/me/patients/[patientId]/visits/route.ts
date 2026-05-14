/**
 * /api/crm/doctors/me/patients/[patientId]/visits — completed visits this
 * doctor has had with the given patient. Backs `/doctor/visits/[patientId]`.
 *
 * Returns COMPLETED Appointments (the "visit happened" filter — BOOKED and
 * IN_PROGRESS are not history yet) joined to their VisitNote when one
 * exists. Each row carries enough for the table + timeline to render
 * without a follow-up fetch.
 *
 * Tenant scoping is handled by the Prisma extension via `runWithTenant`,
 * so an attacker passing a patientId from another clinic falls through to
 * an empty list — no extra guard needed here beyond verifying the
 * patient–doctor relationship below.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type VisitRow = {
  id: string;
  date: string;
  endDate: string;
  durationMin: number;
  type: "consultation" | "repeat";
  doctorName: string;
  doctorSpecialty: string;
  serviceName: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  prescriptions: string[];
  advice: string[];
  hasVisitNote: boolean;
  visitNoteId: string | null;
};

function patientIdFromUrl(request: Request): string {
  // .../doctors/me/patients/{patientId}/visits
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // Walk from the end: ["api","crm","doctors","me","patients","{patientId}","visits"]
  const idx = parts.lastIndexOf("visits");
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

    // Resolve current doctorId.
    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, nameRu: true, specializationRu: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    // Sanity-check: the patient must exist in this clinic (tenant scope
    // filters this for us) AND the doctor must have ≥1 appointment with
    // them — without that, surfacing the patient at all is leakage even
    // though the data is clinic-internal.
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

    const take = q.limit + 1;
    const rows = await prisma.appointment.findMany({
      where: {
        patientId,
        doctorId: doctor.id,
        status: "COMPLETED",
      },
      select: {
        id: true,
        date: true,
        endDate: true,
        durationMin: true,
        primaryService: { select: { nameRu: true } },
        // Each visit is one consultation per the product spec; the second
        // and later appointments inside the same MedicalCase are "repeat".
        medicalCaseId: true,
        visitNote: {
          select: {
            id: true,
            diagnosisCode: true,
            diagnosisName: true,
            prescriptions: true,
            advice: true,
          },
        },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    // Same-case ordinal: for each MedicalCase, the earliest appointment is
    // "consultation", later ones are "repeat". We compute the per-case
    // minimum date over the page set so we don't need a window function.
    // Appointments outside a case (medicalCaseId === null) default to
    // "consultation".
    const caseIds = Array.from(
      new Set(
        rows
          .map((r) => r.medicalCaseId)
          .filter((x): x is string => Boolean(x)),
      ),
    );
    const caseFirstDate = new Map<string, Date>();
    if (caseIds.length > 0) {
      const grouped = await prisma.appointment.groupBy({
        by: ["medicalCaseId"],
        where: {
          medicalCaseId: { in: caseIds },
          status: "COMPLETED",
        },
        _min: { date: true },
      });
      for (const g of grouped) {
        if (g.medicalCaseId && g._min.date) {
          caseFirstDate.set(g.medicalCaseId, g._min.date);
        }
      }
    }

    const out: VisitRow[] = rows.map((a) => {
      const isRepeat =
        a.medicalCaseId !== null &&
        caseFirstDate.has(a.medicalCaseId) &&
        // strictly later than the case's earliest = repeat
        a.date.getTime() > (caseFirstDate.get(a.medicalCaseId)?.getTime() ?? 0);
      return {
        id: a.id,
        date: a.date.toISOString(),
        endDate: a.endDate.toISOString(),
        durationMin: a.durationMin,
        type: isRepeat ? "repeat" : "consultation",
        doctorName: doctor.nameRu,
        doctorSpecialty: doctor.specializationRu,
        serviceName: a.primaryService?.nameRu ?? null,
        diagnosisCode: a.visitNote?.diagnosisCode ?? null,
        diagnosisName: a.visitNote?.diagnosisName ?? null,
        prescriptions: a.visitNote?.prescriptions ?? [],
        advice: a.visitNote?.advice ?? [],
        hasVisitNote: a.visitNote !== null && a.visitNote !== undefined,
        visitNoteId: a.visitNote?.id ?? null,
      };
    });

    const total = await prisma.appointment.count({
      where: {
        patientId,
        doctorId: doctor.id,
        status: "COMPLETED",
      },
    });

    return ok({ rows: out, nextCursor, total });
  },
);
