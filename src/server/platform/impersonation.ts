/**
 * Phase 19 Wave 4 — SUPER_ADMIN impersonation grant lifecycle.
 *
 * Pure helpers (`isGrantExpired`) live alongside DB-bound operations
 * (`createGrant`, `getActiveGrant`, `endGrant`) so unit tests can exercise the
 * clock logic without spinning up Prisma.
 *
 * The grant pairs with the existing `admin_clinic_override` cookie in two
 * ways:
 *   1. The cookie carries the clinicId (HMAC-signed). A second cookie
 *      `admin_grant_id` carries the grant id so the auth/api layer can
 *      look up the row and verify `expiresAt`/`endedAt`.
 *   2. When the grant is missing or expired, the auth/api layer clears the
 *      override cookie + grant cookie and redirects to /admin/clinics.
 *
 * Default lease: 60 minutes. Long enough for a full support session, short
 * enough that a forgotten cookie does not become a privilege time-bomb.
 *
 * The end of a lease is journaled (audit G5-09). Both cookies expire with the
 * lease, so no request ever arrives carrying an expired grant: nothing used
 * to stamp the row, and the journal had STARTED with no end. Now the worker
 * sweep (`expireLapsedGrants`, every minute) closes each lapsed grant with
 * `endedReason="expired"` and writes SUPER_ADMIN_IMPERSONATE_EXPIRED with the
 * grant's clinic, and the proxy sends a SUPER_ADMIN left in the CRM without
 * a clinic back to /admin/clinics (`latestGrantLapsedRecently` says whether
 * to explain why).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import type { ImpersonationMode } from "@/generated/prisma/client";

export const IMPERSONATION_LEASE_MS = 60 * 60 * 1000; // 60 minutes
/**
 * «Продлить» in the banner (owner request 09.10.2026, design
 * docs/design/OWNER-ACCOUNT.md §2): a visit can be extended lease by lease,
 * but never past 8 hours from the grant's start, the same ceiling as a
 * staff session. A day-long support job takes a new entry with its own
 * reason.
 */
export const IMPERSONATION_MAX_MS = 8 * 60 * 60 * 1000; // 8 hours
export const GRANT_COOKIE_NAME = "admin_grant_id";
/**
 * For how long after a lease ran out /admin/clinics explains the return
 * («время входа истекло»): a working day, so a tab left open over lunch
 * still gets the reason, and yesterday's visit no longer does.
 */
export const EXPIRY_NOTICE_MS = 12 * 60 * 60 * 1000;

export type GrantMode = "WRITE" | "VIEW_ONLY";

/**
 * Pure: a grant with `expiresAt < now` is expired regardless of `endedAt`.
 * Callers that already have an `endedAt` should treat that as a separate
 * end-state (`endedAt != null` → ended, `expiresAt < now` → expired). This
 * helper isolates the clock check so the DB-bound `getActiveGrant` can stay
 * thin and the unit test can drive the clock directly.
 */
export function isGrantExpired(
  grant: { expiresAt: Date },
  now: Date,
): boolean {
  return grant.expiresAt.getTime() <= now.getTime();
}

/**
 * Mint a fresh grant. Caller is responsible for emitting the
 * `SUPER_ADMIN_IMPERSONATE_STARTED` audit row — we keep this helper purely
 * about the row write so a future re-issue path (e.g. revoke + re-grant
 * inside a transaction) can compose without double-auditing.
 */
export async function createGrant(
  superAdminId: string,
  clinicId: string,
  reason: string,
  mode: GrantMode,
): Promise<{ grantId: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + IMPERSONATION_LEASE_MS);
  const row = await prisma.impersonationGrant.create({
    data: {
      superAdminId,
      clinicId,
      reason,
      mode: mode as ImpersonationMode,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  return { grantId: row.id, expiresAt: row.expiresAt };
}

/**
 * Look up a grant and return it ONLY if it's still active. "Active" means:
 *   - row exists
 *   - `endedAt` is null
 *   - `expiresAt > now` (clock check via `isGrantExpired`)
 *
 * Returns `null` for any other state — callers treat null as "redirect to
 * /admin/clinics and clear cookies". If the row exists but is expired the
 * caller may also want to stamp `endGrant(id, "expired")`; this helper does
 * NOT mutate, on the principle of "reads stay reads".
 */
export async function getActiveGrant(grantId: string): Promise<
  | {
      id: string;
      superAdminId: string;
      clinicId: string;
      mode: GrantMode;
      startedAt: Date;
      expiresAt: Date;
      reason: string;
    }
  | null
> {
  if (!grantId) return null;
  const row = await prisma.impersonationGrant.findUnique({
    where: { id: grantId },
    select: {
      id: true,
      superAdminId: true,
      clinicId: true,
      mode: true,
      startedAt: true,
      expiresAt: true,
      endedAt: true,
      reason: true,
    },
  });
  if (!row) return null;
  if (row.endedAt) return null;
  if (isGrantExpired({ expiresAt: row.expiresAt }, new Date())) return null;
  return {
    id: row.id,
    superAdminId: row.superAdminId,
    clinicId: row.clinicId,
    mode: row.mode as GrantMode,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    reason: row.reason,
  };
}

/**
 * Stamp the grant as ended. No-op when already ended (idempotent). Returns
 * whether this call ended it, so the caller journals an end only once.
 *
 * `reason` is one of:
 *   - "user_exit" — admin clicked the exit banner / dropdown, entered
 *                   another clinic, or signed out (`endGrantOnSignOut`)
 *   - "expired"   — the lease ran out (`expireLapsedGrants` stamps these)
 *   - "revoked"   — manual / automated revocation (future)
 */
export async function endGrant(
  grantId: string,
  reason: "user_exit" | "expired" | "revoked",
): Promise<boolean> {
  if (!grantId) return false;
  // Use updateMany so a missing row / already-ended row both produce 0 rows
  // affected without throwing — keeps the lifecycle handler simple.
  const res = await prisma.impersonationGrant.updateMany({
    where: { id: grantId, endedAt: null },
    data: { endedAt: new Date(), endedReason: reason },
  });
  return res.count > 0;
}

/** Pure: the latest moment a grant may ever run to (8 h from its start). */
export function maxLeaseEnd(grant: { startedAt: Date }): Date {
  return new Date(grant.startedAt.getTime() + IMPERSONATION_MAX_MS);
}

/**
 * Pure: where a lease extended at `now` ends, or null when it cannot grow.
 *
 * «Продлить» gives a fresh 60 minute lease from the click, capped at 8 h from
 * the grant's start (owner request 09.10.2026). Counting from now rather than
 * from the old end keeps the rule the lease was built on: at no moment does
 * a live grant hold more than 60 minutes ahead, so repeated clicks cannot
 * bank hours. The button shows only in the last 5 minutes anyway.
 */
export function extendedLeaseEnd(
  grant: { startedAt: Date; expiresAt: Date },
  now: Date,
): Date | null {
  const next = Math.min(
    now.getTime() + IMPERSONATION_LEASE_MS,
    maxLeaseEnd(grant).getTime(),
  );
  return next > grant.expiresAt.getTime() ? new Date(next) : null;
}

export type ExtendGrantResult =
  | {
      ok: true;
      grant: { id: string; clinicId: string; mode: GrantMode; startedAt: Date };
      previousExpiresAt: Date;
      expiresAt: Date;
      maxExpiresAt: Date;
    }
  | { ok: false; reason: "no_live_grant" }
  | { ok: false; reason: "lease_cap_reached"; expiresAt: Date; maxExpiresAt: Date };

/**
 * Extend the caller's own live grant (POST /api/platform/session/extend).
 * The caller journals SUPER_ADMIN_IMPERSONATE_EXTENDED and re-sets the
 * cookies. A grant of another admin, an ended one or one whose lease already
 * ran out is "no_live_grant": a lapsed lease is closed by the sweep, never
 * revived.
 */
export async function extendGrant(
  grantId: string,
  superAdminId: string,
  now: Date = new Date(),
): Promise<ExtendGrantResult> {
  const active = await getActiveGrant(grantId);
  if (!active || active.superAdminId !== superAdminId) {
    return { ok: false, reason: "no_live_grant" };
  }
  const maxExpiresAt = maxLeaseEnd(active);
  const next = extendedLeaseEnd(active, now);
  if (!next) {
    return {
      ok: false,
      reason: "lease_cap_reached",
      expiresAt: active.expiresAt,
      maxExpiresAt,
    };
  }
  // Conditional on the grant still being open and unexpired: an exit, a
  // sign-out or the expiry sweep that got there first wins.
  const res = await prisma.impersonationGrant.updateMany({
    where: {
      id: grantId,
      superAdminId,
      endedAt: null,
      expiresAt: { gt: now },
    },
    data: { expiresAt: next },
  });
  if (res.count === 0) return { ok: false, reason: "no_live_grant" };
  return {
    ok: true,
    grant: {
      id: active.id,
      clinicId: active.clinicId,
      mode: active.mode,
      startedAt: active.startedAt,
    },
    previousExpiresAt: active.expiresAt,
    expiresAt: next,
    maxExpiresAt,
  };
}

/**
 * Sign-out ends the visit (owner request 09.10.2026, design §0: signing out
 * mid-grant and signing back in, or another SUPER_ADMIN signing in on the
 * same browser, used to carry on the old live grant). Ends `grantId` only
 * when it is live and belongs to `superAdminId`, and journals
 * SUPER_ADMIN_IMPERSONATE_ENDED with `via: "sign_out"`. Returns whether it
 * ended one. Never throws: a sign-out must always go through.
 */
export async function endGrantOnSignOut(input: {
  grantId: string;
  superAdminId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  try {
    return await runWithTenant(
      { kind: "SUPER_ADMIN", userId: input.superAdminId },
      async () => {
        const active = await getActiveGrant(input.grantId);
        if (!active || active.superAdminId !== input.superAdminId) return false;
        if (!(await endGrant(input.grantId, "user_exit"))) return false;
        await prisma.auditLog
          .create({
            data: {
              clinicId: active.clinicId,
              actorId: input.superAdminId,
              actorRole: "SUPER_ADMIN",
              actorLabel: "platform",
              action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_ENDED,
              entityType: "ImpersonationGrant",
              entityId: input.grantId,
              meta: {
                clinicId: active.clinicId,
                durationMs: Date.now() - active.startedAt.getTime(),
                via: "sign_out",
              },
              ip: input.ip,
              userAgent: input.userAgent?.slice(0, 500) ?? null,
            },
          })
          .catch((e: unknown) => {
            console.warn(`[impersonation] sign-out audit failed grant=${input.grantId}`, e);
          });
        return true;
      },
    );
  } catch (e) {
    console.error(`[impersonation] sign-out could not end grant=${input.grantId}`, e);
    return false;
  }
}

/**
 * Pure: did this grant run out (rather than end by «Выйти» or a switch to
 * another clinic) within the last `EXPIRY_NOTICE_MS`? A lapsed grant the
 * sweep has not closed yet counts too.
 */
export function lapsedRecently(
  grant: { expiresAt: Date; endedAt: Date | null; endedReason: string | null } | null,
  now: Date,
): boolean {
  if (!grant) return false;
  const lapsed = grant.endedAt
    ? grant.endedReason === "expired"
    : isGrantExpired(grant, now);
  return lapsed && now.getTime() - grant.expiresAt.getTime() < EXPIRY_NOTICE_MS;
}

/** Whether the SUPER_ADMIN's most recent grant ran out recently. */
export async function latestGrantLapsedRecently(
  superAdminId: string,
  now: Date = new Date(),
): Promise<boolean> {
  // ImpersonationGrant is tenant-scoped; the lookup is by the caller's own
  // user id, across clinics.
  const grant = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.impersonationGrant.findFirst({
      where: { superAdminId },
      orderBy: { startedAt: "desc" },
      select: { expiresAt: true, endedAt: true, endedReason: true },
    }),
  );
  return lapsedRecently(grant, now);
}

/**
 * Close every grant whose lease ran out without an exit, oldest first, and
 * journal each one (audit G5-09). Returns how many it closed.
 *
 * `endedAt` is the lease end, not the moment the sweep noticed: that is when
 * access really stopped, and what an auditor asks. Each close is conditional
 * on `endedAt` still being null, so an exit or a concurrent sweep that got
 * there first wins and no grant is journaled twice.
 */
export async function expireLapsedGrants(
  now: Date = new Date(),
  limit = 200,
): Promise<number> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const lapsed = await prisma.impersonationGrant.findMany({
      where: { endedAt: null, expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
      take: limit,
      select: {
        id: true,
        superAdminId: true,
        clinicId: true,
        startedAt: true,
        expiresAt: true,
      },
    });
    let closed = 0;
    for (const g of lapsed) {
      const res = await prisma.impersonationGrant.updateMany({
        where: { id: g.id, endedAt: null },
        data: { endedAt: g.expiresAt, endedReason: "expired" },
      });
      if (res.count === 0) continue;
      closed += 1;
      try {
        await prisma.auditLog.create({
          data: {
            clinicId: g.clinicId,
            actorId: g.superAdminId,
            actorRole: "SUPER_ADMIN",
            actorLabel: "system:impersonation-expiry",
            action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXPIRED,
            entityType: "ImpersonationGrant",
            entityId: g.id,
            meta: {
              clinicId: g.clinicId,
              expiredAtMs: g.expiresAt.getTime(),
              durationMs: g.expiresAt.getTime() - g.startedAt.getTime(),
            },
          },
        });
      } catch (e) {
        console.warn(`[impersonation] expiry audit failed grant=${g.id}`, e);
      }
    }
    return closed;
  });
}
