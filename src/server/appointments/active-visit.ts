import { prisma } from "@/lib/prisma";

/**
 * A doctor may have at most one visit IN_PROGRESS at a time. Returns the
 * other active visit for `doctorId` (if any), so a start request can be
 * rejected with a warning naming the patient already on the table.
 *
 * The check is keyed by the appointment's `doctorId`, not the clinic — a
 * receptionist starting visits for different doctors is fine; only a single
 * doctor running two concurrent visits is the conflict.
 */
export async function findOtherActiveVisit(params: {
  clinicId: string;
  doctorId: string;
  excludeAppointmentId: string;
}): Promise<{ id: string; patientName: string } | null> {
  const row = await prisma.appointment.findFirst({
    where: {
      clinicId: params.clinicId,
      doctorId: params.doctorId,
      status: "IN_PROGRESS",
      id: { not: params.excludeAppointmentId },
    },
    orderBy: { startedAt: "asc" },
    select: { id: true, patient: { select: { fullName: true } } },
  });
  return row ? { id: row.id, patientName: row.patient.fullName } : null;
}
