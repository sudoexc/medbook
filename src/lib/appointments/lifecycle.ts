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
 *
 * CONFIRMED sits between BOOKED and WAITING: reception phones the patient
 * the day before and flips them to CONFIRMED if they say "yes". Walk-ins
 * skip the step (BOOKED → WAITING is still a legal transition), in which
 * case the chain renders CONFIRMED as "passed" even though it was never
 * literally entered — the dot lights up so the visual progress stays
 * monotonic.
 */
export const LIFECYCLE_STEPS: readonly AppointmentStatus[] = [
  "BOOKED",
  "CONFIRMED",
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
 * State ownership — which roles can advance an appointment INTO this target.
 * Anchors the role/action separation: who DRIVES the lifecycle, not who is
 * merely co-present.
 *
 *   - IN_PROGRESS / COMPLETED are shared between the doctor and the front
 *     desk. Two-lanes model (docs/TZ-two-lanes.md, «врач/ресепшн выбирает
 *     сам»): the doctor starts/finishes visits from /my-day, and reception
 *     drives the same transitions from the cabinets board («Вызвать из
 *     очереди» / «Начать запись»). NURSE stays read-only via
 *     `canMutateStatus`; CALL_OPERATOR never advances the visit lifecycle.
 *
 * Targets not listed default to "any mutate-permitted role" — confirmation
 * (CONFIRMED), intake (WAITING), and the off-path triplet (NO_SHOW /
 * CANCELLED / SKIPPED) all belong to the front desk's authority.
 *
 * This applies on BOTH the drawer's lifecycle chain AND the server-side
 * PATCH guards so a stale tab can't sneak past — see lifecycle middleware
 * in `/api/crm/appointments/[id]` and `.../queue-status`.
 */
const STATE_OWNERS: Partial<
  Record<AppointmentStatus, ReadonlySet<LifecycleRole>>
> = {
  IN_PROGRESS: new Set<LifecycleRole>([
    "DOCTOR",
    "ADMIN",
    "SUPER_ADMIN",
    "RECEPTIONIST",
  ]),
  COMPLETED: new Set<LifecycleRole>([
    "DOCTOR",
    "ADMIN",
    "SUPER_ADMIN",
    "RECEPTIONIST",
  ]),
};

/**
 * Returns true when `role` is allowed to advance an appointment into the
 * `target` state. Pure: maps `target` → owner set; if the target has no
 * owner restriction, any mutate-permitted role may advance to it.
 *
 * Server-side and client-side BOTH call this — keep the function side-
 * effect-free so the same outcome is produced in both environments.
 */
export function canRoleAdvanceTo(
  role: LifecycleRole,
  target: AppointmentStatus,
): boolean {
  const owners = STATE_OWNERS[target];
  return owners ? owners.has(role) : true;
}

/**
 * True when the role is structurally locked out of `target` by ownership
 * (as opposed to "not reachable yet from the current state"). Used by the
 * UI to render a lock affordance on the chain pill so the operator knows
 * "another role drives this" rather than "wait, you'll get there".
 */
export function isOwnershipLocked(
  role: LifecycleRole,
  target: AppointmentStatus,
): boolean {
  return STATE_OWNERS[target] !== undefined && !canRoleAdvanceTo(role, target);
}

/**
 * Allowed transitions from `current` for the given `role`. Filters by:
 *   1. self-loop excluded
 *   2. legal in the state machine (canTransition)
 *   3. role-ownership of the target (canRoleAdvanceTo)
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
    "CONFIRMED",
    "WAITING",
    "IN_PROGRESS",
    "COMPLETED",
    "SKIPPED",
    "CANCELLED",
    "NO_SHOW",
  ];
  return all.filter(
    (s) =>
      s !== current &&
      canTransition(current, s) &&
      canRoleAdvanceTo(role, s),
  );
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
 *
 * `confirm` here means "wrap in an Are-You-Sure dialog" — it is unrelated to
 * the CONFIRM action kind (which is the pre-visit phone confirmation flip).
 */
export type QuickAction =
  | { kind: "CONFIRM"; to: "CONFIRMED"; confirm: false }
  | { kind: "ARRIVED"; to: "WAITING"; confirm: false }
  | { kind: "START"; to: "IN_PROGRESS"; confirm: false }
  | { kind: "COMPLETE"; to: "COMPLETED"; confirm: false }
  | { kind: "NO_SHOW"; to: "NO_SHOW"; confirm: true };

/**
 * Lifecycle ownership by action — anchors the role/action separation enforced
 * below. Reception desks own intake (CONFIRM + ARRIVED + NO_SHOW): they decide
 * whether the patient is on the phone or in the room. Doctors own the
 * consultation itself (START + COMPLETE): they're the ones delivering care.
 * Admins fall on the reception side because the surface here IS reception —
 * the drawer chain enforces the same ownership via `STATE_OWNERS`, so there
 * is no admin emergency-override path that bypasses this split.
 */
const RECEPTION_ROLES = new Set<LifecycleRole>([
  "ADMIN",
  "SUPER_ADMIN",
  "RECEPTIONIST",
]);

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

  const isDoctor = role === "DOCTOR";
  const isReception = RECEPTION_ROLES.has(role);

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
  // Pre-visit confirmation belongs to the front desk: receptionists ring the
  // patient the day before and flip BOOKED → CONFIRMED. We surface CONFIRM
  // ahead of ARRIVED because for most rows the phone call happens before the
  // patient physically arrives. On CONFIRMED rows isForward returns false
  // for "CONFIRMED" (current === target), so the button self-hides.
  if (
    isReception &&
    allowed.has("CONFIRMED") &&
    isForward("CONFIRMED")
  ) {
    actions.push({ kind: "CONFIRM", to: "CONFIRMED", confirm: false });
  }
  // Intake belongs to the front desk: doctors don't tick "patient walked in".
  if (
    isReception &&
    allowed.has("WAITING") &&
    isForward("WAITING")
  ) {
    actions.push({ kind: "ARRIVED", to: "WAITING", confirm: false });
  }
  // START/COMPLETE quick icons stay doctor-only as a UI policy: reception
  // starts visits from the cabinet card («Вызвать из очереди» / «Начать
  // запись»), not from per-row icons. Ownership itself is shared — see
  // STATE_OWNERS above.
  if (
    isDoctor &&
    allowed.has("IN_PROGRESS") &&
    isForward("IN_PROGRESS")
  ) {
    actions.push({ kind: "START", to: "IN_PROGRESS", confirm: false });
  }
  // Same UI policy for completion — the doctor's row is the one-click path.
  if (
    isDoctor &&
    allowed.has("COMPLETED") &&
    isForward("COMPLETED")
  ) {
    actions.push({ kind: "COMPLETE", to: "COMPLETED", confirm: false });
  }
  // NO_SHOW is shared: receptionists trigger it when the patient never
  // arrives; doctors trigger it when they finish reception's WAITING-bucket
  // patients ahead of a no-show that drifted through.
  if (allowed.has("NO_SHOW")) {
    actions.push({ kind: "NO_SHOW", to: "NO_SHOW", confirm: true });
  }
  return actions;
}
