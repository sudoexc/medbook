/**
 * Server loader for the per-doctor price and duration of services (audit
 * DR-02); the rule itself lives in `@/lib/doctor-service-terms` so the
 * booking dialog sizes the slot exactly like the server prices it.
 */
import { prisma } from "@/lib/prisma";
import {
  effectiveServiceTerms,
  type EffectiveServiceTerms,
} from "@/lib/doctor-service-terms";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * `serviceId → { price, durationMin }` for this doctor. Services missing
 * from the catalog (or not matching `where`) are absent from the map; a
 * service the doctor has no link to keeps its catalog terms, so a legacy
 * booking for an unlinked service still prices the way it always did.
 */
export async function loadDoctorServiceTerms(
  client: PrismaLike,
  args: {
    doctorId: string;
    serviceIds: readonly string[];
    /** Extra catalog filter, e.g. `{ clinicId, isActive: true }` for booking. */
    where?: Record<string, unknown>;
  },
): Promise<Map<string, EffectiveServiceTerms>> {
  const ids = [...new Set(args.serviceIds)];
  const out = new Map<string, EffectiveServiceTerms>();
  if (ids.length === 0) return out;
  const [services, links] = await Promise.all([
    client.service.findMany({
      where: { id: { in: ids }, ...(args.where ?? {}) },
      select: { id: true, priceBase: true, durationMin: true },
    }),
    client.serviceOnDoctor.findMany({
      where: { doctorId: args.doctorId, serviceId: { in: ids } },
      select: { serviceId: true, priceOverride: true, durationMinOverride: true },
    }),
  ]);
  const linkBy = new Map(links.map((l) => [l.serviceId, l]));
  for (const s of services) {
    out.set(s.id, effectiveServiceTerms(s, linkBy.get(s.id)));
  }
  return out;
}

/** Sum of the doctor's durations for a set of services; 0 when none resolve. */
export async function doctorServicesDuration(
  client: PrismaLike,
  args: { doctorId: string; serviceIds: readonly string[]; where?: Record<string, unknown> },
): Promise<number> {
  const terms = await loadDoctorServiceTerms(client, args);
  let total = 0;
  for (const t of terms.values()) total += t.durationMin;
  return total;
}
