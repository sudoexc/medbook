/**
 * Phase G6 — clinic-side hide list for curated catalogs.
 *
 * Each catalog GET route (drugs / handouts / labs / protocols) calls
 * `loadHiddenCodes(clinicId, entityType)` after fetching the global rows
 * and filters out anything whose `code` (or `id`, for drugs) appears in
 * the returned Set. The overlay is per-clinic, not per-user — doctors
 * inside the same clinic see the same hide list.
 *
 * Returns an empty Set when the caller has no clinicId (SUPER_ADMIN
 * looking at the platform-wide view) so they still see everything.
 */
import { prisma } from "@/lib/prisma";
import type { CatalogEntityType } from "@/generated/prisma/client";

export async function loadHiddenCodes(
  clinicId: string | null | undefined,
  entityType: CatalogEntityType,
): Promise<Set<string>> {
  if (!clinicId) return new Set();
  const rows = await prisma.clinicCatalogOverlay.findMany({
    where: { clinicId, entityType, hideGlobal: true },
    select: { entityCode: true },
  });
  return new Set(rows.map((r) => r.entityCode));
}
