/**
 * POST /api/platform/session/extend — «Продлить» in the clinic banner (owner
 * request 09.10.2026, docs/design/OWNER-ACCOUNT.md §2 and §7 P0).
 *
 * The visit's lease used to be a hard 60 minutes with no timer and no way to
 * extend it: the owner was thrown back to /admin/clinics mid-task and had to
 * enter again with a new reason. Now the banner counts down and, in the last
 * 5 minutes, offers «Продлить»:
 *   - extends the caller's own live grant (cookie `admin_grant_id`) to a
 *     fresh 60 minute lease, never past 8 hours from the grant's start
 *     (`extendedLeaseEnd` in src/server/platform/impersonation.ts);
 *   - journals SUPER_ADMIN_IMPERSONATE_EXTENDED with the old and new end;
 *   - re-sets both visit cookies so they expire with the new lease.
 *
 * No body. Answers 409 `no_live_grant` (nothing live, or not the caller's)
 * and 409 `lease_cap_reached` (already at 8 hours: a new entry is needed).
 * SUPER_ADMIN with 2FA only (the platform handler); the mode of the grant is
 * kept as it is.
 */
import { conflict } from "@/server/http";
import {
  createPlatformHandler,
  platformAudit,
} from "@/server/platform/handler";
import { extendGrant } from "@/server/platform/impersonation";
import {
  leaseCookieHeaders,
  readGrantCookie,
} from "@/server/platform/grant-cookies";
import { AUDIT_ACTION } from "@/lib/audit-actions";

export const POST = createPlatformHandler({}, async ({ request, userId }) => {
  const grantId = readGrantCookie(request);
  if (!grantId) return conflict("no_live_grant");

  const result = await extendGrant(grantId, userId);
  if (!result.ok) {
    if (result.reason === "lease_cap_reached") {
      return conflict("lease_cap_reached", {
        expiresAt: result.expiresAt.toISOString(),
        maxExpiresAt: result.maxExpiresAt.toISOString(),
      });
    }
    return conflict("no_live_grant");
  }

  await platformAudit({
    request,
    userId,
    clinicId: result.grant.clinicId,
    action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXTENDED,
    entityType: "ImpersonationGrant",
    entityId: result.grant.id,
    meta: {
      clinicId: result.grant.clinicId,
      mode: result.grant.mode,
      previousExpiresAt: result.previousExpiresAt.toISOString(),
      expiresAt: result.expiresAt.toISOString(),
      maxExpiresAt: result.maxExpiresAt.toISOString(),
    },
  });

  return Response.json(
    {
      ok: true,
      grantId: result.grant.id,
      mode: result.grant.mode,
      expiresAt: result.expiresAt.toISOString(),
      maxExpiresAt: result.maxExpiresAt.toISOString(),
    },
    {
      status: 200,
      headers: leaseCookieHeaders({
        clinicId: result.grant.clinicId,
        grantId: result.grant.id,
        expiresAt: result.expiresAt,
      }),
    },
  );
});
