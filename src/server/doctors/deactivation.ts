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
