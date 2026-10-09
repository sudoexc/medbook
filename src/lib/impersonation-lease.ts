/**
 * The clinic banner's lease clock (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §2): a SUPER_ADMIN's visit ran out after 60
 * minutes with no warning. The banner now counts down (mm:ss), turns amber in
 * the last 5 minutes and offers «Продлить» while the 8 hour cap allows.
 *
 * Pure and client-safe: the banner feeds it the ISO times from
 * `session.user.impersonation` and its own ticking clock.
 */

/** The banner warns (amber, «Продлить») from this much time left. */
export const LEASE_WARN_MS = 5 * 60 * 1000;

export type LeaseClock = {
  leftMs: number;
  /** "mm:ss", minutes not wrapped at 60 ("60:00" right after an extension). */
  label: string;
  warn: boolean;
  expired: boolean;
  /** The 8 h cap still leaves room for another lease. */
  canExtend: boolean;
};

export function formatLeaseLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** The later of two ISO times (the server's and the one an extension returned). */
export function laterIso(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const am = toMs(a);
  const bm = toMs(b);
  if (am === null) return bm === null ? null : (b as string);
  if (bm === null) return a as string;
  return bm > am ? (b as string) : (a as string);
}

/** Null when the session carries no lease end (a JWT from before the claim). */
export function leaseClock(
  expiresAt: string | null | undefined,
  maxExpiresAt: string | null | undefined,
  now: number,
): LeaseClock | null {
  const end = toMs(expiresAt);
  if (end === null) return null;
  const leftMs = Math.max(0, end - now);
  const cap = toMs(maxExpiresAt);
  const expired = leftMs <= 0;
  return {
    leftMs,
    label: formatLeaseLeft(leftMs),
    warn: leftMs <= LEASE_WARN_MS,
    expired,
    // A second of slack: the cap and the end are both rounded to the ms.
    canExtend: !expired && (cap === null || cap - end > 1000),
  };
}
