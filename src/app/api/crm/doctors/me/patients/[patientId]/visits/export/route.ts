/**
 * GET /api/crm/doctors/me/patients/[patientId]/visits/export?format=csv
 *
 * Streams the doctor's full visit history with this patient as a CSV. Same
 * anti-leak as the paginated `…/visits` endpoint: the patient must exist
 * in the doctor's clinic AND have ≥1 appointment with the calling doctor;
 * otherwise we 403 to avoid signalling existence cross-caseload.
 *
 * Columns (RU headers, doctor-readable in Excel/Numbers with UTF-8 BOM):
 *   "Дата","Время","Тип","МКБ-10","Диагноз","Врач","Услуга","Назначения",
 *   "Рекомендации","Краткое заключение"
 *
 * No pagination — the doctor exports everything completed; for very large
 * histories Excel can handle 100k rows easily and Postgres copes far past
 * that. We still cap at 5000 rows defensively.
 *
 * Audit: `VISIT_LIST_EXPORTED` with row count + patientId.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, notFound } from "@/server/http";

const MAX_ROWS = 5000;

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/{patientId}/visits/export
  const idx = parts.lastIndexOf("visits");
  if (idx <= 0) return "";
  return parts[idx - 1] ?? "";
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Always quote — covers commas, quotes, newlines, leading equals (formula
  // injection) without branching.
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cols: unknown[]): string {
  return cols.map(csvCell).join(",");
}

function ru(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD — sortable in Excel
}
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const patientId = patientIdFromUrl(request);
    if (!patientId) return err("BadRequest", 400, { reason: "missing_patient_id" });

    const format = (new URL(request.url).searchParams.get("format") ?? "csv").toLowerCase();
    if (format !== "csv") {
      return err("BadRequest", 400, { reason: "format_not_supported" });
    }

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, nameRu: true, specializationRu: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId },
      select: { id: true, fullName: true },
    });
    if (!patient) return notFound();

    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) {
      return err("Forbidden", 403, { reason: "no_appointments_with_doctor" });
    }

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
        medicalCaseId: true,
        primaryService: { select: { nameRu: true } },
        visitNote: {
          select: {
            diagnosisCode: true,
            diagnosisName: true,
            prescriptions: true,
            advice: true,
            bodyMarkdown: true,
          },
        },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: MAX_ROWS,
    });

    // Same-case ordinal — earliest in a MedicalCase = consultation, later = repeat.
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

    const HEADER = [
      "Дата",
      "Время",
      "Тип",
      "МКБ-10",
      "Диагноз",
      "Врач",
      "Услуга",
      "Назначения",
      "Рекомендации",
      "Краткое заключение",
    ];

    const lines = [csvRow(HEADER)];
    for (const a of rows) {
      const isRepeat =
        a.medicalCaseId !== null &&
        caseFirstDate.has(a.medicalCaseId) &&
        a.date.getTime() > (caseFirstDate.get(a.medicalCaseId)?.getTime() ?? 0);
      const type = isRepeat ? "Повторный" : "Консультация";
      lines.push(
        csvRow([
          ru(a.date),
          `${hhmm(a.date)}–${hhmm(a.endDate)}`,
          type,
          a.visitNote?.diagnosisCode ?? "",
          a.visitNote?.diagnosisName ?? "",
          doctor.nameRu,
          a.primaryService?.nameRu ?? "",
          (a.visitNote?.prescriptions ?? []).join(" | "),
          (a.visitNote?.advice ?? []).join(" | "),
          // Trim body markdown so a row stays manageable in spreadsheet view;
          // doctors who need full text open the visit page directly.
          (a.visitNote?.bodyMarkdown ?? "").slice(0, 1000),
        ]),
      );
    }

    // BOM so Excel autodetects UTF-8 (Cyrillic doctors don't have to fight
    // with encoding pickers).
    const body = "﻿" + lines.join("\r\n") + "\r\n";

    await audit(request, {
      action: "visit_list.exported",
      entityType: "Patient",
      entityId: patientId,
      meta: {
        rows: rows.length,
        format: "csv",
        patientFullName: patient.fullName,
      },
    });

    const filename = `visits-${patient.fullName.replace(/[^A-Za-zА-Яа-яЁё0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
);
