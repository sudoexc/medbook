/**
 * Staff session guard: the one place that decides whether a NextAuth JWT still
 * stands for a live, allowed staff session (audit SEC-05, SEC-06, SEC-07,
 * DC-02).
 *
 * What was wrong. The JWT is valid for 24h and carried role / clinicId /
 * mustChangePassword frozen at sign-in. The server-side `UserSession` row
 * (idle timeout, 8h cap, one session per user) was only consulted by the proxy
 * for /crm page navigations, and only when the separate `crm_user_session`
 * cookie arrived; a request without it was waved through as "legacy". So a
 * kicked, idled out or signed-out browser kept working, the whole doctor
 * cabinet and every /api route skipped the checks, and a deactivated, demoted
 * or moved employee kept their old access until the JWT expired.
 *
 * What it does now. The NextAuth `jwt` callback runs on EVERY `auth()` call
 * (pages, layouts, route handlers, the proxy, /api/auth/session) and asks this
 * module first. A verdict of "no" makes `auth()` return null everywhere at
 * once: pages redirect to /login, APIs answer 401. A "yes" hands back the
 * user's CURRENT role / clinic / mustChangePassword from the database, so a
 * demotion takes effect on the next request without a re-login.
 *
 * Binding a JWT to its session row:
 *   - `sid` — JWTs minted from now on carry the UserSession id (the JWT is
 *     encrypted, so the claim cannot be forged or swapped);
 *   - `cookie` — JWTs minted before this change have no `sid`; they are still
 *     honoured through the `crm_user_session` cookie until they age out (24h);
 *   - `none` — neither: the session was kicked or signed out. Rejected;
 *   - `unbound` — minting the row failed at sign-in (DB blip) or the cookie
 *     store could not be read. Fail open on the binding (other checks still
 *     run) rather than trap the user in a login loop.
 *
 * DB errors fail open (the claims stay as they are), like the proxy always
 * did: a flaky database must not log the whole clinic out.
 *
 * The decision itself (`decideStaffSession`) is pure and unit-tested; the rest
 * is loading, a 10-second cache (the same request calls `auth()` several
 * times) and fire-and-forget bookkeeping.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import type { Role } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  checkSessionLifetime,
  IDLE_TIMEOUT_DEFAULT,
} from "./session-security";

export type SessionBinding =
  | { kind: "sid"; sessionId: string }
  | { kind: "cookie"; tokenHash: string }
  | { kind: "none" }
  | { kind: "unbound" };

export type SessionRejectReason =
  | "expired"
  | "idle"
  | "forced-rerotate"
  | "inactive"
  | "moved";

export type GuardClaims = {
  userId: string;
  role: Role;
  /** The clinic the JWT was issued for (for SUPER_ADMIN: possibly an
   *  impersonated clinic, which is not compared). */
  clinicId: string | null;
};

export type GuardRow = {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
};

export type GuardUser = {
  id: string;
  active: boolean;
  role: Role;
  clinicId: string | null;
  mustChangePassword: boolean;
  lastSessionRotatedAt: Date | null;
  idleTimeoutMinutes: number | null;
};

export type FreshClaims = {
  role: Role;
  clinicId: string | null;
  mustChangePassword: boolean;
};

export type StaffSessionVerdict =
  | { ok: true; sessionId: string | null; fresh: FreshClaims | null }
  | { ok: false; reason: SessionRejectReason; sessionId: string | null };

/**
 * Deploy transition for pre-`sid` sessions: until now `lastActivityAt` was
 * bumped only by /crm page navigations, so a doctor working all morning in the
 * cabinet, or a receptionist on the live queue screen, looks idle for hours.
 * Enforcing idle on those rows from the first request after the deploy would
 * log out exactly the people who are working. For cookie-bound (legacy)
 * sessions the idle clock therefore starts no earlier than this process's
 * start. Such sessions are gone within 8h (forced re-rotation); sessions
 * minted from now on are bumped by user activity and get no grace.
 */
const PROCESS_STARTED_AT = new Date();

/** Bump `lastActivityAt` at most this often per session. */
export const ACTIVITY_BUMP_MS = 60_000;
/** How long a loaded (row, user) snapshot is reused. Bounds how late a
 *  deactivation or revocation is noticed. */
export const GUARD_CACHE_TTL_MS = 10_000;
const GUARD_CACHE_MAX = 5_000;

export function decideStaffSession(args: {
  claims: GuardClaims;
  binding: SessionBinding;
  row: GuardRow | null;
  user: GuardUser | null;
  now: Date;
  legacyIdleFloor?: Date | null;
}): StaffSessionVerdict {
  const { claims, binding, row, user, now } = args;
  const sessionId = row?.id ?? null;
  const reject = (reason: SessionRejectReason): StaffSessionVerdict => ({
    ok: false,
    reason,
    sessionId,
  });

  if (!user || !user.active) return reject("inactive");

  // Moving between the platform (SUPER_ADMIN, no home clinic) and a clinic
  // role, or between clinics, changes what every tenant-scoped query means.
  // Force a clean sign-in instead of silently re-pointing the open tabs.
  const wasSuper = claims.role === "SUPER_ADMIN";
  const isSuper = user.role === "SUPER_ADMIN";
  if (wasSuper !== isSuper) return reject("moved");
  if (!isSuper && user.clinicId !== claims.clinicId) return reject("moved");

  if (binding.kind === "none") return reject("expired");
  if (binding.kind === "sid" || binding.kind === "cookie") {
    if (!row || row.userId !== claims.userId) return reject("expired");
    const floor =
      binding.kind === "cookie" && args.legacyIdleFloor
        ? args.legacyIdleFloor
        : null;
    const lastActivityAt =
      floor && floor.getTime() > row.lastActivityAt.getTime()
        ? floor
        : row.lastActivityAt;
    const lifetime = checkSessionLifetime({
      lastActivityAt,
      lastSessionRotatedAt: user.lastSessionRotatedAt,
      sessionCreatedAt: row.createdAt,
      idleTimeoutMinutes: user.idleTimeoutMinutes ?? IDLE_TIMEOUT_DEFAULT,
      now,
    });
    if (lifetime) return reject(lifetime);
  }

  return {
    ok: true,
    sessionId,
    fresh: {
      role: user.role,
      clinicId: user.clinicId,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

// ---------------------------------------------------------------------------
// Snapshot cache (process-wide, shared by the proxy and route bundles)
// ---------------------------------------------------------------------------

type Snapshot = {
  row: GuardRow | null;
  user: GuardUser | null;
  loadedAt: number;
};

const CACHE_KEY = Symbol.for("medbook.session-guard.cache");

function cache(): Map<string, Snapshot> {
  const g = globalThis as unknown as Record<symbol, Map<string, Snapshot> | undefined>;
  let m = g[CACHE_KEY];
  if (!m) {
    m = new Map();
    g[CACHE_KEY] = m;
  }
  return m;
}

function cacheKey(claims: GuardClaims, binding: SessionBinding): string {
  const b =
    binding.kind === "sid"
      ? `sid:${binding.sessionId}`
      : binding.kind === "cookie"
        ? `ck:${binding.tokenHash}`
        : binding.kind;
  return `${claims.userId}|${b}`;
}

function cachePut(key: string, snap: Snapshot): void {
  const m = cache();
  m.delete(key);
  m.set(key, snap);
  if (m.size > GUARD_CACHE_MAX) {
    for (const k of m.keys()) {
      if (m.size <= GUARD_CACHE_MAX) break;
      m.delete(k);
    }
  }
}

/** Forget cached snapshots of one user (after revoking their sessions or
 *  changing their account), or of everyone. */
export function invalidateSessionGuardCache(userId?: string): void {
  const m = cache();
  if (!userId) {
    m.clear();
    return;
  }
  for (const k of m.keys()) {
    if (k.startsWith(`${userId}|`)) m.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Loading + bookkeeping
// ---------------------------------------------------------------------------

async function loadSnapshot(
  claims: GuardClaims,
  binding: SessionBinding,
  now: Date,
): Promise<Snapshot> {
  const rowSelect = {
    id: true,
    userId: true,
    createdAt: true,
    lastActivityAt: true,
  } as const;
  // UserSession / User are read under SYSTEM, same as the proxy always did:
  // we are deciding WHO the caller is, before any tenant is known.
  const [row, user] = await runWithTenant({ kind: "SYSTEM" }, () =>
    Promise.all([
      binding.kind === "sid"
        ? prisma.userSession.findUnique({
            where: { id: binding.sessionId },
            select: rowSelect,
          })
        : binding.kind === "cookie"
          ? prisma.userSession.findUnique({
              where: { tokenHash: binding.tokenHash },
              select: rowSelect,
            })
          : Promise.resolve(null),
      prisma.user.findUnique({
        where: { id: claims.userId },
        select: {
          id: true,
          active: true,
          role: true,
          clinicId: true,
          mustChangePassword: true,
          lastSessionRotatedAt: true,
          clinic: { select: { sessionIdleTimeoutMinutes: true } },
        },
      }),
    ]),
  );
  return {
    row: row ?? null,
    user: user
      ? {
          id: user.id,
          active: user.active,
          role: user.role as Role,
          clinicId: user.clinicId,
          mustChangePassword: user.mustChangePassword,
          lastSessionRotatedAt: user.lastSessionRotatedAt,
          idleTimeoutMinutes: user.clinic?.sessionIdleTimeoutMinutes ?? null,
        }
      : null,
    loadedAt: now.getTime(),
  };
}

function afterReject(
  verdict: Extract<StaffSessionVerdict, { ok: false }>,
  claims: GuardClaims,
): void {
  // Idle / 8h cap: the row is dead, drop it and leave the same audit trail the
  // proxy used to write. Other reasons have no row to drop or are handled by
  // whoever changed the account.
  if (
    !verdict.sessionId ||
    (verdict.reason !== "idle" && verdict.reason !== "forced-rerotate")
  ) {
    return;
  }
  const sessionId = verdict.sessionId;
  const action =
    verdict.reason === "idle"
      ? AUDIT_ACTION.SESSION_TIMEOUT_LOGOUT
      : AUDIT_ACTION.SESSION_FORCED_REROTATE;
  runWithTenant({ kind: "SYSTEM" }, async () => {
    await prisma.userSession
      .delete({ where: { id: sessionId } })
      .catch(() => {});
    await prisma.auditLog
      .create({
        data: {
          clinicId: claims.role === "SUPER_ADMIN" ? null : claims.clinicId,
          actorId: claims.userId,
          action,
          entityType: "UserSession",
          entityId: sessionId,
          meta: { reason: verdict.reason },
        },
      })
      .catch(() => {});
  }).catch(() => {});
}

function bumpActivity(snap: Snapshot, now: Date): void {
  const row = snap.row;
  if (!row) return;
  if (now.getTime() - row.lastActivityAt.getTime() < ACTIVITY_BUMP_MS) return;
  // Update the cached copy first so concurrent requests in the same window
  // don't all fire their own UPDATE.
  row.lastActivityAt = now;
  const id = row.id;
  runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.userSession
      .update({ where: { id }, data: { lastActivityAt: now } })
      .catch(() => {}),
  ).catch(() => {});
}

/**
 * Decide on a live request. Only a request made by a person counts as
 * activity (throttled to one write a minute): the client's input heartbeat or
 * a full page load, see `src/lib/user-activity.ts`. Counting every request
 * kept an abandoned reception PC signed in for the whole 8h, because the
 * queue page polls the API on its own. Someone clicking or typing on one
 * screen for 40 minutes is kept alive by the heartbeat.
 */
export async function evaluateStaffSession(input: {
  claims: GuardClaims;
  binding: SessionBinding;
  now?: Date;
  /** True only when a person made this request. Polling, SSE re-checks and
   *  background refetches leave it false, so they cannot keep an abandoned
   *  PC's session alive by themselves. */
  countAsActivity?: boolean;
}): Promise<StaffSessionVerdict> {
  const now = input.now ?? new Date();
  const key = cacheKey(input.claims, input.binding);
  let snap = cache().get(key);
  if (!snap || now.getTime() - snap.loadedAt > GUARD_CACHE_TTL_MS) {
    try {
      snap = await loadSnapshot(input.claims, input.binding, now);
    } catch (err) {
      console.error("[session-guard] lookup failed, failing open", err);
      return { ok: true, sessionId: null, fresh: null };
    }
    cachePut(key, snap);
  }

  const verdict = decideStaffSession({
    claims: input.claims,
    binding: input.binding,
    row: snap.row,
    user: snap.user,
    now,
    legacyIdleFloor: PROCESS_STARTED_AT,
  });
  if (!verdict.ok) {
    cache().delete(key);
    afterReject(verdict, input.claims);
    return verdict;
  }
  if (input.countAsActivity === true) bumpActivity(snap, now);
  return verdict;
}

/**
 * Revoke a user's server-side sessions: every open tab bound to them gets 401
 * / the login page on its next request. Used when the password is reset or
 * changed, and when the account is deactivated or moved to another clinic.
 * `exceptSessionId` keeps the caller's own session (changing your own
 * password should not log you out of the tab you did it in).
 */
export async function revokeUserSessions(
  userId: string,
  opts: { exceptSessionId?: string | null } = {},
): Promise<number> {
  try {
    const res = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.userSession.deleteMany({
        where: {
          userId,
          ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}),
        },
      }),
    );
    return res.count;
  } finally {
    // Whatever happened to the rows, the account itself just changed: the
    // next request must re-read it rather than trust a cached snapshot.
    invalidateSessionGuardCache(userId);
  }
}

/** Drop one session row (sign-out). */
export async function deleteSessionById(sessionId: string): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.userSession.deleteMany({ where: { id: sessionId } }),
  );
  const m = cache();
  for (const k of m.keys()) {
    if (k.endsWith(`|sid:${sessionId}`)) m.delete(k);
  }
}
