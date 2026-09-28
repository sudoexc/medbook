/**
 * What closing a medical case does to its prescriptions (audit PT-10).
 *
 * Closing a case («Лечение завершено», «Пациент потерян», «Передан другому
 * врачу») used to stamp `closedAt` and nothing else. The case's courses
 * stayed ACTIVE, so the hourly worker kept sending «Пора принять
 * Карбамазепин 200 мг» to a patient another doctor now treats, forever for
 * an open-ended course, and the Mini App kept listing the drug.
 *
 * Now the courses end with the case, in the same transaction, by the rule
 * in `src/lib/cases/case-close.ts` (RESOLVED: COMPLETED; ABANDONED /
 * TRANSFERRED: CANCELLED). Both statuses drop the drug from the patient's
 * Mini App schedule and from the reminder tick (which also skips closed
 * cases on its own, for courses added to a case after it was closed). `remindersEnabled` is left as the
 * doctor set it, so a case reopened by mistake is one status change away
 * from reminding again. Re-opening the case does not revive the courses by
 * itself: which drugs still apply is the doctor's call, on the case page.
 */
import type { prisma } from "@/lib/prisma";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { ActorRole, Surface } from "@/server/realtime/envelope";
import {
  RUNNING_PRESCRIPTION_STATUSES,
  prescriptionStatusOnCaseClose,
} from "@/lib/cases/case-close";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type CaseCloseActor = {
  role: ActorRole;
  userId: string | null;
  surface: Surface;
};

/**
 * End the case's running courses and tell the Mini App. Returns the ids of
 * the courses it ended (empty when the status is not a closing one or
 * nothing was running).
 */
export async function endCasePrescriptions(
  tx: Tx,
  input: {
    caseId: string;
    clinicId: string;
    patientId: string;
    caseStatus: string;
    actor: CaseCloseActor;
  },
): Promise<string[]> {
  const next = prescriptionStatusOnCaseClose(input.caseStatus);
  if (!next) return [];
  const running = await tx.prescription.findMany({
    where: {
      caseId: input.caseId,
      status: { in: [...RUNNING_PRESCRIPTION_STATUSES] },
    },
    select: { id: true },
  });
  if (running.length === 0) return [];
  const ids = running.map((r) => r.id);
  await tx.prescription.updateMany({
    where: { id: { in: ids } },
    data: { status: next },
  });
  const correlationId = newCorrelationId();
  for (const prescriptionId of ids) {
    // Same event the prescription editor publishes: the patient's Mini App
    // «Лекарства» refetches and the drug disappears.
    await publishViaOutbox(tx, {
      correlationId,
      actor: {
        role: input.actor.role,
        userId: input.actor.userId,
        patientId: null,
        onBehalfOfPatientId: null,
        label: input.actor.userId ? `user:${input.actor.userId}` : "system",
      },
      surface: input.actor.surface,
      tenantScope: { clinicId: input.clinicId, patientId: input.patientId },
      type: "prescription.updated",
      payload: {
        prescriptionId,
        patientId: input.patientId,
        status: next,
      },
    });
  }
  return ids;
}
