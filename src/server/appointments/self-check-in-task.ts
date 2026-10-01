/**
 * A Mini App check-in nobody answered becomes a task for reception (audit
 * G3-01, review).
 *
 * The patient pressed «Я на месте» and nobody marked him «Пришёл». The
 * lifecycle sweep no longer turns such a booking into a no-show (he said he
 * was here; «вы не пришли» would be false and an insult), but skipping it
 * silently left the visit a booking for good: no no-show, no message, no
 * task, in the patient's history and the doctor's day, uncounted by the
 * no-show figures, with only a badge that left reception's day lists at
 * midnight. Maybe he sat in the hall unmet, maybe he tapped from home and
 * never came: only a person can tell, so at the auto no-show cutoff the
 * sweep hands reception a SELF_CHECK_IN_UNHANDLED task on the visit's
 * drawer, where «Пришёл», «Не пришёл» or a move settles it.
 *
 * One task per visit: the dedupe key is the appointment, and a task a person
 * closed stays closed on the next tick (`upsertAction`, audit AC-08) unless
 * the visit moved and the patient checked in again, which is a new question.
 * The task goes by itself once the visit leaves the booking states
 * (`retireMootRiskActions` / `retireVisitRiskActions`).
 *
 * Best effort per row: a failure is logged and the next tick retries; it
 * never stops the sweep.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import type { SelfCheckInUnhandledPayload } from "@/lib/actions/types";
import { upsertAction } from "@/server/actions/repository";
import { publishEventSafe } from "@/server/realtime/publish";

/** The slice of a checked-in booking the task is built from. */
export type UnansweredCheckIn = {
  id: string;
  clinicId: string;
  patientId: string;
  date: Date;
  arrivedAt: Date;
  patient?: { fullName: string | null } | null;
  doctor?: { nameRu: string | null } | null;
};

/** Pure: the task's payload for one visit. */
export function selfCheckInTaskPayload(
  row: UnansweredCheckIn,
): SelfCheckInUnhandledPayload {
  return {
    type: "SELF_CHECK_IN_UNHANDLED",
    appointmentId: row.id,
    patientId: row.patientId,
    patientName: row.patient?.fullName ?? "",
    doctorName: row.doctor?.nameRu ?? "",
    appointmentAt: row.date.toISOString(),
    arrivedAt: row.arrivedAt.toISOString(),
  };
}

/**
 * Raise (or keep) the task for each visit. Returns how many were created
 * now; a visit that already has its task is a silent no-op.
 */
export async function raiseSelfCheckInTasks(
  rows: ReadonlyArray<UnansweredCheckIn>,
): Promise<number> {
  let created = 0;
  for (const row of rows) {
    const payload = selfCheckInTaskPayload(row);
    try {
      // SYSTEM context with the row's clinic passed explicitly, like every
      // worker-raised task (no-channel-action, telegram-link-conflict).
      const result = await runWithTenant({ kind: "SYSTEM" }, () =>
        upsertAction(prisma, row.clinicId, payload, { expiresAt: null }),
      );
      if (result.created) {
        created += 1;
        publishEventSafe(row.clinicId, {
          type: "action.created",
          payload: { id: result.id, type: payload.type, severity: result.severity },
        });
      } else if (
        !result.keptClosed &&
        (result.payloadChanged || result.severityChanged)
      ) {
        publishEventSafe(row.clinicId, {
          type: "action.updated",
          payload: { id: result.id, type: payload.type, severity: result.severity },
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[lifecycle-sweep] self check-in task failed appt=${row.id} clinic=${row.clinicId} err=${msg}`,
      );
    }
  }
  return created;
}
