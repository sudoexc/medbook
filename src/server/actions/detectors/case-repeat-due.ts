/**
 * Detector: CASE_REPEAT_DUE.
 *
 * The schema has no explicit `repeatDueAt` column. We derive the deadline
 * the same way as `notifications/triggers.ts → runCaseRepeatReminders()`:
 *
 *   deadline = firstAppointment.date + service.freeRepeatDays * 24h
 *
 * The action fires when `deadline - now <= caseRepeatLeadDays days` AND the
 * case has no repeat visit yet: any later visit of the case the patient has
 * not dropped (audit AC-05). Only BOOKED / WAITING used to count, so a repeat
 * the patient confirmed on the phone or in Telegram (CONFIRMED), or had
 * already come to (COMPLETED), still produced «Повторный визит до 25.09» and
 * reception rang a patient who had been seen two days before.
 *
 * The scan is bounded to cases whose free-repeat window can still be open:
 * a first visit older than the longest `freeRepeatDays` of the clinic's
 * services has no deadline ahead. The detector used to load every OPEN case
 * with its whole visit history every 15 minutes.
 *
 * Severity: `medium` (default for CASE_REPEAT_DUE is "high"; we override
 * because the scenario is informational rather than urgent — there's still
 * lead time to book).
 */
import type { ActionSeverity, CaseRepeatDuePayload } from "@/lib/actions/types";

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

/** Visits that did not happen: they neither anchor the case nor repeat it. */
const DROPPED_STATUSES = ["CANCELLED", "NO_SHOW"] as const;
const DROPPED: ReadonlySet<string> = new Set(DROPPED_STATUSES);

const DAY_MS = 24 * 60 * 60 * 1000;

export async function detectCaseRepeatDue(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<CaseRepeatDuePayload[]> {
  const longest = (await prisma.service.aggregate({
    _max: { freeRepeatDays: true },
  })) as { _max: { freeRepeatDays: number | null } };
  const maxDays = longest._max.freeRepeatDays ?? 0;
  if (maxDays <= 0) return [];
  // A case whose every live visit is older than this has no window left
  // (its first visit is older still).
  const oldestOpenWindow = new Date(now.getTime() - maxDays * DAY_MS);

  const cases = (await prisma.medicalCase.findMany({
    where: {
      status: "OPEN",
      appointments: {
        some: {
          status: { notIn: [...DROPPED_STATUSES] },
          date: { gte: oldestOpenWindow },
        },
      },
    },
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

  const leadMs = config.caseRepeatLeadDays * DAY_MS;
  const out: CaseRepeatDuePayload[] = [];

  for (const c of cases) {
    const live = c.appointments.filter((a) => !DROPPED.has(a.status));
    const firstVisit = live[0];
    if (!firstVisit) continue;
    const days = firstVisit.primaryService?.freeRepeatDays ?? null;
    if (!days || days <= 0) continue;

    // Booked, confirmed, in the hall, on the table or already seen: the
    // repeat is taken care of either way.
    const hasRepeat = live.some(
      (a) =>
        a.id !== firstVisit.id && a.date.getTime() > firstVisit.date.getTime(),
    );
    if (hasRepeat) continue;

    const deadline = firstVisit.date.getTime() + days * DAY_MS;
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

/**
 * The engine's severity for CASE_REPEAT_DUE: `medium`, as the header says.
 * The engine never passed it, so every row came out `high` (audit AC-05).
 */
export function severityForCaseRepeatDue(): ActionSeverity {
  return "medium";
}
