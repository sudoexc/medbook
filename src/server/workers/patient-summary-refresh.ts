/**
 * Phase 15 Wave 2 — Patient summary refresh worker.
 *
 * Job shape: `{ clinicId, userId, patientId, locale }`.
 *
 * Pipeline:
 *   1. Re-fetch the patient with the last 3 visits + open MedicalCases.
 *   2. Map the rows into `PatientSummaryInput` (split fullName → first/last,
 *      derive birthYear, pick `doctorSpecialty` per visit).
 *   3. Call `generatePatientSummary` (which calls `callLLM`).
 *   4. Write `Patient.summaryCache + summaryCacheUpdatedAt = now()`.
 *   5. Publish `patient.summary.refreshed` so the UI refetches.
 *
 * The whole pipeline runs inside `runWithTenant({ kind: "SYSTEM" })` because
 * the worker is detached from any HTTP request — same convention as
 * `notifications-send`.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { generatePatientSummary, type PatientSummaryInput } from "@/server/ai/summary";
import { getQueue } from "@/server/queue";
import { publishEventSafe } from "@/server/realtime/publish";

export const QUEUE_NAME = "ai:patient-summary";
export const JOB_NAME = "refresh";

export type RefreshJob = {
  clinicId: string;
  userId: string | null;
  patientId: string;
  locale: "ru" | "uz";
};

/**
 * Split "Фамилия Имя [Отчество…]" into a first / last token pair. We feed
 * both to the redactor so any occurrence in the prompt or LLM response is
 * scrubbed before the provider sees it.
 */
function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = (fullName ?? "").trim();
  if (cleaned.length === 0) return { firstName: "", lastName: "" };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  // Convention in this codebase: first token = surname, second = name.
  // For the LLM input it doesn't matter which is which — both end up in
  // knownNames — but keep the split deterministic.
  const [last, first, ...rest] = parts;
  const firstName = [first ?? "", ...rest].join(" ").trim();
  return { firstName, lastName: last ?? "" };
}

function birthYear(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;
  const year = birthDate.getFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > 2200) return null;
  return year;
}

function genderToShort(g: string | null | undefined): "M" | "F" | null {
  if (g === "M" || g === "MALE") return "M";
  if (g === "F" || g === "FEMALE") return "F";
  return null;
}

async function loadPatientContext(
  patientId: string,
  locale: "ru" | "uz",
): Promise<PatientSummaryInput | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      fullName: true,
      birthDate: true,
      gender: true,
      createdAt: true,
    },
  });
  if (!patient) return null;

  const visits = await prisma.appointment.findMany({
    where: { patientId },
    select: {
      date: true,
      notes: true,
      comments: true,
      doctor: { select: { specializationRu: true, nameRu: true } },
      primaryService: { select: { nameRu: true } },
      medicalCase: { select: { diagnosisText: true } },
    },
    orderBy: { date: "desc" },
    take: 3,
  });

  const cases = await prisma.medicalCase.findMany({
    where: { patientId, status: "OPEN" },
    select: {
      openedAt: true,
      title: true,
      notes: true,
      diagnosisText: true,
    },
    orderBy: { openedAt: "desc" },
    take: 5,
  });

  const { firstName, lastName } = splitFullName(patient.fullName);

  return {
    patientId: patient.id,
    patient: {
      firstName,
      lastName,
      birthYear: birthYear(patient.birthDate),
      createdAt: patient.createdAt,
      gender: genderToShort(patient.gender as unknown as string | null),
    },
    recentVisits: visits.map((v) => ({
      date: v.date,
      doctorSpecialty:
        v.doctor?.specializationRu ?? v.doctor?.nameRu ?? "врач",
      diagnosis: v.medicalCase?.diagnosisText ?? null,
      notes: v.notes ?? v.comments ?? null,
      prescriptions: v.primaryService?.nameRu ?? null,
    })),
    openCases: cases.map((c) => ({
      openedAt: c.openedAt,
      title: c.title,
      lastNote: c.notes ?? c.diagnosisText ?? null,
    })),
    locale,
  };
}

async function refresh(job: RefreshJob): Promise<void> {
  // SYSTEM context bypasses the Prisma tenant scope; we filter explicitly
  // by patientId (which already implies the clinic). The clinic id passed
  // to `generatePatientSummary` is what gets recorded against rate limit /
  // audit / usage rows.
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const input = await loadPatientContext(job.patientId, job.locale);
    if (!input) return;

    const summary = await generatePatientSummary(
      job.clinicId,
      job.userId,
      input,
    );

    await prisma.patient.update({
      where: { id: job.patientId },
      data: {
        summaryCache: summary.text,
        summaryCacheUpdatedAt: summary.generatedAt,
      },
    });

    publishEventSafe(job.clinicId, {
      type: "patient.summary.refreshed",
      payload: { patientId: job.patientId },
    });
  });
}

/** Start the worker; idempotent (safe to call multiple times). */
export function startPatientSummaryRefreshWorker(): void {
  getQueue().registerWorker<RefreshJob>(QUEUE_NAME, JOB_NAME, refresh);
  console.info("[worker] patient-summary-refresh registered");
}

// Named export for tests — exposes the inner handler without queue plumbing.
export { refresh as _refreshForTests };
