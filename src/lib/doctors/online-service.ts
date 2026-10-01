/**
 * Which service a Mini App booking with a doctor is made for (audit MA-08).
 *
 * The booking wizard asks the patient for a specialty, a doctor and a time,
 * never a service, yet the booking needs one: it sets the price and the
 * slot length. It used to be guessed on the phone: the first linked service
 * whose category contained «консульт», else the cheapest, archived services
 * included. An archived «Консультация (2025)» still linked to the doctor
 * failed every booking with service_not_found; a doctor with «Первичная» and
 * «Повторная» консультация got whichever row the database returned first,
 * with its price.
 *
 * Now it is explicit:
 *   - the admin's pick (`Doctor.onlineServiceId`), while it is one of the
 *     doctor's active linked services;
 *   - else the doctor's only active service, which leaves nothing to guess;
 *   - else none: the doctor has no active service (not shown in the
 *     wizard) or several and no pick (shown, with «запишитесь по
 *     телефону», until the admin picks one).
 *
 * Client-safe and pure: the Mini App roster, the booking POST and the CRM
 * doctor page all use it.
 */

export type OnlineServiceLink = { serviceId: string; isActive: boolean };

export type OnlineServiceResolution =
  | { kind: "chosen"; serviceId: string }
  | { kind: "only"; serviceId: string }
  | { kind: "none" }
  | { kind: "ambiguous" };

export function resolveOnlineService(
  chosenServiceId: string | null | undefined,
  links: readonly OnlineServiceLink[],
): OnlineServiceResolution {
  const active = links.filter((l) => l.isActive);
  if (chosenServiceId && active.some((l) => l.serviceId === chosenServiceId)) {
    return { kind: "chosen", serviceId: chosenServiceId };
  }
  const ids = Array.from(new Set(active.map((l) => l.serviceId)));
  if (ids.length === 1) return { kind: "only", serviceId: ids[0]! };
  if (ids.length === 0) return { kind: "none" };
  return { kind: "ambiguous" };
}

/** The service id to book with, or null when the doctor is not bookable online. */
export function onlineServiceIdOf(resolution: OnlineServiceResolution): string | null {
  return resolution.kind === "chosen" || resolution.kind === "only"
    ? resolution.serviceId
    : null;
}
