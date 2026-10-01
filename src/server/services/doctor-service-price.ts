/**
 * What a service costs, and how long it takes, with THIS doctor.
 *
 * A doctor may sell a catalog service at his own price and length
 * (`ServiceOnDoctor.priceOverride` / `durationMinOverride`, the cabinet 1
 * consultation is 300 000 against the base 200 000). The kiosk shows the
 * patient that price and the walk-in stores the same one (audit Q-06), so
 * both read it here rather than each picking override or base on its own.
 * Same precedence as the landing's price sheet (`site-prices.ts`).
 *
 * Prices are in the catalog's unit (tiins), like `Service.priceBase`.
 */
export type DoctorServiceLink = {
  priceOverride: number | null;
  durationMinOverride?: number | null;
};

export function doctorServicePrice(
  link: Pick<DoctorServiceLink, "priceOverride">,
  service: { priceBase: number },
): number {
  return link.priceOverride ?? service.priceBase;
}

export function doctorServiceDurationMin(
  link: DoctorServiceLink,
  service: { durationMin: number },
): number {
  return link.durationMinOverride ?? service.durationMin;
}
