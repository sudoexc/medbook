/**
 * What a service costs and how long it takes WITH A GIVEN DOCTOR (audit
 * DR-02).
 *
 * `ServiceOnDoctor.priceOverride` / `durationMinOverride` let the clinic
 * charge more for its head doctor and give a senior colleague longer slots
 * for the same nominal service. Only the kiosk and the public price sheet
 * read them; booking took the catalog price and duration, so the clinic
 * billed 200 000 for a consult it priced at 300 000 with that doctor and
 * stacked his 45-minute visits 30 minutes apart. Every surface that prices
 * or sizes a visit for a known doctor goes through this one rule.
 *
 * Units: prices are tiyin like `Service.priceBase` (the CRM inputs type сумы
 * and convert with `sumToTiyin`); durations are minutes. A null override
 * falls back to the catalog value.
 *
 * Client-safe: no server imports.
 */

export type CatalogServiceTerms = {
  priceBase: number;
  durationMin: number;
};

export type DoctorServiceOverride = {
  priceOverride: number | null;
  durationMinOverride: number | null;
};

export type EffectiveServiceTerms = {
  price: number;
  durationMin: number;
};

export function effectiveServiceTerms(
  service: CatalogServiceTerms,
  link: DoctorServiceOverride | null | undefined,
): EffectiveServiceTerms {
  return {
    price: link?.priceOverride ?? service.priceBase,
    durationMin: link?.durationMinOverride ?? service.durationMin,
  };
}

/** Per-doctor duration bounds: the catalog's own range (`Service.durationMin`). */
export const DOCTOR_SERVICE_DURATION_MIN = 5;
export const DOCTOR_SERVICE_DURATION_MAX = 480;

/**
 * Length of a visit for these services with one doctor: the sum of his
 * durations, each service once (how booking derives it). Null when a
 * service does not resolve or there are none.
 */
export function servicesDurationWith(
  serviceIds: readonly string[],
  terms: ReadonlyMap<string, EffectiveServiceTerms>,
): number | null {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return null;
  let total = 0;
  for (const id of ids) {
    const t = terms.get(id);
    if (!t) return null;
    total += t.durationMin;
  }
  return total;
}

/**
 * The visit's length after it moves to another doctor (review of DR-02).
 * A block sized by the leaving doctor's durations, which is what booking
 * derives, takes the new doctor's: his 45-minute consult moved to a
 * 30-minute colleague would otherwise hold 15 idle minutes, and the reverse
 * move would run into the next patient. A block staff resized by hand on
 * the calendar keeps its length, and so does a visit whose services do not
 * all resolve.
 */
export function durationAfterDoctorChange(args: {
  durationMin: number;
  serviceIds: readonly string[];
  from: ReadonlyMap<string, EffectiveServiceTerms>;
  to: ReadonlyMap<string, EffectiveServiceTerms>;
}): number {
  const before = servicesDurationWith(args.serviceIds, args.from);
  const after = servicesDurationWith(args.serviceIds, args.to);
  if (before === null || after === null) return args.durationMin;
  return args.durationMin === before ? after : args.durationMin;
}

/**
 * The line prices that change when a visit moves to another doctor (review
 * of DR-02): every line takes the new doctor's price for its service, the
 * snapshot booking him would have taken. No CRM screen types a line price
 * (a reduction is the visit's discount, which stays and applies on top), so
 * there is no manual price to keep. A service that no longer resolves keeps
 * its line.
 */
export function linePricesForDoctor(
  lines: readonly { serviceId: string; priceSnap: number }[],
  to: ReadonlyMap<string, EffectiveServiceTerms>,
): { serviceId: string; priceSnap: number }[] {
  const out: { serviceId: string; priceSnap: number }[] = [];
  for (const line of lines) {
    const t = to.get(line.serviceId);
    if (t && t.price !== line.priceSnap) {
      out.push({ serviceId: line.serviceId, priceSnap: t.price });
    }
  }
  return out;
}
