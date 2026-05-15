/**
 * Phase 17 Wave 2 — UserSession DB helpers (server-side only).
 *
 * The proxy and login route use these to:
 *   - mint a fresh session row and return the (cookie token, row id) pair,
 *   - look up the row by hashing the cookie token, and
 *   - bump lastActivityAt on every authenticated request.
 *
 * The cookie token is a long random string (32 bytes ~ 256 bits of
 * entropy, base64url-encoded). Postgres only ever stores `sha256(token)`
 * — recovering a token from a leaked DB requires a preimage attack.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { pickSessionsToKick } from "./session-security";

export const SESSION_COOKIE_NAME = "crm_user_session";

// Cookie lifetime. Set to the 8h forced re-rotation window so a browser that
// suspends a tab past 8h doesn't carry a cookie for a session the proxy
// would just delete on the next hit anyway. The proxy still owns the
// authoritative idle/forced-rotate checks; this is just a UA-side hint.
const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Read the current request's UserSession cookie value, if any. */
export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Mint a fresh UserSession on a successful sign-in.
 *
 * Sequence (concurrent-session policy = "1 active per user"):
 *   1. Read every existing UserSession row for this user.
 *   2. Pick the IDs to delete (kicking ALL prior rows per spec).
 *   3. Delete them and emit `CONCURRENT_SESSION_KICKED` per kicked id.
 *   4. Insert a new row with a fresh random `tokenHash`.
 *   5. Stamp `User.lastSessionRotatedAt = now()` (proxy 8h check anchor)
 *      and `User.lastLoginAt = now()` (user-visible "last sign-in" on the
 *      security tab) in the same transaction.
 *   6. Set the `crm_user_session` cookie with the plaintext token.
 *
 * All DB work runs under `runWithTenant({kind:"SYSTEM"})` so the Prisma
 * tenant extension doesn't try to inject a clinicId on these
 * cross-tenant-allowed tables (UserSession is in MODELS_WITHOUT_TENANT).
 */
export async function mintUserSessionOnSignIn(
  userId: string,
  clinicId: string | null,
): Promise<{ sessionId: string; token: string }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  const reqHeaders = await headers().catch(() => null);
  const userAgent =
    reqHeaders?.get("user-agent")?.slice(0, 500) ?? null;
  // x-forwarded-for can carry a comma-separated chain; first hop is the
  // public client, the rest are intermediate proxies.
  const xff = reqHeaders?.get("x-forwarded-for") ?? null;
  const ip = xff
    ? xff.split(",")[0]!.trim()
    : reqHeaders?.get("x-real-ip") ?? null;

  const newSession = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const prior = await prisma.userSession.findMany({
      where: { userId },
      select: { id: true, createdAt: true },
    });
    const kickedIds = pickSessionsToKick(prior);

    const created = await prisma.$transaction(async (tx) => {
      if (kickedIds.length > 0) {
        await tx.userSession.deleteMany({ where: { id: { in: kickedIds } } });
      }
      const row = await tx.userSession.create({
        data: {
          userId,
          clinicId,
          tokenHash,
          userAgent,
          ip,
        },
        select: { id: true },
      });
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        // `lastSessionRotatedAt` powers the proxy's 8h hard-cap.
        // `lastLoginAt` is the user-facing "last sign-in" timestamp shown
        // on the security tab — same event, separate field so the security
        // surface doesn't depend on a security-policy internal name.
        data: { lastSessionRotatedAt: now, lastLoginAt: now },
      });
      return row;
    });

    // Audit kicked sessions AFTER the transaction commits so a transaction
    // rollback doesn't leak phantom audit rows.
    for (const kickedId of kickedIds) {
      await prisma.auditLog
        .create({
          data: {
            clinicId,
            actorId: userId,
            action: AUDIT_ACTION.CONCURRENT_SESSION_KICKED,
            entityType: "UserSession",
            entityId: kickedId,
            meta: {
              kickedSessionId: kickedId,
              newSessionId: created.id,
            },
            ip,
            userAgent,
          },
        })
        .catch((err: unknown) => {
          console.error("[user-session] audit failed", err);
        });
    }

    return created;
  });

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return { sessionId: newSession.id, token };
}

/**
 * Look up the current request's UserSession row. Returns null on missing
 * cookie / unknown hash. The caller (proxy) uses this to validate liveness
 * and bump lastActivityAt.
 */
export async function findSessionByCookie(
  cookieValue: string | null | undefined,
): Promise<
  | {
      id: string;
      userId: string;
      clinicId: string | null;
      createdAt: Date;
      lastActivityAt: Date;
    }
  | null
> {
  if (!cookieValue) return null;
  const tokenHash = hashSessionToken(cookieValue);
  return runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.userSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        clinicId: true,
        createdAt: true,
        lastActivityAt: true,
      },
    }),
  );
}

/** Bump lastActivityAt on the given row. Throttled writes are the caller's
 *  problem — the proxy currently writes on every authenticated hit. */
export async function bumpSessionActivity(sessionId: string): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.userSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    }),
  );
}

/** Delete a UserSession by id. Used by the proxy on idle / forced-rerotate. */
export async function deleteUserSession(sessionId: string): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.userSession.delete({ where: { id: sessionId } }).catch(() => {}),
  );
}

/** Clear the session cookie (used after invalidation). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
