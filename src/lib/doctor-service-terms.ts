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
