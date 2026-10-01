/**
 * Who may work the Action Center (audit AC-16, AC-19). Client-safe: the
 * routes, the page and the risk list read the same sets.
 *
 * The call operator was left out of every role list: the work list and the
 * risk list answered 403, the screen swallowed it as «Нет приоритетных
 * действий», and the call center's «К подтверждению» vanished, for the very
 * role whose job is those calls. A nurse has no part in the call work and
 * gets a plain «нет доступа» instead of an empty list.
 */
import type { ActionOutcome } from "@/server/schemas/action";

/** Reads tasks, snoozes, closes and dismisses them, calls patients. */
export const ACTION_WORKER_ROLES = ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] as const;

/**
 * Reads of the task list. Doctors keep the reads (and done / dismiss) they
 * already had; the CRM shell sends them to their own cabinet anyway.
 */
export const ACTION_READER_ROLES = [...ACTION_WORKER_ROLES, "DOCTOR"] as const;

/**
 * The roles of the canonical cancel (DELETE /api/crm/appointments/[id]).
 * An outcome that cancels the visit, or moves it in the visit drawer, needs
 * one of them.
 */
export const APPOINTMENT_CANCEL_ROLES = ["ADMIN", "RECEPTIONIST"] as const;

/** What a call operator records on the phone without touching the visit. */
const CALL_OPERATOR_OUTCOMES: ReadonlySet<ActionOutcome> = new Set<ActionOutcome>([
  "CONFIRMED",
  "CALLBACK",
  "NO_ANSWER",
]);

export function canWorkActionCenter(role: string | null | undefined): boolean {
  if (!role) return false;
  return (
    role === "SUPER_ADMIN" ||
    (ACTION_READER_ROLES as readonly string[]).includes(role)
  );
}

/**
 * May `role` record `outcome` on a risk-today row? Admins and reception
 * record all six. A call operator records the ones that leave the visit as
 * it is or confirm it: «Отказался» and «Хочет прийти позже» cancel the visit
 * and «Перенести» moves it in the drawer, which are reception's (the matrix
 * gives the operator no cancel).
 */
export function canRecordRiskOutcome(
  role: string | null | undefined,
  outcome: ActionOutcome,
): boolean {
  if (!role) return false;
  if (role === "SUPER_ADMIN") return true;
  if ((APPOINTMENT_CANCEL_ROLES as readonly string[]).includes(role)) return true;
  if (role === "CALL_OPERATOR") return CALL_OPERATOR_OUTCOMES.has(outcome);
  return false;
}
