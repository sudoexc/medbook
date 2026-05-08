/**
 * Match appointment service name to doctor's service price.
 * The appointment stores the localized service name (e.g., "Консультация" or "Konsultatsiya").
 * The doctor's services JSON has [{nameRu, nameUz, price}].
 */
export function getServicePrice(
  serviceName: string | null,
  doctorServices: unknown
): number {
  if (!serviceName || !doctorServices) return 0;

  const services = doctorServices as { nameRu: string; nameUz: string; price: number }[];

  for (const svc of services) {
    if (svc.nameRu === serviceName || svc.nameUz === serviceName) {
      return svc.price;
    }
  }

  return 0;
}

// `formatRevenue` removed in favour of `formatMoney` from `@/lib/format`.
// Callers should pass the amount in tiins (UZS minor units) and the active
// locale; e.g. `formatMoney(amountTiins, "UZS", locale)`.
