/**
 * Wiping someone else's TOTP (audit ST-03).
 *
 * The only code that cleared `totpSecret` was the self-service
 * /api/crm/me/totp/disable, which needs the user's own session. A doctor or
 * the only admin who lost the phone and the recovery codes could not sign in
 * at all, and «Сбросить пароль» did not help: the login still asked for the
 * code. Recovery meant a developer editing the database.
 *
 * Now a clinic ADMIN resets a colleague's 2FA (`/api/crm/users/[id]/reset-totp`,
 * own password re-entered) and the platform owner does the same for a
 * clinic's only admin (`PATCH /api/platform/users/[id]` with `resetTotp`).
 * Both write the same columns, end every session of the user and leave an
 * audit row. At the next sign-in the password alone lets the user in, and
 * a role or clinic that requires 2FA sends them straight to enrolment (the
 * proxy and the API gate read `totpEnabledAt`).
 */

/**
 * Columns that make up an enrolment: the secret, the "enrolled" stamp, the
 * recovery codes and an unfinished enrolment's pending secret.
 */
export const TOTP_RESET_DATA = {
  totpSecret: null,
  totpEnabledAt: null,
  recoveryCodesHash: [] as string[],
  pendingTotpSecret: null,
  pendingTotpExpiresAt: null,
};

export type TotpResetRefusal =
  | "cannot_reset_self"
  | "not_enrolled"
  | "super_admin_target";

/**
 * Pure: may `actorId` wipe the 2FA of `target`?
 *
 *   - not their own: an admin's own 2FA goes through their security page,
 *     otherwise a stolen admin session plus the password would switch off
 *     the mandatory second factor of that very admin;
 *   - not a SUPER_ADMIN from a clinic screen;
 *   - only an enrolled user: there is nothing to reset otherwise, and saying
 *     so beats a success that changed nothing.
 */
export function totpResetRefusal(input: {
  actorId: string;
  target: { id: string; role: string; totpEnabledAt: Date | null };
  allowSuperAdminTarget?: boolean;
}): TotpResetRefusal | null {
  if (input.target.id === input.actorId) return "cannot_reset_self";
  if (input.target.role === "SUPER_ADMIN" && !input.allowSuperAdminTarget) {
    return "super_admin_target";
  }
  if (!input.target.totpEnabledAt) return "not_enrolled";
  return null;
}
