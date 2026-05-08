/**
 * Phase 12 Wave 1 — Lifecycle helpers.
 *
 * The visual lifecycle chain on the appointment drawer and the quick-action
 * icons on the reception queue card both need to ask the same questions:
 *
 *   1. Which statuses can the user jump to from here?
 *   2. Is the candidate transition still valid given the user's role and
 *      the appointment's scheduled time? (NO_SHOW only after the slot.)
 *
 * The PATCH endpoints (`/api/crm/appointments/[id]` and
 * `/api/crm/appointments/[id]/queue-status`) already enforce both constraints
 * server-side via `canTransition` / `canTransitionAt` (see
 * `src/lib/appointment-transitions.ts`). The helpers below mirror that
 * authority on the client so we can disable buttons and hide unreachable
 * icons before the user clicks. Server-side guards remain the source of
 * truth.
 */
import {
  canTransition,
  canTransitionAt,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";

export type LifecycleRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

/**
 * The "happy-path" sequence rendered as a horizontal chain in the drawer.
 * Off-path statuses (NO_SHOW, CANCELLED, SKIPPED) live in a sidebar and are
 * NOT part of this list — they are reachable via dedicated affordances.
 */
export const LIFECYCLE_STEPS: readonly AppointmentStatus[] = [
  "BOOKED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

/** Non-linear ("off-path") states. */
export const LIFECYCLE_OFFPATH = [
  "NO_SHOW",
  "CANCELLED",
  "SKIPPED",
] as const satisfies readonly AppointmentStatus[];

export type LifecycleOffpath = (typeof LIFECYCLE_OFFPATH)[number];

/**
 * Roles permitted to mutate an appointment's status from the CRM UI.
 *
 * NURSE has read-only access to today's appointments (see
 * `src/lib/permissions/matrix.ts`). CALL_OPERATOR can edit Lead/Call rows
 * but does not advance visit lifecycle in this wave.
 */
export function canMutateStatus(role: LifecycleRole): boolean {
  switch (role) {
    case "SUPER_ADMIN":
    case "ADMIN":
    case "RECEPTIONIST":
    case "DOCTOR":
      return true;
    case "NURSE":
    case "CALL_OPERATOR":
      return false;
  }
}

/**
 * Allowed transitions from `current` for the given `role`. Returns at most
 * the per-status set declared in `appointment-transitions.ts`, filtered down
 * by role. Self-transition is never returned (it's a no-op and would render
 * as an enabled-but-meaningless button).
 *
 * Pure: no side effects, no reads from globals. Safe to import in tests.
 */
export function getAllowedTransitions(
  current: AppointmentStatus,
  role: LifecycleRole,
): AppointmentStatus[] {
  if (!canMutateStatus(role)) return [];
  const all: AppointmentStatus[] = [
    "BOOKED",
    "WAITING",
    "IN_PROGRESS",
    "COMPLETED",
    "SKIPPED",
    "CANCELLED",
    "NO_SHOW",
  ];
  return all.filter((s) => s !== current && canTransition(current, s));
}

/**
 * Time-aware extension. Mirrors the server-side guard at
 * `src/app/api/crm/appointments/[id]/route.ts` (Phase 9 H3) so that the
 * NO_SHOW button is greyed-out before the slot starts instead of letting
 * the user click and bounce off a 409.
 *
 * `appointmentDate` is the scheduled start; `now` defaults to "actual now"
 * but is injected for tests.
 */
export function getAllowedTransitionsAt(
  current: AppointmentStatus,
  role: LifecycleRole,
  appointmentDate: Date,
  now: Date = new Date(),
  graceMinutes = 0,
): AppointmentStatus[] {
  return getAllowedTransitions(current, role).filter((s) => {
    const r = canTransitionAt(current, s, appointmentDate, now, graceMinutes);
    return r.ok;
  });
}

/**
 * Lifecycle "step" status used by the drawer chain. PASSED + CURRENT pills
 * are filled; FUTURE is muted-outline; UNREACHABLE means the appointment
 * has gone off-path and the chain is no longer applicable.
 */
export type LifecycleStepState = "passed" | "current" | "future" | "unreachable";

/**
 * For each happy-path step, decide how to render it given the appointment's
 * current status. If the appointment is on an off-path state (CANCELLED /
 * NO_SHOW / SKIPPED), every step is "unreachable" — the chain renders muted.
 */
export function getStepStates(
  current: AppointmentStatus,
): Record<(typeof LIFECYCLE_STEPS)[number], LifecycleStepState> {
  const isOffPath = (LIFECYCLE_OFFPATH as readonly AppointmentStatus[]).includes(
    current as AppointmentStatus,
  );
  const idxOf = (s: AppointmentStatus) => LIFECYCLE_STEPS.indexOf(s);
  const currentIdx = idxOf(current);

  const out = {} as Record<(typeof LIFECYCLE_STEPS)[number], LifecycleStepState>;
  for (const step of LIFECYCLE_STEPS) {
    if (isOffPath) {
      out[step] = "unreachable";
      continue;
    }
    const stepIdx = idxOf(step);
    if (currentIdx < 0) {
      out[step] = "future";
    } else if (stepIdx < currentIdx) {
      out[step] = "passed";
    } else if (stepIdx === currentIdx) {
      out[step] = "current";
    } else {
      out[step] = "future";
    }
  }
  return out;
}

/**
 * Forward-only icons used by the reception card's quick-action row. Returns
 * the next step icon hints in declaration order. NO_SHOW is always last and
 * tagged `confirm` so the UI knows to wrap it in a popover.
 */
export type QuickAction =
  | { kind: "ARRIVED"; to: "WAITING"; confirm: false }
  | { kind: "START"; to: "IN_PROGRESS"; confirm: false }
  | { kind: "COMPLETE"; to: "COMPLETED"; confirm: false }
  | { kind: "NO_SHOW"; to: "NO_SHOW"; confirm: true };

export function getQuickActions(
  current: AppointmentStatus,
  role: LifecycleRole,
  appointmentDate: Date,
  now: Date = new Date(),
): QuickAction[] {
  if (!canMutateStatus(role)) return [];
  const allowed = new Set(
    getAllowedTransitionsAt(current, role, appointmentDate, now),
  );

  // Quick-action row is forward-only: we hide ARRIVED once the patient is
  // past WAITING, hide START once they're past IN_PROGRESS, etc. The state
  // machine permits some "back" moves (IN_PROGRESS → WAITING) but those
  // belong in the drawer's lifecycle chain, not the receptionist's
  // one-click row. Anchor "forward" on the happy-path order.
  const idx = LIFECYCLE_STEPS.indexOf(current);
  const isForward = (to: AppointmentStatus): boolean => {
    const toIdx = LIFECYCLE_STEPS.indexOf(to);
    if (toIdx < 0) return false; // off-path is handled separately
    if (idx < 0) return true; // off-path origin: any happy-path target counts
    return toIdx > idx;
  };

  const actions: QuickAction[] = [];
  if (allowed.has("WAITING") && isForward("WAITING")) {
    actions.push({ kind: "ARRIVED", to: "WAITING", confirm: false });
  }
  if (allowed.has("IN_PROGRESS") && isForward("IN_PROGRESS")) {
    actions.push({ kind: "START", to: "IN_PROGRESS", confirm: false });
  }
  if (allowed.has("COMPLETED") && isForward("COMPLETED")) {
    actions.push({ kind: "COMPLETE", to: "COMPLETED", confirm: false });
  }
  if (allowed.has("NO_SHOW")) {
    actions.push({ kind: "NO_SHOW", to: "NO_SHOW", confirm: true });
  }
  return actions;
}
