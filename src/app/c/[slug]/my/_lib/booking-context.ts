/**
 * Whose booking is this? (audit MA-02)
 *
 * The active relative lives only in the URL (`?onBehalfOf=`, see
 * use-active-context). Every hop of the booking wizard used to build its URL
 * without it, so a booking started for «Мама» reached the confirm screen as
 * the owner and was created on HIS card: her exam, diagnosis and
 * prescriptions then went into his record while she was not booked at all.
 *
 * Two guards, both pure so they are unit-tested:
 *   - `bookHref` builds every wizard URL and always carries the context;
 *   - the draft remembers who it was assembled for, and the confirm screen
 *     refuses to submit when that differs from the context it is showing.
 */

export type BookStep = "service" | "doctor" | "slot" | "confirm" | "done";

/** URL of a wizard step (or the done page) that keeps the active relative. */
export function bookHref(
  clinicSlug: string,
  step: BookStep,
  onBehalfOf: string | null | undefined,
  extra: Record<string, string | null | undefined> = {},
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) {
    if (value) sp.set(key, value);
  }
  if (onBehalfOf) sp.set("onBehalfOf", onBehalfOf);
  const qs = sp.toString();
  return `/c/${clinicSlug}/my/book/${step}${qs ? `?${qs}` : ""}`;
}

/**
 * True when the draft was assembled for the person the confirm screen is
 * about to book. A draft saved before this field existed counts as «self».
 */
export function bookingContextMatches(
  draftFor: string | null | undefined,
  active: string | null | undefined,
): boolean {
  return (draftFor ?? null) === (active ?? null);
}
