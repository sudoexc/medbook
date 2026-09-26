/**
 * What a visit's completion does besides flipping the status (audit AP-07,
 * PT-06).
 *
 * Four paths close a visit: the appointment PATCH (doctor's «Завершить»),
 * `queue-status` (reception's «Вызвать из очереди» closes the current patient
 * before calling the next one), `bulk-status`, and `finalize` (the doctor's
 * signature). Only the PATCH ran the side effects. A visit reception closed
 * never refreshed the patient's visit count and «Последний визит», never
 * moved `lastContactedAt`, never thanked the patient and never paid out the
 * referral reward; the doctor's later signature skipped them too, because by
 * then the visit already read COMPLETED. The dormant detector then treated a
 * patient seen yesterday as gone and queued a reactivation for them.
 *
 * Every path now calls this one function. Each effect is idempotent on its
 * own, so a second run (reception closes the visit, the doctor signs it ten
 * minutes later) duplicates nothing:
 *   - the thank-you goes through the NotificationSend (appointment, template)
 *     gate and is materialised once;
 *   - the referral reward is unique per (referrer, referred) pair and only
 *     minted for the patient's first completed visit;
 *   - `lastContactedAt` only ever moves forward;
 *   - the visit stats are recounted from the appointments, not incremented.
 *
 * `thankPatient` is false when the signature lands on a visit someone else
 * already closed: the data effects still run (they heal a visit closed before
 * this function existed), but «Спасибо за визит» belongs to the moment of the
 * visit. A conclusion signed days later must not greet the patient again.
 *
 * Never throws: the visit is already closed when this runs, and a failed
 * counter or push must not turn that into an error for the person who
 * closed it.
 */
import { prisma } from "@/lib/prisma";
import { fireTrigger } from "@/server/notifications/triggers";
import { mintReferralRewardOnCompletion } from "@/server/patient-experience/referral-mint";
import {
  bumpPatientLastContact,
  refreshPatientVisitStats,
} from "@/server/patient/last-contacted";

export interface CompletionEffectsInput {
  /** The request that closed the visit; the referral audit row cites it. */
  request: Request;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /**
   * When the visit ended. A legacy row closed without `completedAt` passes
   * its slot time, never "now": signing it today is not a contact today.
   */
  completedAt: Date;
  thankPatient: boolean;
}

export async function runCompletionEffects(
  input: CompletionEffectsInput,
): Promise<void> {
  const { request, clinicId, appointmentId, patientId } = input;
  if (input.thankPatient) {
    // Fire-and-forget; swallows its own errors.
    fireTrigger({ kind: "appointment.completed", appointmentId });
  }
  try {
    await mintReferralRewardOnCompletion({
      tx: prisma,
      request,
      clinicId,
      appointmentId,
      patientId,
    });
  } catch (e) {
    console.error("[referral-mint] failed for appointment", appointmentId, e);
  }
  // Both helpers log and swallow their own failures.
  await bumpPatientLastContact(patientId, input.completedAt);
  await refreshPatientVisitStats(patientId);
}
