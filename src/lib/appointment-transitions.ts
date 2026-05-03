/**
 * Single source of truth for appointment status transitions and the UI
 * actions that follow from a given status.
 *
 * Used by: bulk-bar, drawer status dropdown, drawer cancel button,
 * reception "вызвать следующего", and the server-side guard on
 * status-changing endpoints.
 */

export type AppointmentStatus =
  | "BOOKED"
  | "WAITING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED"
  | "CANCELLED"
  | "NO_SHOW";

/**
 * Allowed forward transitions. A no-op (from === to) is always allowed.
 * COMPLETED, CANCELLED, NO_SHOW are terminal — reopening requires a
 * separate flow (creating a new appointment) which is not covered here.
 */
const TRANSITIONS: Record<AppointmentStatus, ReadonlySet<AppointmentStatus>> = {
  BOOKED: new Set(["WAITING", "IN_PROGRESS", "NO_SHOW", "CANCELLED"]),
  WAITING: new Set(["BOOKED", "IN_PROGRESS", "SKIPPED", "NO_SHOW", "CANCELLED"]),
  IN_PROGRESS: new Set(["WAITING", "COMPLETED", "CANCELLED"]),
  SKIPPED: new Set(["WAITING", "IN_PROGRESS", "NO_SHOW", "CANCELLED"]),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
  NO_SHOW: new Set([]),
};

export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].has(to);
}

/**
 * Time-aware extension of `canTransition`. NO_SHOW only makes sense once the
 * scheduled start time has passed — until then the patient is not yet "late".
 * `graceMinutes` lets the caller decide how soon after the start a no-show
 * call is allowed (default: 0, i.e., the moment the visit was supposed to
 * begin).
 */
export function canTransitionAt(
  from: AppointmentStatus,
  to: AppointmentStatus,
  appointmentDate: Date,
  now: Date = new Date(),
  graceMinutes = 0,
): { ok: true } | { ok: false; reason: "invalid_transition" | "too_early_for_no_show" } {
  if (!canTransition(from, to)) {
    return { ok: false, reason: "invalid_transition" };
  }
  if (to === "NO_SHOW" && from !== "NO_SHOW") {
    const threshold = new Date(
      appointmentDate.getTime() + graceMinutes * 60_000,
    );
    if (now < threshold) {
      return { ok: false, reason: "too_early_for_no_show" };
    }
  }
  return { ok: true };
}

/** Statuses that the user is allowed to set next, including the current one. */
export function nextStatuses(from: AppointmentStatus): AppointmentStatus[] {
  return [from, ...Array.from(TRANSITIONS[from])];
}

/** Per-row action availability — the UI consults this to enable buttons. */
export interface AppointmentActions {
  /** Mark "Пришёл" → queueStatus=WAITING. Valid only when not yet arrived. */
  canMarkArrived: boolean;
  /** Mark "Не пришёл" → status=NO_SHOW. Valid before the patient is seen. */
  canMarkNoShow: boolean;
  /** Reschedule (move to another date/slot). */
  canReschedule: boolean;
  /** Soft-cancel the appointment. */
  canCancel: boolean;
  /** Send an SMS reminder. Pointless after the visit happened/was missed. */
  canSendReminder: boolean;
  /** "Вызвать к врачу" → queueStatus=IN_PROGRESS. */
  canCallNext: boolean;
  /** Mark the appointment as completed → COMPLETED. */
  canComplete: boolean;
}

const NO_ACTIONS: AppointmentActions = {
  canMarkArrived: false,
  canMarkNoShow: false,
  canReschedule: false,
  canCancel: false,
  canSendReminder: false,
  canCallNext: false,
  canComplete: false,
};

export function actionsFor(status: AppointmentStatus): AppointmentActions {
  switch (status) {
    case "BOOKED":
      return {
        canMarkArrived: true,
        canMarkNoShow: true,
        canReschedule: true,
        canCancel: true,
        canSendReminder: true,
        canCallNext: true,
        canComplete: false,
      };
    case "WAITING":
      return {
        canMarkArrived: false,
        canMarkNoShow: true,
        canReschedule: true,
        canCancel: true,
        canSendReminder: false,
        canCallNext: true,
        canComplete: false,
      };
    case "IN_PROGRESS":
      return {
        ...NO_ACTIONS,
        canCancel: true,
        canComplete: true,
      };
    case "SKIPPED":
      return {
        canMarkArrived: true,
        canMarkNoShow: true,
        canReschedule: true,
        canCancel: true,
        canSendReminder: false,
        canCallNext: true,
        canComplete: false,
      };
    case "COMPLETED":
    case "CANCELLED":
    case "NO_SHOW":
      return NO_ACTIONS;
  }
}

/**
 * Action availability for a multi-row selection — an action is allowed
 * only if EVERY selected row allows it. Empty selection allows nothing.
 */
export function actionsForMany(
  statuses: AppointmentStatus[],
): AppointmentActions {
  if (statuses.length === 0) return NO_ACTIONS;
  const each = statuses.map(actionsFor);
  return {
    canMarkArrived: each.every((a) => a.canMarkArrived),
    canMarkNoShow: each.every((a) => a.canMarkNoShow),
    canReschedule: each.every((a) => a.canReschedule),
    canCancel: each.every((a) => a.canCancel),
    canSendReminder: each.every((a) => a.canSendReminder),
    canCallNext: each.every((a) => a.canCallNext),
    canComplete: each.every((a) => a.canComplete),
  };
}
