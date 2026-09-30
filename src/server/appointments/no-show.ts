/**
 * What a no-show does besides flipping the status (audit AP-04).
 *
 * Four paths mark a visit «Не пришёл»: the appointment PATCH (the drawer's
 * status menu), `queue-status` (the doctor cabinet's and the visit card's
 * «Не пришёл»), `bulk-status` (reception's bulk action) and the lifecycle
 * sweep (an hour past the slot, nobody came). Only the PATCH repriced the
 * patient's case. The free-repeat engine never counts a NO_SHOW as the
 * case's first visit, so when a first consultation turns into a no-show the
 * follow-up that was priced as a free repeat must go back to full price: it
 * is the first real visit now. Through the other three paths it stayed at
 * 0 сум on the visit card. They also named the patient's message by two
 * different trigger slugs and left the visit's «не подтверждена» / «риск
 * пропуска» tasks open until the next engine pass.
 *
 * Every path now goes through these three pieces:
 *   - `NO_SHOW_FIELDS`: both status columns move together (reception's lanes
 *     read `queueStatus`, the doctor surface and KPIs read `status`);
 *   - `repriceCaseAfterNoShow`: inside the transaction that wrote NO_SHOW,
 *     so the case's prices never read a half-applied state;
 *   - `runNoShowEffects`: after the commit, the «Вы не пришли» message and
 *     the risk tasks. Idempotent: the message goes through the
 *     NotificationSend (appointment, template) gate, the tasks are found
 *     already closed on a second run.
 *
 * The sweep keeps its own rules on top (walk-ins and rows already in the
 * live queue are never swept; the same-day «Пришёл» after an auto no-show),
 * those decide WHETHER a row becomes a no-show, this module only WHAT that
 * does.
 */
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/server/notifications/triggers";
import { retireVisitRiskActions } from "@/server/actions/in-clinic";
import { recomputeCaseAppointments } from "@/server/pricing/recompute-appointment-price";
import type { PrismaTx } from "@/server/appointments/intake";

/** Both status columns of a no-show, written together by every path. */
export const NO_SHOW_FIELDS = {
  status: "NO_SHOW",
  queueStatus: "NO_SHOW",
} as const;

/**
 * Reprice every visit of the case the no-show belonged to. Call it inside
 * the transaction that wrote NO_SHOW. A visit outside any case has nothing
 * to reprice: its own price stays what was booked.
 */
export async function repriceCaseAfterNoShow(
  tx: PrismaTx,
  medicalCaseId: string | null | undefined,
): Promise<void> {
  if (!medicalCaseId) return;
  await recomputeCaseAppointments(tx, medicalCaseId);
}

/**
 * Reprice the cases of several no-shows once each, however many of the
 * batch's visits share a case.
 */
export async function repriceCasesAfterNoShow(
  tx: PrismaTx,
  medicalCaseIds: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const unique = new Set<string>();
  for (const id of medicalCaseIds) if (id) unique.add(id);
  for (const id of unique) await recomputeCaseAppointments(tx, id);
}

export interface NoShowEffectsInput {
  clinicId: string;
  appointmentId: string;
}

/**
 * After the commit: tell the patient, close the visit's pre-arrival risk
 * tasks. Never throws: the no-show is already written, and a failed push
 * must not turn it into an error for whoever marked it.
 */
export async function runNoShowEffects(input: NoShowEffectsInput): Promise<void> {
  // Fire-and-forget; swallows its own errors. One canonical slug for every
  // path (the legacy "appointment.noshow" alias lands on the same template).
  fireTrigger({ kind: "appointment.no-show", appointmentId: input.appointmentId });
  // Logs and swallows its own failures.
  await retireVisitRiskActions(
    prisma,
    input.clinicId,
    input.appointmentId,
    "NO_SHOW",
  );
}
