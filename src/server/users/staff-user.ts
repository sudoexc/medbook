/**
 * Staff accounts as the clinic's user settings see them.
 *
 * Two pure pieces shared by /api/crm/users and /api/crm/users/[id]:
 *
 *   - `redactStaffUser` — what leaves the server. The list used to strip only
 *     `passwordHash`, so every admin's browser received each colleague's
 *     TOTP secret ciphertext and recovery-code hashes. Now those stay home
 *     and the table gets a plain `totpEnabled` flag instead (audit ST-03:
 *     the 2FA status is shown, and «Сбросить 2FA» offered where it applies).
 *
 *   - `planDoctorBinding` — the one rule for a doctor login and its schedule
 *     card (audit ST-04). An active DOCTOR account holds exactly one card;
 *     any other account holds none. Before, only DELETE released the card:
 *     switching the «Активен» toggle off in the edit dialog, or moving the
 *     doctor to reception, kept the card bound, so it vanished from «врачи
 *     без логина»; switching it back on bound nothing, and the doctor bounced
 *     between /doctor (no card → /crm) and /crm (a DOCTOR → /doctor) forever.
 */

const SECRET_USER_FIELDS = [
  "passwordHash",
  "totpSecret",
  "pendingTotpSecret",
  "pendingTotpExpiresAt",
  "recoveryCodesHash",
] as const;

export type StaffUserView<T> = Omit<T, (typeof SECRET_USER_FIELDS)[number]> & {
  totpEnabled: boolean;
};

export function redactStaffUser<T extends Record<string, unknown>>(
  u: T,
): StaffUserView<T> {
  const out: Record<string, unknown> = { ...u };
  for (const k of SECRET_USER_FIELDS) delete out[k];
  out.totpEnabled = Boolean(u.totpEnabledAt);
  return out as StaffUserView<T>;
}

export type DoctorBindingPlan =
  | { ok: false; reason: "doctor_id_required" }
  | { ok: true; unlinkCardId: string | null; linkCardId: string | null };

/**
 * Pure: which card to release and which to bind for the account's state
 * after the edit.
 *
 *   - not an active DOCTOR (deactivated, or moved to another role) → release
 *     the card it holds, so it is back in «врачи без логина»;
 *   - an active DOCTOR → keep its card, or switch to the requested one; with
 *     neither (a reactivation, a promotion) the admin must pick the card.
 */
export function planDoctorBinding(input: {
  nextRole: string;
  nextActive: boolean;
  currentCardId: string | null;
  requestedCardId: string | null;
}): DoctorBindingPlan {
  const needsCard = input.nextRole === "DOCTOR" && input.nextActive;
  if (!needsCard) {
    return { ok: true, unlinkCardId: input.currentCardId, linkCardId: null };
  }
  const wanted = input.requestedCardId ?? input.currentCardId;
  if (!wanted) return { ok: false, reason: "doctor_id_required" };
  if (wanted === input.currentCardId) {
    return { ok: true, unlinkCardId: null, linkCardId: null };
  }
  return { ok: true, unlinkCardId: input.currentCardId, linkCardId: wanted };
}
