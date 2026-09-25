/**
 * When may a password change skip the current password? (audit SEC-07)
 *
 * It used to be "whenever `mustChangePassword` is set". That flag is set on
 * every admin reset and, for doctors, was never cleared (they could not reach
 * the change page), so anyone at an unlocked PC, or an intruder whose session
 * survived the reset, could set a new password with one request and keep the
 * account.
 *
 * Now the current password may be omitted only by the session that was just
 * opened WITH the temporary password (the sign-in itself proved knowledge of
 * it), and only for a short window after that sign-in. Any other session,
 * including one opened before the reset, has to type it.
 */
export const TEMP_PASSWORD_GRACE_MS = 30 * 60 * 1000;

export function mayOmitCurrentPassword(args: {
  hasPassword: boolean;
  mustChangePassword: boolean;
  /** Epoch ms of this session's sign-in with a temporary password, if any. */
  tempPasswordLoginAt: number | null | undefined;
  now?: number;
}): boolean {
  // No password on the account at all: there is nothing to verify.
  if (!args.hasPassword) return true;
  if (!args.mustChangePassword) return false;
  if (typeof args.tempPasswordLoginAt !== "number") return false;
  const age = (args.now ?? Date.now()) - args.tempPasswordLoginAt;
  return age >= 0 && age <= TEMP_PASSWORD_GRACE_MS;
}

/** What the change-password page shows for the signed-in user. */
export function changePasswordView(
  user: { mustChangePassword?: boolean; tempPasswordLoginAt?: number | null } | null | undefined,
  now?: number,
): { forced: boolean; requireCurrent: boolean } {
  const forced = Boolean(user?.mustChangePassword);
  return {
    forced,
    // Every signed-in staff account has a password (sign-in requires one).
    requireCurrent: !mayOmitCurrentPassword({
      hasPassword: true,
      mustChangePassword: forced,
      tempPasswordLoginAt: user?.tempPasswordLoginAt,
      now,
    }),
  };
}
