/**
 * Phase 17 Wave 2 — Pure helpers for session lifetime checks.
 *
 * Lives outside the proxy so it can be unit-tested without Node's
 * Request/Response or Prisma. Three concerns:
 *
 *   1. Idle timeout — `lastActivityAt + clinic.sessionIdleTimeoutMinutes
 *      < now()` → kick. Bound is enforced upstream at [5, 240]; the
 *      helper still re-clamps so a stale DB row can't blow past the
 *      bound.
 *   2. Forced 8h re-rotation — `lastSessionRotatedAt + 8h < now()` →
 *      kick. Hard cap regardless of activity.
 *   3. Concurrent-session — given a list of prior UserSessions for the
 *      same user, "kick all but the freshest" so a new login becomes the
 *      single live session. The helper returns the IDs to delete. The
 *      platform owner (SUPER_ADMIN) keeps his 2 most recent ones besides the
 *      new one (owner request 09.10.2026).
 */

export const FORCED_REROTATE_MS = 8 * 60 * 60 * 1000; // 8h
/**
 * The clinic's iPad reception account (owner request 08.10.2026): it walks
 * around with the receptionist and lies on the desk between patients, so
 * the idle timeout signed it out several times a day. It has no idle
 * timeout and signs in once a morning: the cap covers a working day.
 */
export const TABLET_REROTATE_MS = 16 * 60 * 60 * 1000; // 16h
export const IDLE_TIMEOUT_MIN = 5;
export const IDLE_TIMEOUT_MAX = 240;
export const IDLE_TIMEOUT_DEFAULT = 30;

export type SessionLifetimeReason = "idle" | "forced-rerotate" | null;

export type CheckLifetimeArgs = {
  /** UserSession row's lastActivityAt. */
  lastActivityAt: Date;
  /** User.lastSessionRotatedAt — null means "never rotated"; treat as session
   *  creation time so a brand-new session won't trip the forced-rerotate. */
  lastSessionRotatedAt: Date | null;
  /** Session creation time, used as a fallback when `lastSessionRotatedAt`
   *  is null. */
  sessionCreatedAt: Date;
  /** Effective per-clinic idle window in minutes; null: no idle timeout
   *  (the iPad reception account). */
  idleTimeoutMinutes: number | null;
  /** The forced re-sign-in window; FORCED_REROTATE_MS unless given. */
  rerotateMs?: number;
  /** Now (test-injectable). */
  now?: Date;
};

/**
 * Decide whether a session is still alive. Returns `null` when alive,
 * otherwise a string code identifying which limit tripped.
 */
export function checkSessionLifetime(
  args: CheckLifetimeArgs,
): SessionLifetimeReason {
  const now = args.now ?? new Date();
  if (args.idleTimeoutMinutes !== null) {
    const idleClamped = clampIdleMinutes(args.idleTimeoutMinutes);
    const idleCutoffMs = idleClamped * 60 * 1000;
    const idleAge = now.getTime() - args.lastActivityAt.getTime();
    if (idleAge > idleCutoffMs) return "idle";
  }

  // For the forced-rerotate window we use lastSessionRotatedAt when it's
  // populated; otherwise the session's own creation time. A user who's
  // never had their session rotated and was created ≤8h ago is fine.
  const rotateAnchor = args.lastSessionRotatedAt ?? args.sessionCreatedAt;
  const rotateAge = now.getTime() - rotateAnchor.getTime();
  if (rotateAge > (args.rerotateMs ?? FORCED_REROTATE_MS)) return "forced-rerotate";

  return null;
}

export function clampIdleMinutes(v: number): number {
  if (!Number.isFinite(v)) return IDLE_TIMEOUT_DEFAULT;
  if (v < IDLE_TIMEOUT_MIN) return IDLE_TIMEOUT_MIN;
  if (v > IDLE_TIMEOUT_MAX) return IDLE_TIMEOUT_MAX;
  return Math.floor(v);
}

// ---------------------------------------------------------------------------
// Concurrent-session limit
// ---------------------------------------------------------------------------

export type SessionRow = {
  id: string;
  createdAt: Date;
};

/**
 * How many earlier sessions a sign-in leaves alive, by role. The platform
 * owner works from a laptop, a phone and a spare (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §1): under "one session" a phone sign-in
 * threw the laptop out. He keeps the new session plus 2 previous, 3 in all.
 * Clinic staff stay at one session: a shared reception PC must not keep the
 * previous person signed in elsewhere.
 */
export const SUPER_ADMIN_PRIOR_SESSIONS_KEPT = 2;

export function priorSessionsKept(role: string | null | undefined): number {
  return role === "SUPER_ADMIN" ? SUPER_ADMIN_PRIOR_SESSIONS_KEPT : 0;
}

/**
 * Given the set of UserSessions belonging to one user (typically read out
 * of the DB just before issuing a new one), return the IDs that should be
 * deleted. The caller appends the new session AFTER calling this helper.
 *
 * Implementation note: rows are ranked by createdAt, newest first; the
 * first `priorSessionsKept(role)` stay (none for clinic staff) and every
 * other row is "kicked". The audit emitter logs each kicked id with
 * `CONCURRENT_SESSION_KICKED`.
 */
export function pickSessionsToKick(
  rows: SessionRow[],
  role?: string | null,
): string[] {
  if (rows.length === 0) return [];
  // Defensive copy — never mutate caller's array.
  const sorted = [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  // Spec: "1 active session per user". A fresh login ALWAYS becomes the
  // single live session; therefore EVERY existing row is kicked, not just
  // the older ones. The SUPER_ADMIN exception keeps his newest 2.
  return sorted.slice(priorSessionsKept(role)).map((r) => r.id);
}
