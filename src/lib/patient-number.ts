/**
 * Patient number formatting / parsing.
 *
 * Each clinic numbers its own patients 1, 2, 3 … (stored in
 * Patient.patientNumber). For display we pad to 5 digits with a leading
 * "P-" prefix: 125 → "P-00125". Numbers above 99999 are not truncated —
 * they grow naturally ("P-100000" etc.).
 */

export const PATIENT_NUMBER_PREFIX = "P-";
export const PATIENT_NUMBER_MIN_DIGITS = 5;

export function formatPatientNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${PATIENT_NUMBER_PREFIX}${String(n).padStart(PATIENT_NUMBER_MIN_DIGITS, "0")}`;
}

/**
 * Parse a user-typed patient number back to its integer form.
 * Accepts "P-00125", "p-125", "P00125", "00125", "125" — anything that
 * boils down to digits.
 */
export function parsePatientNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^[Pp]-?/, "");
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
