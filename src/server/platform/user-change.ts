/**
 * The CRM's rules for a staff account, applied to the platform panel's
 * «Переназначить» and «Деактивировать» (audit G5-06).
 *
 * PATCH /api/platform/users/[id] checked only that the target clinic exists
 * and that the operator does not demote themselves. Two rules the CRM path
 * (`/api/crm/users/[id]`) enforces were missing:
 *
 *   - the last active ADMIN of a clinic could be switched off, demoted or
 *     moved away, leaving nobody to run the clinic (and «Пароль владельца»
 *     with nothing to reset);
 *   - a doctor moved to another clinic kept the doctor card (Doctor.userId,
 *     unique) in the old one: the new clinic's cabinet found no card for the
 *     login, and no card could be bound there because the login was taken.
 *
 * Both are pure here so the route stays thin and the rules are testable.
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
  | { ok: false; reason: "doctor_card_bound" }
  | { ok: true; unlinkCardId: string | null };

/**
 * Pure: what happens to the doctor card bound to the account after the edit.
 *
 *   - no card                                  → nothing to do;
 *   - no longer an active DOCTOR (switched off,
 *     another role)                            → release the card, as the
 *     CRM does (audit ST-04), so it is back among «врачи без логина»;
 *   - an active DOCTOR moving to another clinic → refused: the card, its
 *     visits and schedule stay in the old clinic. Change the role first (the
 *     card is released), then bind a card of the new clinic from its CRM;
 *   - an active DOCTOR staying in the card's clinic → keep it.
 */
export function planPlatformDoctorCard(input: {
  after: AccountState;
  card: { id: string; clinicId: string } | null;
}): PlatformCardPlan {
  const { after, card } = input;
  if (!card) return { ok: true, unlinkCardId: null };
  const activeDoctor = after.role === "DOCTOR" && after.active;
  if (!activeDoctor) return { ok: true, unlinkCardId: card.id };
  if (after.clinicId !== card.clinicId) {
    return { ok: false, reason: "doctor_card_bound" };
  }
  return { ok: true, unlinkCardId: null };
}
