/**
 * The CRM's rules for a staff account, applied to the platform panel's
 * «Переназначить» and «Деактивировать» (audit G5-06).
 *
 * PATCH /api/platform/users/[id] checked only that the target clinic exists
 * and that the operator does not demote themselves. Rules the CRM path
 * (`/api/crm/users/[id]`) enforces were missing:
 *
 *   - the last active ADMIN of a clinic could be switched off, demoted or
 *     moved away, leaving nobody to run the clinic (and «Пароль владельца»
 *     with nothing to reset);
 *   - a doctor moved to another clinic kept the doctor card (Doctor.userId,
 *     unique) in the old one: the new clinic's cabinet found no card for the
 *     login, and no card could be bound there because the login was taken;
 *   - an account could become an active DOCTOR with no card at all.
 *
 * They are pure here so the route stays thin and the rules are testable.
 */

export type AccountState = {
  role: string;
  active: boolean;
  clinicId: string | null;
};

/**
 * Pure: does this edit take an active ADMIN out of its clinic's set of
 * active ADMINs (switched off, another role, another clinic)? The caller then
 * counts the clinic's other active ADMINs and refuses `last_admin` at zero.
 */
export function leavesAdminSeat(before: AccountState, after: AccountState): boolean {
  if (before.role !== "ADMIN" || !before.active || !before.clinicId) return false;
  return !(
    after.role === "ADMIN" &&
    after.active &&
    after.clinicId === before.clinicId
  );
}

export type PlatformCardPlan =
  | { ok: false; reason: "doctor_card_bound" | "doctor_id_required" }
  | { ok: true; unlinkCardId: string | null };

/**
 * Pure: what happens to the doctor card bound to the account after the edit.
 *
 *   - no longer an active DOCTOR (switched off,
 *     another role)                            → release the card, as the
 *     CRM does (audit ST-04), so it is back among «врачи без логина»;
 *   - an active DOCTOR moving to another clinic → refused: the card, its
 *     visits and schedule stay in the old clinic. Change the role first (the
 *     card is released), then make the account a DOCTOR again from the new
 *     clinic's CRM, which binds one of its cards;
 *   - an active DOCTOR staying in the card's clinic → keep it;
 *   - becoming an active DOCTOR with no card (switched back on after a
 *     platform deactivation released it, a role change back to DOCTOR)
 *                                              → refused, the CRM's
 *     `doctor_id_required`. The platform has no card picker, and letting it
 *     through left a doctor whose cabinet showed «Карточка врача не
 *     привязана» instead of the visit screen until a clinic ADMIN rebound
 *     the card. The clinic's CRM switches the account on together with the
 *     card pick;
 *   - an active DOCTOR who already had no card → left as it was (a move or a
 *     2FA reset must not get stuck on a state this edit did not create).
 */
export function planPlatformDoctorCard(input: {
  before: AccountState;
  after: AccountState;
  card: { id: string; clinicId: string } | null;
}): PlatformCardPlan {
  const { before, after, card } = input;
  const activeDoctor = after.role === "DOCTOR" && after.active;
  if (!card) {
    const wasActiveDoctor = before.role === "DOCTOR" && before.active;
    if (activeDoctor && !wasActiveDoctor) {
      return { ok: false, reason: "doctor_id_required" };
    }
    return { ok: true, unlinkCardId: null };
  }
  if (!activeDoctor) return { ok: true, unlinkCardId: card.id };
  if (after.clinicId !== card.clinicId) {
    return { ok: false, reason: "doctor_card_bound" };
  }
  return { ok: true, unlinkCardId: null };
}
