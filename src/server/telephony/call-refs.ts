/**
 * The rows a Call may point at must be this clinic's (audit CM-09).
 *
 * `Call.patientId`, `operatorId` and `appointmentId` came straight from the
 * request body. The foreign keys carry no clinicId, and the tenant extension
 * scopes only the top-level query, not a nested `include`: a staff member
 * who knew another clinic's patient id could PATCH it onto his own call and
 * read back that patient's name, phone and segment. Every id is now looked
 * up with the clinic pinned explicitly (User is not tenant-scoped at all),
 * the same way referrals and documents check theirs.
 */
import type { prisma as Prisma } from "@/lib/prisma";

type Db = Pick<typeof Prisma, "patient" | "user" | "appointment">;

export type CallRefs = {
  patientId?: string | null;
  operatorId?: string | null;
  appointmentId?: string | null;
};

export type CallRefProblem =
  | "patient_not_found"
  | "operator_not_found"
  | "appointment_not_found"
  | "appointment_patient_mismatch";

/**
 * Null when every given id belongs to `clinicId`, else the first problem.
 * `patientIdForAppointment` is the patient the call is (or stays) linked to,
 * so a PATCH that sets only the appointment still has to match it.
 */
export async function checkCallRefs(
  db: Db,
  clinicId: string,
  refs: CallRefs,
  patientIdForAppointment: string | null = refs.patientId ?? null,
): Promise<CallRefProblem | null> {
  if (refs.patientId) {
    const patient = await db.patient.findFirst({
      where: { id: refs.patientId, clinicId },
      select: { id: true },
    });
    if (!patient) return "patient_not_found";
  }
  if (refs.operatorId) {
    const user = await db.user.findFirst({
      where: { id: refs.operatorId, clinicId },
      select: { id: true },
    });
    if (!user) return "operator_not_found";
  }
  if (refs.appointmentId) {
    const appointment = await db.appointment.findFirst({
      where: { id: refs.appointmentId, clinicId },
      select: { patientId: true },
    });
    if (!appointment) return "appointment_not_found";
    if (patientIdForAppointment && appointment.patientId !== patientIdForAppointment) {
      return "appointment_patient_mismatch";
    }
  }
  return null;
}
