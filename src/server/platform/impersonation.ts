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
 */
import { prisma } from "@/lib/prisma";
import type { ImpersonationMode } from "@/generated/prisma/client";

export const IMPERSONATION_LEASE_MS = 60 * 60 * 1000; // 60 minutes
export const GRANT_COOKIE_NAME = "admin_grant_id";

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
    expiresAt: row.expiresAt,
    reason: row.reason,
  };
}

/**
 * Stamp the grant as ended. No-op when already ended (idempotent).
 *
 * `reason` is one of:
 *   - "user_exit" — admin clicked the exit banner / dropdown
 *   - "expired"   — middleware noticed `expiresAt < now`
 *   - "revoked"   — manual / automated revocation (future)
 */
export async function endGrant(
  grantId: string,
  reason: "user_exit" | "expired" | "revoked",
): Promise<void> {
  if (!grantId) return;
  // Use updateMany so a missing row / already-ended row both produce 0 rows
  // affected without throwing — keeps the lifecycle handler simple.
  await prisma.impersonationGrant.updateMany({
    where: { id: grantId, endedAt: null },
    data: { endedAt: new Date(), endedReason: reason },
  });
}
