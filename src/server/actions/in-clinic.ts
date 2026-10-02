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
 * The same goes for a Mini App check-in nobody answered
 * (SELF_CHECK_IN_UNHANDLED, review of G3-01): «Пришёл», «Не пришёл» or a
 * cancel settles it. So does a move to another day, which drops the check-in
 * (`checkInResetOnMove`): reception has decided, and a fresh tap on the new
 * day raises a new task.
 *
 * Caller MUST be inside `runWithTenant(...)` (the engine is).
 */
import {
  RISK_TODAY_APPOINTMENT_STATUSES,
  VISIT_BOUND_ACTION_TYPES,
  visitBoundDedupeKeysOf,
  type ActionPayload,
  type ActionSeverity,
  type ActionType,
} from "@/lib/actions/types";
import { checkedInOnVisitDay } from "@/lib/appointments/self-check-in";
import type { TenantScopedPrisma } from "@/lib/prisma";
import { publishEventSafe } from "@/server/realtime/publish";

import { holdsPromisedCall, retireActions } from "./repository";

type PrismaLike = TenantScopedPrisma;

/**
 * Visit statuses in which the patient is still expected: the visit is ahead
 * and they have not come. The risk-today list shows exactly these, and the
 * outcome endpoints accept exactly these.
 */
const EXPECTED: ReadonlySet<string> = new Set(RISK_TODAY_APPOINTMENT_STATUSES);

/** The visit is over and the patient did not come to it. */
const NOT_ATTENDED: ReadonlySet<string> = new Set(["CANCELLED", "NO_SHOW"]);

/**
 * What the retire knows of a visit: its status, and whether it still carries
 * a check-in for its own day (unknown on the single-visit path, which only
 * sees a status change).
 */
type VisitState = { status: string; checkedIn?: boolean };

type LiveRiskRow = {
  id: string;
  type: string;
  severity: string;
  status: string;
  outcome: string | null;
  payload: ActionPayload | null;
};

const LIVE_RISK_SELECT = {
  id: true,
  type: true,
  severity: true,
  status: true,
  outcome: true,
  payload: true,
} as const;

function apptIdOf(p: ActionPayload | null): string | null {
  return p && "appointmentId" in p && typeof p.appointmentId === "string"
    ? p.appointmentId
    : null;
}

/**
 * The rows among `live` whose visit is no longer ahead, each with its reason.
 * A visit `statusOf` does not know is left to the rows' own expiry: a missing
 * read must never close a clinic's whole risk list.
 */
function mootRows(
  live: LiveRiskRow[],
  visitOf: ReadonlyMap<string, VisitState>,
): Array<LiveRiskRow & { reason: string }> {
  const moot = [];
  for (const row of live) {
    const apptId = apptIdOf(row.payload);
    const visit = apptId ? visitOf.get(apptId) : undefined;
    if (visit === undefined) continue;
    const { status } = visit;
    if (EXPECTED.has(status)) {
      // Still a booking, but moved off the day of the check-in.
      if (row.type === "SELF_CHECK_IN_UNHANDLED" && visit.checkedIn === false) {
        moot.push({ ...row, reason: "check_in_cleared" });
      }
      continue;
    }
    // Only a snoozed row still holds its promise; an OPEN row's outcome is a
    // leftover of an earlier occurrence.
    if (holdsPromisedCall(row) && NOT_ATTENDED.has(status)) continue;
    moot.push({ ...row, reason: `visit_${status.toLowerCase()}` });
  }
  return moot;
}

export async function retireMootRiskActions(
  prisma: PrismaLike,
  clinicId: string,
): Promise<number> {
  const live = (await prisma.action.findMany({
    where: {
      clinicId,
      type: { in: [...VISIT_BOUND_ACTION_TYPES] },
      status: { in: ["OPEN", "SNOOZED"] },
    },
    select: LIVE_RISK_SELECT,
  })) as LiveRiskRow[];
  if (live.length === 0) return 0;

  const apptIds = [...new Set(live.map((a) => apptIdOf(a.payload)).filter(Boolean))] as string[];
  if (apptIds.length === 0) return 0;

  const appts = (await prisma.appointment.findMany({
    where: { id: { in: apptIds } },
    select: { id: true, status: true, date: true, arrivedAt: true },
  })) as Array<{ id: string; status: string; date: Date; arrivedAt: Date | null }>;
  const visitOf = new Map<string, VisitState>(
    appts.map((a) => [a.id, { status: a.status, checkedIn: checkedInOnVisitDay(a) }]),
  );

  return retireActions(prisma, clinicId, mootRows(live, visitOf), "visit_not_ahead");
}

/**
 * The same rule for one visit, right when it leaves BOOKED / CONFIRMED
 * (audit AC-17): the cancel and the completion paths call it, so a visit
 * cancelled in Telegram stops being «не подтверждена» / «риск пропуска» at
 * once rather than on the next 15-minute pass. `status` is the visit's new
 * status. Best effort: never throws, the visit change is already committed.
 */
export async function retireVisitRiskActions(
  prisma: PrismaLike,
  clinicId: string,
  appointmentId: string,
  status: string,
): Promise<number> {
  try {
    if (EXPECTED.has(status)) return 0;
    const live = (await prisma.action.findMany({
      where: {
        clinicId,
        dedupeKey: { in: visitBoundDedupeKeysOf(appointmentId) },
        status: { in: ["OPEN", "SNOOZED"] },
      },
      select: LIVE_RISK_SELECT,
    })) as LiveRiskRow[];
    if (live.length === 0) return 0;
    const visitOf = new Map<string, VisitState>([[appointmentId, { status }]]);
    const moot = mootRows(live, visitOf);
    const retired = await retireActions(prisma, clinicId, moot, "visit_not_ahead");
    // Announce each closed task (audit G3-11): the «К подтверждению» widget
    // and the action center refresh only on action.*, so a visit cancelled
    // in the Mini App stayed on the operators' lists until their next poll.
    // This runs after the visit's commit, so the bus is safe here.
    for (const row of moot) {
      publishEventSafe(clinicId, {
        type: "action.updated",
        payload: {
          id: row.id,
          type: row.type as ActionType,
          severity: row.severity as ActionSeverity,
        },
      });
    }
    return retired;
  } catch (e) {
    console.warn(
      `[actions.retireVisitRiskActions] ${appointmentId} skipped: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 0;
  }
}
