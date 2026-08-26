/**
 * "Unseen lab results" bookkeeping for the Mini App.
 *
 * The patient-facing `/api/miniapp/labs` payload has no per-patient "read"
 * column, and adding one would mean a schema migration on a live clinic. The
 * cheap, safe alternative: remember locally when the patient last *opened*
 * the labs screen and treat anything reviewed after that moment as new.
 *
 * Deliberately local-only. The worst failure mode is a badge that reappears
 * on a new device — far better than a doctor's reviewed result staying
 * invisible, which is the bug this exists to fix.
 *
 * Pure functions live here (rather than inside the component) so the badge
 * arithmetic is unit-testable without a DOM.
 */

/** Minimal shape needed to decide whether a result is new to the patient. */
export type SeenableLab = { reviewedAt: string | null };

const SEEN_KEY_PREFIX = "miniapp:labs:seenAt:";

function seenKey(clinicSlug: string): string {
  return `${SEEN_KEY_PREFIX}${clinicSlug}`;
}

/**
 * How many results were reviewed after the patient last opened the screen.
 *
 * `seenAtMs === null` means "never opened": we count everything, so the very
 * first reviewed result still announces itself. Results without `reviewedAt`
 * can't be ordered against the marker and are never counted — treating an
 * undated row as new would pin the badge on forever.
 */
export function countUnseenLabs(
  labs: ReadonlyArray<SeenableLab> | undefined | null,
  seenAtMs: number | null,
): number {
  if (!labs || labs.length === 0) return 0;
  let count = 0;
  for (const lab of labs) {
    if (!lab.reviewedAt) continue;
    const reviewed = Date.parse(lab.reviewedAt);
    if (Number.isNaN(reviewed)) continue;
    if (seenAtMs === null || reviewed > seenAtMs) count += 1;
  }
  return count;
}

/** Reads the stored marker. `null` when unset, unparsable, or unavailable. */
export function readLabsSeenAt(clinicSlug: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(seenKey(clinicSlug));
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // localStorage can be disabled in some Telegram webviews — degrade to
    // "never seen", which over-reports rather than hides results.
    return null;
  }
}

/** Stamps "the patient has now looked at the labs screen". */
export function writeLabsSeenAt(clinicSlug: string, atMs: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(seenKey(clinicSlug), String(atMs));
  } catch {
    /* ignore — badge simply stays until storage works again */
  }
}
