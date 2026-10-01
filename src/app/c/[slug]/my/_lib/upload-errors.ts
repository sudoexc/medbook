/**
 * What a refused document upload tells the patient.
 *
 * The upload limits (audit CD-04) answer 429 with a reason: too many
 * uploads this hour, the day's 200 MB, or the account's 1 GB. Each gets its
 * own advice instead of «не удалось загрузить файл», which sent patients to
 * retry straight into the same wall. Pure, like `action-errors.ts`.
 */
import type { Dict } from "../_components/mini-i18n";

type UploadError = {
  status?: number;
  data?: { reason?: unknown } | null;
};

export function uploadErrorText(e: unknown, d: Dict["documents"]): string {
  const err = (e ?? {}) as UploadError;
  if (err.status === 413) return d.uploadErrorTooLarge;
  if (err.status === 415) return d.uploadErrorMime;
  if (err.status === 429) {
    const reason = err.data?.reason;
    if (reason === "upload_daily_quota") return d.uploadErrorDailyQuota;
    if (reason === "upload_total_quota") return d.uploadErrorTotalQuota;
    return d.uploadErrorRateLimited;
  }
  return d.uploadErrorGeneric;
}
