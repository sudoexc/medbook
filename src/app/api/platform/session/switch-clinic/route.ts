/**
 * POST /api/platform/session/switch-clinic — set / clear the SUPER_ADMIN
 * clinic-override cookie (and the Phase 19 W4 grant cookie).
 *
 * Body: `{ clinicId: string | null, reason?: string, mode?: "WRITE" | "VIEW_ONLY",
 * breakGlass?: boolean }`.
 *   - When `clinicId` is set, `reason` is required (≥4 chars). The handler
 *     mints an `ImpersonationGrant` row (60min lease, default WRITE mode),
 *     sets `admin_clinic_override` (the existing HMAC-signed clinicId
 *     cookie) AND a fresh `admin_grant_id` cookie that downstream guards
 *     read to confirm the grant is still active.
 *   - When `clinicId` is null, the handler reads the active grant cookie,
 *     stamps the row with `endedAt=now, endedReason="user_exit"`, clears
 *     both cookies, and audits `SUPER_ADMIN_IMPERSONATE_ENDED`.
 *
 * Switching from one clinic to another (clinicId set, current grant cookie
 * present) ends the previous grant first ("user_exit") so the audit trail
 * never has two overlapping live grants for the same actor.
 *
 * Every end of a live grant is journaled as SUPER_ADMIN_IMPERSONATE_ENDED
 * with that grant's clinic, the switch A→B included (audit G5-09: it used to
 * close A silently). Nothing live to end means no ENDED row: «Выйти» after
 * the lease ran out used to write one with clinicId null. A lapsed grant is
 * not stamped "user_exit" here either; the expiry sweep closes it as
 * "expired" (`expireLapsedGrants`).
 *
 * A switched-off clinic (`Clinic.active = false`) is entered only with
 * `breakGlass: true`, sent by the entry dialog after its warning, and the
 * STARTED row carries `meta.inactiveClinic = true` (owner request
 * 09.10.2026). Without the flag: 409 `clinic_inactive`, no grant.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound, conflict } from "@/server/http";
import { platformAudit, requireSuperAdmin } from "@/server/platform/handler";
import { mfaRequiredResponse, owesTotpEnrolment } from "@/server/auth/mfa-gate";
import {
  createGrant,
  endGrant,
  getActiveGrant,
} from "@/server/platform/impersonation";
import {
  clearLeaseCookieHeaders,
  leaseCookieHeaders,
  readGrantCookie,
} from "@/server/platform/grant-cookies";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { SwitchClinicSchema } from "@/server/schemas/platform";

/** End the caller's live grant, if there is one, and journal it. */
async function endLiveGrant(
  request: Request,
  userId: string,
  grantId: string | null,
  via: "exit" | "switch",
): Promise<void> {
  if (!grantId) return;
  const active = await getActiveGrant(grantId).catch(() => null);
  if (!active || active.superAdminId !== userId) return;
  // Conditional on the grant still being open: a double click journals once.
  if (!(await endGrant(grantId, "user_exit"))) return;
  await platformAudit({
    request,
    userId,
    clinicId: active.clinicId,
    action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_ENDED,
    entityType: "ImpersonationGrant",
    entityId: grantId,
    meta: {
      clinicId: active.clinicId,
      durationMs: Date.now() - active.startedAt.getTime(),
      via,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  // Role first, second factor below: leaving a clinic only drops privilege,
  // so it stays open to a SUPER_ADMIN caught mid-grant by the SEC-08 rollout.
  const gate = await requireSuperAdmin({ mfa: false });
  if (!gate.ok) return gate.response;
  const userId = gate.userId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = SwitchClinicSchema.safeParse(raw);
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }

  const clinicId = parsed.data.clinicId;
  const mode = parsed.data.mode ?? "WRITE";

  // Entering a clinic is the step that opens its medical data (audit
  // SEC-08): it needs the SUPER_ADMIN's own enrolled 2FA, and the API wrapper
  // re-checks it on every impersonated request.
  if (clinicId && (await owesTotpEnrolment(userId, "SUPER_ADMIN"))) {
    return mfaRequiredResponse();
  }

  return runWithTenant(
    { kind: "SUPER_ADMIN", userId },
    async () => {
      if (clinicId) {
        const reason = parsed.data.reason?.trim();
        if (!reason || reason.length < 4) {
          return err("ValidationError", 400, { reason: "reason_required" });
        }

        const exists = await prisma.clinic.findUnique({
          where: { id: clinicId },
          select: { id: true, slug: true, nameRu: true, active: true },
        });
        if (!exists) return notFound();
        // A switched-off clinic can be entered, but only on purpose (owner
        // request 09.10.2026, docs/design/OWNER-ACCOUNT.md §2): the dialog
        // warns «Клиника выключена» and only then sends `breakGlass: true`.
        // A caller that did not see the warning gets 409 and nothing is
        // minted. The clinic stays switched off for its staff and patients.
        const inactiveClinic = !exists.active;
        if (inactiveClinic && parsed.data.breakGlass !== true) {
          return conflict("clinic_inactive");
        }

        // End the previous grant before minting a new one — keeps the audit
        // history linear (a single live grant per actor at any moment).
        await endLiveGrant(request, userId, readGrantCookie(request), "switch");

        const grant = await createGrant(
          userId,
          clinicId,
          reason,
          mode,
        );

        await platformAudit({
          request,
          userId,
          clinicId,
          action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_STARTED,
          entityType: "ImpersonationGrant",
          entityId: grant.grantId,
          meta: {
            clinicId,
            slug: exists.slug,
            mode,
            expiresAt: grant.expiresAt.toISOString(),
            reason,
            ...(inactiveClinic ? { inactiveClinic: true } : {}),
          },
        });

        // Both cookies expire exactly with the grant lease (grant-cookies.ts).
        const headers = leaseCookieHeaders({
          clinicId,
          grantId: grant.grantId,
          expiresAt: grant.expiresAt,
        });
        return Response.json(
          {
            ok: true,
            clinicId: exists.id,
            slug: exists.slug,
            nameRu: exists.nameRu,
            grantId: grant.grantId,
            mode,
            expiresAt: grant.expiresAt.toISOString(),
          },
          { status: 200, headers },
        );
      }

      // Exit path — clear cookies, end the live grant (if any).
      await endLiveGrant(request, userId, readGrantCookie(request), "exit");
      return Response.json(
        { ok: true, clinicId: null },
        { status: 200, headers: clearLeaseCookieHeaders() },
      );
    },
  );
}

export async function GET(): Promise<Response> {
  return err("MethodNotAllowed", 405);
}

void ok; // keep import narrow; ok unused here
