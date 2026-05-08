/**
 * Detector: OVERDUE_FOLLOW_UP.
 *
 * The schema does not yet have a structured `followUpDoneAt` flag (Wave 3
 * will plumb that through MedicalCase). The best proxy for "post-visit
 * follow-up wasn't done" is:
 *
 *   - the appointment is COMPLETED
 *   - it happened between [now - followUpStaleDays * 24h, now - 24h]
 *   - it belongs to an OPEN MedicalCase
 *   - the case has no later non-CANCELLED appointment (i.e. nothing
 *     followed up the visit yet)
 *
 * Severity: `low` per spec. Assignee: ADMIN (default for OVERDUE_FOLLOW_UP).
 */
import type { OverdueFollowUpPayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addDays } from "./_shared";

type ApptRow = {
  id: string;
  date: Date;
  patientId: string;
  medicalCaseId: string | null;
};

export async function detectOverdueFollowUp(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<OverdueFollowUpPayload[]> {
  const upper = addDays(now, -1);
  const lower = addDays(now, -config.followUpStaleDays);

  const visits = (await prisma.appointment.findMany({
    where: {
      status: "COMPLETED",
      date: { gte: lower, lt: upper },
      medicalCaseId: { not: null },
    },
    select: {
      id: true,
      date: true,
      patientId: true,
      medicalCaseId: true,
    },
  })) as ApptRow[];
  if (visits.length === 0) return [];

  const caseIds = Array.from(
    new Set(visits.map((v) => v.medicalCaseId).filter((x): x is string => Boolean(x))),
  );
  // Only OPEN cases need follow-up nudges. Closed cases get filtered out.
  const openCases = (await prisma.medicalCase.findMany({
    where: { id: { in: caseIds }, status: "OPEN" },
    select: { id: true },
  })) as Array<{ id: string }>;
  const openSet = new Set(openCases.map((c) => c.id));

  // For each candidate visit, check if any later non-cancelled appointment
  // exists on the same case — that means the follow-up already happened.
  const laterAppts = (await prisma.appointment.findMany({
    where: {
      medicalCaseId: { in: caseIds },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    select: { id: true, date: true, medicalCaseId: true },
  })) as Array<{ id: string; date: Date; medicalCaseId: string | null }>;

  const laterByCase = new Map<string, Date[]>();
  for (const a of laterAppts) {
    if (!a.medicalCaseId) continue;
    const arr = laterByCase.get(a.medicalCaseId) ?? [];
    arr.push(a.date);
    laterByCase.set(a.medicalCaseId, arr);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const out: OverdueFollowUpPayload[] = [];
  for (const v of visits) {
    if (!v.medicalCaseId || !openSet.has(v.medicalCaseId)) continue;
    const laterDates = laterByCase.get(v.medicalCaseId) ?? [];
    const hasFollowUp = laterDates.some(
      (d) => d.getTime() > v.date.getTime(),
    );
    if (hasFollowUp) continue;
    const daysSinceVisit = Math.max(
      1,
      Math.floor((now.getTime() - v.date.getTime()) / dayMs),
    );
    out.push({
      type: "OVERDUE_FOLLOW_UP",
      appointmentId: v.id,
      patientId: v.patientId,
      daysSinceVisit,
    });
  }
  return out;
}
