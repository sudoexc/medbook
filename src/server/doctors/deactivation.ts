/**
 * Guard for taking a doctor out of service.
 *
 * Product rule (Phase 11): an active service must always have at least one
 * active doctor behind it, otherwise reception can pick it on the booking
 * form and then find nobody to book with. `DELETE /api/crm/doctors/[id]`
 * enforced this from the start; `PATCH` with `isActive: false` did not, so
 * the exact same deactivation slipped through the side door and orphaned
 * services. Both paths now share this check.
 *
 * Returns the services that would be left with no provider — empty array
 * means deactivation is safe.
 */
import { prisma } from "@/lib/prisma";

export interface OrphanedService {
  id: string;
  nameRu: string;
  nameUz: string;
}

export async function findServicesOrphanedByDeactivating(
  doctorId: string,
): Promise<OrphanedService[]> {
  const myLinks = await prisma.serviceOnDoctor.findMany({
    where: { doctorId },
    select: { serviceId: true },
  });
  if (myLinks.length === 0) return [];

  const serviceIds = myLinks.map((l) => l.serviceId);
  const stillCovered = await prisma.serviceOnDoctor.findMany({
    where: {
      serviceId: { in: serviceIds },
      doctorId: { not: doctorId },
      doctor: { isActive: true },
    },
    select: { serviceId: true },
  });
  const covered = new Set(stillCovered.map((r) => r.serviceId));
  const orphanedIds = serviceIds.filter((sid) => !covered.has(sid));
  if (orphanedIds.length === 0) return [];

  // Only active services block the deactivation — an already-retired service
  // losing its last doctor is not a product problem.
  return prisma.service.findMany({
    where: { id: { in: orphanedIds }, isActive: true },
    select: { id: true, nameRu: true, nameUz: true },
    orderBy: { nameRu: "asc" },
  });
}

/**
 * What still ties a doctor to clinical history, and therefore blocks a
 * permanent delete. These relations are `onDelete: Restrict` in the schema —
 * the database would refuse anyway; counting them first turns a raw FK error
 * into an explanation the receptionist can act on.
 *
 * Deliberately NOT blocking: schedules, time off, presets, service links and
 * empty-slot snapshots (all `Cascade` — configuration, not history), medical
 * cases (`SetNull` — the case outlives its doctor) and website leads (we
 * detach them, a lead is marketing, not a medical record).
 */
export interface DoctorDeleteBlockers {
  appointments: number;
  visitNotes: number;
  amendments: number;
  prescriptions: number;
  reviews: number;
  total: number;
}

export async function countDoctorDeleteBlockers(
  doctorId: string,
): Promise<DoctorDeleteBlockers> {
  const [appointments, visitNotes, amendments, prescriptions, reviews] =
    await Promise.all([
      prisma.appointment.count({ where: { doctorId } }),
      prisma.visitNote.count({ where: { doctorId } }),
      prisma.visitNoteAmendment.count({ where: { doctorId } }),
      prisma.prescription.count({ where: { doctorId } }),
      prisma.patientReview.count({ where: { doctorId } }),
    ]);
  return {
    appointments,
    visitNotes,
    amendments,
    prescriptions,
    reviews,
    total: appointments + visitNotes + amendments + prescriptions + reviews,
  };
}

/**
 * Future work still pointed at this doctor. Deactivation does NOT block on
 * it (the clinic deactivates doctors who simply don't use the CRM, and a
 * hard block would force cancelling real visits first) — but it must never
 * be silent: these appointments keep firing patient reminders while nobody
 * processes them in the CRM. The count rides on the deactivation response
 * so the UI can warn loudly.
 */
export async function countStrandedAppointments(
  doctorId: string,
): Promise<number> {
  return prisma.appointment.count({
    where: {
      doctorId,
      date: { gte: new Date() },
      status: { in: ["BOOKED", "CONFIRMED", "WAITING"] },
    },
  });
}
