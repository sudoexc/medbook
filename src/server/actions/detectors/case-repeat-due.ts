/**
 * Detector: CASE_REPEAT_DUE.
 *
 * The schema has no explicit `repeatDueAt` column. We derive the deadline
 * the same way as `notifications/triggers.ts → runCaseRepeatReminders()`:
 *
 *   deadline = firstAppointment.date + service.freeRepeatDays * 24h
 *
 * The action fires when `deadline - now <= caseRepeatLeadDays days` AND the
 * case has no future BOOKED/WAITING appointment scheduled (patient already
 * coming back → no nudge needed).
 *
 * Severity: `medium` (default for CASE_REPEAT_DUE is "high"; we override
 * because the scenario is informational rather than urgent — there's still
 * lead time to book).
 */
import type { CaseRepeatDuePayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";

type CaseRow = {
  id: string;
  patientId: string;
  patient: { fullName: string };
  appointments: Array<{
    id: string;
    date: Date;
    status: string;
    primaryService: { freeRepeatDays: number | null } | null;
  }>;
};

export async function detectCaseRepeatDue(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<CaseRepeatDuePayload[]> {
  const cases = (await prisma.medicalCase.findMany({
    where: { status: "OPEN" },
    select: {
      id: true,
      patientId: true,
      patient: { select: { fullName: true } },
      appointments: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          date: true,
          status: true,
          primaryService: { select: { freeRepeatDays: true } },
        },
      },
    },
  })) as CaseRow[];
  if (cases.length === 0) return [];

  const dayMs = 24 * 60 * 60 * 1000;
  const leadMs = config.caseRepeatLeadDays * dayMs;
  const out: CaseRepeatDuePayload[] = [];

  for (const c of cases) {
    const firstVisit = c.appointments.find(
      (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
    );
    if (!firstVisit) continue;
    const days = firstVisit.primaryService?.freeRepeatDays ?? null;
    if (!days || days <= 0) continue;

    const hasFutureBooked = c.appointments.some(
      (a) =>
        a.id !== firstVisit.id &&
        (a.status === "BOOKED" || a.status === "WAITING") &&
        a.date.getTime() > firstVisit.date.getTime(),
    );
    if (hasFutureBooked) continue;

    const deadline = firstVisit.date.getTime() + days * dayMs;
    if (now.getTime() >= deadline) continue; // window already closed
    if (deadline - now.getTime() > leadMs) continue; // too far out

    const dueDate = new Date(deadline);
    out.push({
      type: "CASE_REPEAT_DUE",
      caseId: c.id,
      patientId: c.patientId,
      patientName: c.patient.fullName,
      // ISO date (YYYY-MM-DD) — stable for dedupeKey and human display.
      dueDate: dueDate.toISOString().slice(0, 10),
      lastVisitAt: firstVisit.date.toISOString(),
    });
  }
  return out;
}
