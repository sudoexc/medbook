/**
 * Request-body readers shared by the admin subscription routes.
 */

/**
 * `{ expectedTrialEndsAt }` from an optional JSON body (audit G5-01):
 * undefined when absent (no body, or the key left out), null for an
 * explicit null, a Date for an ISO string, "invalid" for anything else.
 */
export async function readExpectedTrialEndsAt(
  request: Request,
): Promise<Date | null | undefined | "invalid"> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (!text.trim()) return undefined;
    raw = JSON.parse(text);
  } catch {
    return "invalid";
  }
  if (!raw || typeof raw !== "object" || !("expectedTrialEndsAt" in raw)) {
    return undefined;
  }
  const v = (raw as { expectedTrialEndsAt?: unknown }).expectedTrialEndsAt;
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return "invalid";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
