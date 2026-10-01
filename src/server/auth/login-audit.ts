/**
 * Staff sign-ins, failed attempts and sign-outs in the audit log
 * (audit G1-04).
 *
 * `authorize()` used to return null on a wrong password, an inactive
 * account or a bad second factor and write nothing; a successful sign-in
 * left only a UserSession row (deleted on the next login or timeout) and
 * `User.lastLoginAt` (overwritten by the next login). When a doctor's
 * password leaked there was no way to tell when, or from where, anyone had
 * signed in under it, and a password-guessing run left no trace at all.
 *
 * Rows: LOGIN_SUCCEEDED (actor = the account), LOGIN_FAILED (no actor: the
 * person typing is not proven to be the account owner; `meta.reason`
 * says why), LOGOUT. Each carries the real client IP and user agent. An
 * email that matches no account is still recorded, with the typed email as
 * `actorLabel` and no clinic. Never the password, a TOTP or a recovery code.
 *
 * Never throws: the audit log being down must not stop a clinic signing in.
 */
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export type LoginFailureReason =
  | "bad_password"
  | "unknown_user"
  | "inactive"
  | "totp_required"
  | "bad_totp"
  | "bad_recovery_code"
  | "throttled";

export type LoginAuditAccount = {
  id: string;
  email: string;
  role: string;
  clinicId: string | null;
};

export type LoginAuditEvent =
  | { kind: "succeeded"; account: LoginAuditAccount; via?: "password" | "totp" | "recovery_code" }
  | {
      kind: "failed";
      reason: LoginFailureReason;
      /** The account the email matched, or null for an unknown email. */
      account: LoginAuditAccount | null;
      typedEmail: string;
      /**
       * Where the password was refused: the login form checks it first at
       * /api/crm/auth/totp-required, so a wrong password typed in the
       * browser never reaches `authorize()`.
       */
      stage?: "precheck";
    }
  | { kind: "logout"; account: { id: string; role: string | null; clinicId: string | null } };

export type LoginAuditRequest = {
  ip: string | null;
  userAgent: string | null;
};

/** The AuditLog row for an event. Exported for tests. */
export function loginAuditRow(event: LoginAuditEvent, req: LoginAuditRequest) {
  const ip = req.ip && req.ip !== "unknown" ? req.ip : null;
  const userAgent = req.userAgent ? req.userAgent.slice(0, 500) : null;
  if (event.kind === "succeeded") {
    return {
      clinicId: event.account.clinicId,
      actorId: event.account.id,
      actorRole: event.account.role,
      actorLabel: event.account.email,
      action: AUDIT_ACTION.LOGIN_SUCCEEDED,
      entityType: "User",
      entityId: event.account.id,
      meta: { via: event.via ?? "password" },
      ip,
      userAgent,
    };
  }
  if (event.kind === "logout") {
    return {
      clinicId: event.account.clinicId,
      actorId: event.account.id,
      actorRole: event.account.role,
      actorLabel: null,
      action: AUDIT_ACTION.LOGOUT,
      entityType: "User",
      entityId: event.account.id,
      meta: null,
      ip,
      userAgent,
    };
  }
  return {
    clinicId: event.account?.clinicId ?? null,
    actorId: null,
    actorRole: null,
    // The typed email, trimmed: it is what an investigator searches for.
    actorLabel: event.typedEmail.trim().slice(0, 200) || null,
    action: AUDIT_ACTION.LOGIN_FAILED,
    entityType: "User",
    entityId: event.account?.id ?? null,
    meta: event.stage ? { reason: event.reason, stage: event.stage } : { reason: event.reason },
    ip,
    userAgent,
  };
}

export async function recordLoginEvent(
  event: LoginAuditEvent,
  req: LoginAuditRequest,
): Promise<void> {
  try {
    const row = loginAuditRow(event, req);
    // AuditLog is written across tenants here (sign-in runs before any
    // tenant context exists), the same way RECOVERY_CODE_USED is.
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.auditLog.create({ data: row as never }),
    );
  } catch (err) {
    console.error("[auth] login audit failed", err);
  }
}
