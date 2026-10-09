/**
 * SUPER_ADMIN «enter clinic» rules, shared by the CRM topbar switcher and
 * /admin/clinics through <ClinicEntryDialog> (Phase 19 W4: a logged reason of
 * 4+ chars and a mode).
 *
 * The questions used to be window.prompt + window.confirm. However the
 * confirm was worded, one of its two buttons entered with WRITE: first Cancel
 * (so «never mind», Esc or a browser suppressing the dialog allowed
 * mutations), then the focused OK (so a habitual second Enter did). Audit
 * CM-21 asks for a real choice instead: the dialog preselects read-only,
 * writing takes a deliberate pick, and Cancel at any point sends nothing.
 */

export type ClinicEntryMode = "WRITE" | "VIEW_ONLY";

export type ClinicEntry = {
  reason: string;
  mode: ClinicEntryMode;
  /**
   * Entering a switched-off clinic on purpose (owner request 09.10.2026):
   * set by the dialog only for such a clinic, after its warning. The route
   * refuses an inactive clinic without it.
   */
  breakGlass?: boolean;
};

export const CLINIC_ENTRY_DEFAULT_MODE: ClinicEntryMode = "VIEW_ONLY";

export const CLINIC_ENTRY_MIN_REASON = 4;
/** Same cap as SwitchClinicSchema, so the field cannot outgrow the server. */
export const CLINIC_ENTRY_MAX_REASON = 500;

export type ClinicEntryCheck =
  | ({ ok: true } & ClinicEntry)
  | { ok: false; error: "reason_too_short" };

/**
 * Radix RadioGroup hands back a plain string: anything but an exact "WRITE"
 * reads as the safe mode.
 */
export function parseClinicEntryMode(value: string): ClinicEntryMode {
  return value === "WRITE" ? "WRITE" : "VIEW_ONLY";
}

export function checkClinicEntry(reason: string, mode: string): ClinicEntryCheck {
  const trimmed = reason.trim();
  if (trimmed.length < CLINIC_ENTRY_MIN_REASON) {
    return { ok: false, error: "reason_too_short" };
  }
  return { ok: true, reason: trimmed, mode: parseClinicEntryMode(mode) };
}

/**
 * Mints the grant. Always sends the mode: the route still defaults a missing
 * one to WRITE for older callers. `breakGlass` goes only when set.
 */
export async function postClinicEntry(
  clinicId: string,
  entry: ClinicEntry,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("/api/platform/session/switch-clinic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clinicId,
      reason: entry.reason,
      mode: entry.mode,
      ...(entry.breakGlass ? { breakGlass: true } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
