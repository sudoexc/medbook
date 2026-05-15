/**
 * Canonical doctor-side patient segmentation.
 *
 * Three places used to disagree on what `watch` / `returned` / `dormant`
 * meant:
 *   - `/api/crm/doctors/me/patient-segments` (donut) bucketed by time
 *     since last COMPLETED visit.
 *   - `/api/crm/doctors/me/patients?tab=*` (table filter) used an unrelated
 *     mix of recency + future-booking presence.
 * Clicking the donut and clicking a tab named the same thing produced
 * different rows. This module is the single source of truth: both endpoints
 * call `classifySegment` on the same `(visitsCount, daysSinceLast)` pair.
 *
 * Priority cascade is intentional — buckets are mutually exclusive so the
 * donut sums to 100 %:
 *   1. new       — first-and-only visit was recent
 *   2. active    — last visit within `ACTIVE_MAX_DAYS`
 *   3. watch     — within `WATCH_MAX_DAYS`
 *   4. returned  — within `RETURNED_MAX_DAYS`
 *   5. dormant   — older than that
 *
 * A patient with zero COMPLETED visits with the doctor doesn't belong in
 * any segment and is excluded from both the donut and tab counts.
 */

export type DoctorSegmentKey =
  | "active"
  | "watch"
  | "dormant"
  | "new"
  | "returned";

export const DOCTOR_SEGMENT_KEYS: readonly DoctorSegmentKey[] = [
  "active",
  "watch",
  "returned",
  "new",
  "dormant",
] as const;

export const DOCTOR_SEGMENT_LABELS_RU: Record<DoctorSegmentKey, string> = {
  active: "На приёме",
  watch: "На контроле",
  returned: "Вернулись",
  new: "Новые",
  dormant: "Давно не были",
};

export const NEW_MAX_DAYS = 30;
export const ACTIVE_MAX_DAYS = 30;
export const WATCH_MAX_DAYS = 90;
export const RETURNED_MAX_DAYS = 180;

export function classifyDoctorSegment(
  visitsCount: number,
  daysSinceLast: number,
): DoctorSegmentKey {
  if (visitsCount === 1 && daysSinceLast <= NEW_MAX_DAYS) return "new";
  if (daysSinceLast <= ACTIVE_MAX_DAYS) return "active";
  if (daysSinceLast <= WATCH_MAX_DAYS) return "watch";
  if (daysSinceLast <= RETURNED_MAX_DAYS) return "returned";
  return "dormant";
}

export const DAY_MS = 86_400_000;
