/**
 * Action Center — TypeScript types (Phase 13 Wave 1).
 *
 * `Action` is the persistence model defined in `prisma/schema.prisma`. The
 * payload column is freeform JSON; the discriminated union `ActionPayload`
 * here is the single source of truth for what each detector emits and what
 * the UI consumes.
 *
 * Currency convention: all `*Uzs` integer fields inside payloads are in
 * **tiins** (UZS minor units, x100). This mirrors Payment.amount and the
 * pricing engine — never store fractional UZS in the action payload.
 *
 * Wave 1 ships only types + REST endpoints. Wave 2 adds detectors that
 * produce these payloads. Wave 3 adds the UI that renders them.
 */

export const ACTION_TYPES = [
  "EMPTY_SLOT_TOMORROW",
  "DORMANT_BATCH",
  "UNCONFIRMED_24H",
  "NO_SHOW_RISK_HIGH",
  "CASE_REPEAT_DUE",
  "OVERDUE_FOLLOW_UP",
  "DOCTOR_OVERLOAD",
  "IDLE_ROOM",
  "PAYMENT_OVERDUE",
  "LOW_DOCTOR_SCHEDULE",
  // Phase 16 Wave 2 — Patient Experience.
  // Emitted when the post-visit NPS endpoint receives a score below the
  // clinic's `npsAlertThreshold` (default 7). Dedupe keyed off
  // `appointmentId` so resubmits on the same visit collapse onto the same
  // row. Severity 'high' by default; admins can dismiss after follow-up.
  "LOW_NPS_RECEIVED",
  // Wave 4 of `docs/TZ-sms-removal.md` — TG-less patient compensator.
  // Emitted by the notification materializer when `resolveChannels()`
  // returns [] OR no recipient can be derived. Surfaces the dropped signal
  // in /crm/action-center so the operator can call the patient via the
  // Call Center instead of silently dropping the reminder. Dedupe keyed on
  // (patientId, triggerKey, bucket=UTC-date) so each 24-hour window can
  // produce at most one row per (patient, trigger).
  "PATIENT_NO_CHANNEL",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type ActionSeverity = (typeof ACTION_SEVERITIES)[number];

export const ACTION_STATUSES = [
  "OPEN",
  "SNOOZED",
  "DISMISSED",
  "DONE",
  "EXPIRED",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * Severity ordering for sort. Higher number = more severe; consumers render
 * critical first, then high, medium, low. Keep the keys in sync with
 * `ACTION_SEVERITIES`.
 */
export const SEVERITY_RANK: Record<ActionSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ──────────────────────────────────────────────────────────────────────────
// Discriminated union per ActionType. Detectors construct one of these and
// pass it to `upsertAction(...)`. The shape here is what eventually lands
// in the `payload` JSONB column.
// ──────────────────────────────────────────────────────────────────────────

export type EmptySlotTomorrowPayload = {
  type: "EMPTY_SLOT_TOMORROW";
  doctorId: string;
  doctorName: string;
  /** ISO-8601 datetime for the slot start (UTC). */
  slotStart: string;
  /** ISO-8601 datetime for the slot end (UTC). */
  slotEnd: string;
  specialty: string;
  /** Estimated revenue lost while this slot stays empty. UZS minor units (tiins). */
  estimatedRevenueLossUzs: number;
};

export type DormantBatchPayload = {
  type: "DORMANT_BATCH";
  segment: "90-180" | "180-365" | "365+";
  patientCount: number;
  /** ISO-8601 timestamp of the last campaign sent to this segment, or null. */
  lastCampaignAt: string | null;
};

export type Unconfirmed24hPayload = {
  type: "UNCONFIRMED_24H";
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** ISO-8601 datetime of the appointment start (UTC). */
  appointmentAt: string;
  doctorName: string;
};

export type NoShowRiskHighPayload = {
  type: "NO_SHOW_RISK_HIGH";
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** Probability in [0, 1]. */
  risk: number;
  /** ISO-8601 datetime of the appointment start (UTC). */
  appointmentAt: string;
};

export type CaseRepeatDuePayload = {
  type: "CASE_REPEAT_DUE";
  caseId: string;
  patientId: string;
  patientName: string;
  /** ISO-8601 date (YYYY-MM-DD) when the repeat visit becomes due. */
  dueDate: string;
  /** ISO-8601 datetime of the most recent visit on the case. */
  lastVisitAt: string;
};

export type OverdueFollowUpPayload = {
  type: "OVERDUE_FOLLOW_UP";
  appointmentId: string;
  patientId: string;
  daysSinceVisit: number;
};

export type DoctorOverloadPayload = {
  type: "DOCTOR_OVERLOAD";
  doctorId: string;
  doctorName: string;
  queueLength: number;
  /** Doctor IDs of available colleagues who could absorb the queue. */
  alternativeDoctorIds: string[];
};

export type IdleRoomPayload = {
  type: "IDLE_ROOM";
  cabinetId: string;
  cabinetName: string;
  idleMinutes: number;
  queueLength: number;
};

export type PaymentOverduePayload = {
  type: "PAYMENT_OVERDUE";
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** Outstanding amount in UZS minor units (tiins). */
  amountUzs: number;
  daysOverdue: number;
};

export type LowDoctorSchedulePayload = {
  type: "LOW_DOCTOR_SCHEDULE";
  doctorId: string;
  doctorName: string;
  slotsNext7Days: number;
};

/**
 * Phase 16 Wave 2 — Patient Experience.
 *
 * Emitted by `POST /api/miniapp/nps/[appointmentId]` when the patient
 * submits a score < `Clinic.npsAlertThreshold`. Dedupe keyed off
 * `appointmentId` so the same visit never produces two rows even if the
 * patient resubmits (which we 409 anyway, but defence-in-depth).
 *
 * `commentPreview` is the first ~120 chars of the patient's comment, with
 * trailing whitespace trimmed and an ellipsis on truncation. Empty string
 * when the patient didn't leave a comment — the formatter renders the body
 * with a generic call-to-action in that case.
 */
export type LowNpsReceivedPayload = {
  type: "LOW_NPS_RECEIVED";
  patientId: string;
  patientName: string;
  appointmentId: string;
  doctorId: string | null;
  doctorName: string;
  /** 1..10 NPS scale. */
  score: number;
  /** First ~120 chars of the patient comment (with ellipsis on truncate). */
  commentPreview: string;
};

/**
 * Wave 4 of `docs/TZ-sms-removal.md` — PATIENT_NO_CHANNEL.
 *
 * Recorded when the notifications materializer cannot dispatch to a patient
 * because they have no telegramId AND no other usable channel. Without SMS
 * fallback, the reminder is silently lost; this Action gives the operator a
 * task to reach out via the Call Center.
 *
 * `triggerKey` is the logical TriggerKey from
 * `src/server/notifications/triggers.ts` (e.g. "appointment.reminder-24h").
 * `bucket` is the UTC date `YYYY-MM-DD` of the skip; together with patientId
 * + triggerKey it forms the 24h dedupe window. A new bucket the next day
 * re-opens the Action if the patient remains unreachable.
 */
export type PatientNoChannelPayload = {
  type: "PATIENT_NO_CHANNEL";
  patientId: string;
  patientName: string;
  triggerKey: string;
  /** Set when the trigger is appointment-scoped, else null. */
  appointmentId: string | null;
  /** ISO datetime of the appointment, when known. */
  appointmentAt: string | null;
  /** UTC YYYY-MM-DD bucket for the 24h dedupe window. */
  bucket: string;
};

export type ActionPayload =
  | EmptySlotTomorrowPayload
  | DormantBatchPayload
  | Unconfirmed24hPayload
  | NoShowRiskHighPayload
  | CaseRepeatDuePayload
  | OverdueFollowUpPayload
  | DoctorOverloadPayload
  | IdleRoomPayload
  | PaymentOverduePayload
  | LowDoctorSchedulePayload
  | LowNpsReceivedPayload
  | PatientNoChannelPayload;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute the canonical dedupe key for an action payload.
 *
 * Pure / deterministic / order-independent. Two payloads produce the same
 * key iff every meaningful discriminator field is identical. Detectors that
 * upsert into `Action` rely on this so a re-run does not spam new rows for
 * the same underlying signal.
 *
 * Format: `<TYPE>:<k1>=<v1>:<k2>=<v2>:...` with keys sorted lexicographically
 * (excluding the `type` discriminator). Keep this stable across releases —
 * changing the format invalidates existing deduped rows on next pass.
 */
export function dedupeKeyFor(payload: ActionPayload): string {
  // Exhaustive switch — TypeScript will yell if a new ActionType is added
  // without a case here.
  switch (payload.type) {
    case "EMPTY_SLOT_TOMORROW":
      return `EMPTY_SLOT_TOMORROW:doctorId=${payload.doctorId}:slotStart=${payload.slotStart}`;
    case "DORMANT_BATCH":
      return `DORMANT_BATCH:segment=${payload.segment}`;
    case "UNCONFIRMED_24H":
      return `UNCONFIRMED_24H:appointmentId=${payload.appointmentId}`;
    case "NO_SHOW_RISK_HIGH":
      return `NO_SHOW_RISK_HIGH:appointmentId=${payload.appointmentId}`;
    case "CASE_REPEAT_DUE":
      return `CASE_REPEAT_DUE:caseId=${payload.caseId}`;
    case "OVERDUE_FOLLOW_UP":
      return `OVERDUE_FOLLOW_UP:appointmentId=${payload.appointmentId}`;
    case "DOCTOR_OVERLOAD":
      return `DOCTOR_OVERLOAD:doctorId=${payload.doctorId}`;
    case "IDLE_ROOM":
      return `IDLE_ROOM:cabinetId=${payload.cabinetId}`;
    case "PAYMENT_OVERDUE":
      return `PAYMENT_OVERDUE:appointmentId=${payload.appointmentId}`;
    case "LOW_DOCTOR_SCHEDULE":
      return `LOW_DOCTOR_SCHEDULE:doctorId=${payload.doctorId}`;
    case "LOW_NPS_RECEIVED":
      return `LOW_NPS_RECEIVED:appointmentId=${payload.appointmentId}`;
    case "PATIENT_NO_CHANNEL":
      return `PATIENT_NO_CHANNEL:patientId=${payload.patientId}:triggerKey=${payload.triggerKey}:bucket=${payload.bucket}`;
    default: {
      // Compile-time exhaustiveness guard.
      const _exhaustive: never = payload;
      throw new Error(
        `dedupeKeyFor: unhandled payload type ${(_exhaustive as { type: string }).type}`,
      );
    }
  }
}

/**
 * Default severity per action type. Detectors may override to escalate, but
 * this fallback keeps the engine working even when a detector forgets to
 * pass an explicit value.
 *
 * Rationale (locked in for Wave 1; revisit in Wave 2 once detector noise is
 * measured):
 *   - critical: payment/no-show — direct revenue + reputational risk.
 *   - high: empty slot, doctor overload, case repeat due — revenue & care.
 *   - medium: unconfirmed appts, overdue follow-up, dormant batch, idle room.
 *   - low: low doctor schedule (forward-looking, not urgent).
 */
export function defaultSeverity(type: ActionType): ActionSeverity {
  switch (type) {
    case "PAYMENT_OVERDUE":
    case "NO_SHOW_RISK_HIGH":
      return "critical";
    case "EMPTY_SLOT_TOMORROW":
    case "DOCTOR_OVERLOAD":
    case "CASE_REPEAT_DUE":
    case "LOW_NPS_RECEIVED":
      return "high";
    case "UNCONFIRMED_24H":
    case "OVERDUE_FOLLOW_UP":
    case "DORMANT_BATCH":
    case "IDLE_ROOM":
    case "PATIENT_NO_CHANNEL":
      return "medium";
    case "LOW_DOCTOR_SCHEDULE":
      return "low";
    default: {
      const _exhaustive: never = type;
      throw new Error(
        `defaultSeverity: unhandled ActionType ${_exhaustive as string}`,
      );
    }
  }
}

/**
 * Default deeplink path per action type. Detectors are free to override
 * with a query-string-augmented variant (e.g. include the entity id), but
 * this fallback gives every action a sensible navigation target.
 */
export function defaultDeeplinkPath(type: ActionType): string {
  switch (type) {
    case "EMPTY_SLOT_TOMORROW":
      return "/crm/calendar";
    case "DORMANT_BATCH":
      return "/crm/notifications/campaigns/new?segment=dormant";
    case "UNCONFIRMED_24H":
      return "/crm/appointments?status=BOOKED";
    case "NO_SHOW_RISK_HIGH":
      return "/crm/appointments";
    case "CASE_REPEAT_DUE":
      return "/crm/cases";
    case "OVERDUE_FOLLOW_UP":
      return "/crm/appointments";
    case "DOCTOR_OVERLOAD":
      return "/crm/calendar";
    case "IDLE_ROOM":
      return "/crm/calendar";
    case "PAYMENT_OVERDUE":
      return "/crm/payments";
    case "LOW_DOCTOR_SCHEDULE":
      return "/crm/doctors";
    case "LOW_NPS_RECEIVED":
      // Deep-link to the action-center first; the row's payload carries
      // patientId so the front end can offer a "Open patient" jump.
      return "/crm/action-center";
    case "PATIENT_NO_CHANNEL":
      // Operator's first step is "call the patient". The Call Center has
      // the queue + dialler — call sites override with /crm/patients/<id>
      // when they want to land directly on the patient card.
      return "/crm/call-center";
    default: {
      const _exhaustive: never = type;
      throw new Error(
        `defaultDeeplinkPath: unhandled ActionType ${_exhaustive as string}`,
      );
    }
  }
}

/**
 * Default assignee role per action type. Mirrors the spec table in
 * `docs/ROADMAP-11x.md` (Phase 13 — Action Center). `null` here means
 * "any role can claim/dismiss".
 */
export function defaultAssigneeRole(type: ActionType): "ADMIN" | "RECEPTIONIST" | null {
  switch (type) {
    case "DORMANT_BATCH":
    case "OVERDUE_FOLLOW_UP":
    case "LOW_DOCTOR_SCHEDULE":
    case "LOW_NPS_RECEIVED":
      return "ADMIN";
    case "EMPTY_SLOT_TOMORROW":
    case "UNCONFIRMED_24H":
    case "NO_SHOW_RISK_HIGH":
    case "CASE_REPEAT_DUE":
    case "DOCTOR_OVERLOAD":
    case "IDLE_ROOM":
    case "PAYMENT_OVERDUE":
    case "PATIENT_NO_CHANNEL":
      return "RECEPTIONIST";
    default: {
      const _exhaustive: never = type;
      throw new Error(
        `defaultAssigneeRole: unhandled ActionType ${_exhaustive as string}`,
      );
    }
  }
}

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

export function isActionSeverity(value: string): value is ActionSeverity {
  return (ACTION_SEVERITIES as readonly string[]).includes(value);
}

export function isActionStatus(value: string): value is ActionStatus {
  return (ACTION_STATUSES as readonly string[]).includes(value);
}
