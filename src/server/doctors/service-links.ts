/**
 * Guard for the service ids a doctor is linked to on create / edit (audit
 * DR-12).
 *
 * `ServiceOnDoctor` carries no clinicId and is exempt from the tenant
 * extension, and its foreign key only proves the service exists somewhere.
 * POST /api/crm/doctors and PATCH /api/crm/doctors/[id] wrote the posted ids
 * as is, so another clinic's service id put that service (with its price)
 * on our doctor's card and our doctor on the other clinic's service card,
 * where he even counted as its "active doctor". PUT /doctors/[id]/services
 * always checked; the two other write paths now share this check.
 */
import { prisma } from "@/lib/prisma";

/**
 * Of `serviceIds`, the ones that are not services of `clinicId`. Empty means
 * every link may be written. The tenant extension already narrows
 * `service.findMany` to the session's clinic; the explicit `clinicId` keeps
 * the answer right for callers outside a tenant context too.
 */
export async function findForeignServiceIds(
  serviceIds: readonly string[],
  clinicId: string | null | undefined,
): Promise<string[]> {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return [];
  const found = await prisma.service.findMany({
    where: { id: { in: ids }, ...(clinicId ? { clinicId } : {}) },
    select: { id: true },
  });
  const ours = new Set(found.map((s) => s.id));
  return ids.filter((id) => !ours.has(id));
}
