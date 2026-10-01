/**
 * Who may set an appointment's price by hand (audit AP-03).
 *
 * The visit's price is computed by the pricing engine from its services
 * (the doctor's price per service, the free repeat, a referral reward).
 * Typing a final price, a discount or a per-line price overrides it, and
 * the visit's revenue, the doctor's commission and the patient's debt all
 * follow. That is the front desk's and the administrator's call, not the
 * doctor's: a doctor's own PATCH used to be able to set `priceFinal: 0` on
 * his visits. The CRM never sends these fields from a doctor's screen, so
 * the rule takes nothing away from his work.
 *
 * Client-safe: no server imports.
 */

/** Roles allowed to override an appointment's price. */
export const PRICE_EDIT_ROLES: ReadonlySet<string> = new Set(["ADMIN", "RECEPTIONIST"]);

export type PriceFields = {
  priceFinal?: number | null;
  discountPct?: number;
  discountAmount?: number;
  services?: ReadonlyArray<{ priceOverride?: number }>;
};

/**
 * The price override fields a create or update body carries, by name (for
 * the 403 and the audit row). Empty when the body leaves pricing to the
 * engine.
 */
export function priceFieldsIn(body: PriceFields): string[] {
  const fields: string[] = [];
  if (body.priceFinal !== undefined) fields.push("priceFinal");
  if (body.discountPct !== undefined) fields.push("discountPct");
  if (body.discountAmount !== undefined) fields.push("discountAmount");
  if (body.services?.some((s) => s.priceOverride !== undefined)) {
    fields.push("services.priceOverride");
  }
  return fields;
}

/** May this role override a price? Unknown roles may not. */
export function canEditPrice(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && PRICE_EDIT_ROLES.has(role);
}
