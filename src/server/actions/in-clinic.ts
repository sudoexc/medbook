/**
 * Retire the pre-arrival rows of visits that are no longer ahead (audit
 * AC-07).
 *
 * NO_SHOW_RISK_HIGH, UNCONFIRMED_24H and NO_CONTACT_CALL are about a patient
 * who might not come. Once the visit leaves BOOKED / CONFIRMED the question
 * is answered: reception pressed «Пришёл» (WAITING), the doctor started or
 * finished the visit, it was cancelled or marked a no-show. The detectors
 * stop firing then, but nothing closed the rows: NO_SHOW_RISK_HIGH lived to
 * the visit time, NO_CONTACT_CALL to the end of its day and UNCONFIRMED_24H
 * to the 48h sweep. Until then the patient sitting in the hall, or already
 * seen by the doctor, was a «Риск пропуска» card, a KPI count, a briefing
 * line and a row in «К подтверждению». A row a call outcome had snoozed («Не
 * дозвонился» at 11:30, back at 13:30) resurfaced on its timer the same way,
 * and only the WAITING / IN_PROGRESS seen by one 15-minute pass were caught,
 * so a visit that went from BOOKED to COMPLETED between two passes kept its
 * row for two days.
 *
 * A row nobody handled is closed EXPIRED; one with a call outcome of its own
 * is closed DONE with the outcome kept, so «Обработано сегодня» still shows
 * the call (`retireActions`).
 *
 * One exception: a callback promised before the visit («Перезвонить в
 * 13:00») on a visit that was cancelled or missed. The patient never came,
 * so the call is still owed to them; the row surfaces at its time as before
 * and leaves through its own expiry.
 *
 * Caller MUST be inside `runWithTenant(...)` (the engine is).
 */
import {
  RISK_ACTION_TYPES,
  RISK_TODAY_APPOINTMENT_STATUSES,
  type ActionPayload,
} from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

import { retireActions } from "./repository";

type PrismaLike = TenantScopedPrisma;

/**
 * Visit statuses in which the patient is still expected: the visit is ahead
 * and they have not come. The risk-today list shows exactly these, and the
 * outcome endpoints accept exactly these.
 */
const EXPECTED: ReadonlySet<string> = new Set(RISK_TODAY_APPOINTMENT_STATUSES);

/** The visit is over and the patient did not come to it. */
const NOT_ATTENDED: ReadonlySet<string> = new Set(["CANCELLED", "NO_SHOW"]);

export async function retireMootRiskActions(
  prisma: PrismaLike,
  clinicId: string,
): Promise<number> {
  const live = (await prisma.action.findMany({
    where: {
      clinicId,
      type: { in: [...RISK_ACTION_TYPES] },
      status: { in: ["OPEN", "SNOOZED"] },
    },
    select: {
      id: true,
      type: true,
      severity: true,
      status: true,
      outcome: true,
      payload: true,
    },
  })) as Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    outcome: string | null;
    payload: ActionPayload | null;
  }>;
  if (live.length === 0) return 0;

  const apptIdOf = (p: ActionPayload | null): string | null =>
    p && "appointmentId" in p && typeof p.appointmentId === "string"
      ? p.appointmentId
      : null;
  const apptIds = [...new Set(live.map((a) => apptIdOf(a.payload)).filter(Boolean))] as string[];
  if (apptIds.length === 0) return 0;

  const appts = (await prisma.appointment.findMany({
    where: { id: { in: apptIds } },
    select: { id: true, status: true },
  })) as Array<{ id: string; status: string }>;
  const statusOf = new Map(appts.map((a) => [a.id, a.status]));

  const moot = [];
  for (const row of live) {
    const apptId = apptIdOf(row.payload);
    // A visit the lookup did not return is left to the rows' own expiry: a
    // missing read must never close a clinic's whole risk list.
    const status = apptId ? statusOf.get(apptId) : undefined;
    if (status === undefined || EXPECTED.has(status)) continue;
    // Only a snoozed row still holds its promise; an OPEN row's outcome is a
    // leftover of an earlier occurrence.
    const promisedCall = row.status === "SNOOZED" && row.outcome === "CALLBACK";
    if (promisedCall && NOT_ATTENDED.has(status)) continue;
    moot.push({ ...row, reason: `visit_${status.toLowerCase()}` });
  }
  return retireActions(prisma, clinicId, moot, "visit_not_ahead");
}
