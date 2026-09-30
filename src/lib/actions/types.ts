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
import { tashkentDateOf } from "@/lib/tashkent-time";

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
  // Ф6 (TZ-smart-constructor) — follow-up visit task. Emitted by the
  // medication-bridge sweep when a finalized VisitNote carries
  // `followUpDays` or `followUpDate`. Dedupe keyed off visitNoteId — one
  // task per visit no matter how many sweep retries happen.
  "VISIT_FOLLOW_UP_DUE",
  // Audit MA-04 / PH-01 — one Telegram account proved it is the patient of
  // a clinic card (invite link or its own shared contact), but the account
  // is already bound to another card that holds real history. Nothing is
  // merged automatically; reception decides. Dedupe keyed on the card pair.
  "TELEGRAM_LINK_CONFLICT",
  // Audit AC-04 — a risk-today row whose only signal is «не на связи» has no
  // detector Action, so the call outcome had nowhere to live: «Отказался»
  // cancelled nothing and «Не дозвонился» vanished. The outcome endpoint
  // creates this row on demand (dedupe keyed off appointmentId) and records
  // the outcome on it exactly like on NO_SHOW_RISK_HIGH / UNCONFIRMED_24H.
  "NO_CONTACT_CALL",
  // Audit AC-09 — «Перезвонить» / «Хочет прийти позже» promised the patient
  // a call at a time the appointment's own risk rows cannot reach: they
  // expire with the visit (or its clinic day), so a callback set for tomorrow
  // never came back. The outcome hands the promise to this row, which
  // surfaces at the chosen time and lives until a person closes it. Dedupe
  // keyed off the appointment the call was about.
  "PATIENT_CALLBACK",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * The Action types a risk-today row (one appointment of the day) is built
 * from. Shared by the risk-today list and its per-appointment outcome
 * endpoint so both resolve the same rows.
 */
export const RISK_ACTION_TYPES = [
  "NO_SHOW_RISK_HIGH",
  "UNCONFIRMED_24H",
  "NO_CONTACT_CALL",
] as const satisfies readonly ActionType[];

/**
 * Appointment statuses that mean the patient is already in the clinic: in the
 * live queue (reception pressed «Пришёл», or registered a walk-in) or in the
 * doctor's room. Such a patient cannot fail to show up, so no no-show or
 * confirmation signal applies to the visit any more (audit AC-07).
 */
export const IN_CLINIC_APPOINTMENT_STATUSES = [
  "WAITING",
  "IN_PROGRESS",
] as const;

/**
 * Appointment statuses a risk-today row can stand for: the visit is still
 * ahead and the patient has not arrived. The risk-today list and its outcome
 * endpoint share the list, so an outcome can only be recorded for a row the
 * list could show (audit review of AC-04: the endpoint used to cancel any
 * visit by id). Every one of them may still move to CANCELLED, which
 * «Отказался» and «Хочет прийти позже» rely on.
 *
 * WAITING / IN_PROGRESS are left out (audit AC-07): a patient sitting in the
 * hall was offered to reception as a call «риск пропуска» / «не на связи»,
 * and every returning walk-in joined the list the moment it was registered.
 */
export const RISK_TODAY_APPOINTMENT_STATUSES = [
  "BOOKED",
  "CONFIRMED",
] as const;

/**
 * Types the Action engine (`src/server/actions/engine.ts`) re-upserts on
 * every 15-minute pass while their signal holds. Only these rows fall back
 * to the 48h `updatedAt` sweep in `expireStaleActions`: a stale `updatedAt`
 * there means the detector stopped firing. Every other type is written once
 * by the event that caused it (control visit, low NPS, Telegram card
 * conflict, …), so its `updatedAt` says nothing about whether the task is
 * still live. Such a row lives until its own `expiresAt`, or until a person
 * closes it (audit AC-03). The engine's spec list is typed against this list,
 * so a new detector cannot be added without joining the sweep.
 */
export const DETECTOR_ACTION_TYPES = [
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
] as const satisfies readonly ActionType[];
export type DetectorActionType = (typeof DETECTOR_ACTION_TYPES)[number];

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
 * Statuses every work list asks for (Action Center, reception briefing,
 * call-center widget). Nothing flips a SNOOZED row back to OPEN when its
 * timer runs out: the list endpoint simply stops hiding it once
 * `snoozeUntil <= now`. A list that asked for OPEN only therefore never saw a
 * snoozed task again, so «Отложить» silently deleted it (audit AC-01).
 */
export const ACTIONABLE_STATUSES: ActionStatus[] = ["OPEN", "SNOOZED"];

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

/**
 * Ф6 (TZ-smart-constructor) — «позвать на контроль».
 *
 * The doctor sets `VisitNote.followUpDays` (prefilled from the diagnosis
 * guide / protocol) or names the day itself (`followUpDate`); on finalize
 * the bridge worker computes the due date and emits this task so reception
 * calls the patient and books the control visit. `dueDate` is the
 * clinic-local calendar day `YYYY-MM-DD`.
 */
export type VisitFollowUpDuePayload = {
  type: "VISIT_FOLLOW_UP_DUE";
  visitNoteId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  /** Clinic-local YYYY-MM-DD when the control visit becomes due. */
  dueDate: string;
  /** Doctor's free-text follow-up note, empty string when none. */
  followUpNote: string;
  /**
   * The doctor named `dueDate` itself, so the card shows it as is; absent
   * for «через N дней», whose day is an estimate («~»). Absent in every
   * payload written before exact dates existed, which were all estimates.
   */
  exactDate?: boolean;
};

/**
 * Audit MA-04 / PH-01 — a Telegram account is bound to `telegramCardId`
 * (usually the card the Mini App created on first open) and has now proven
 * it is the patient of `clinicCardId` (the card reception keeps). The bot
 * could not move the link because the Telegram card already has visits,
 * documents or family links, so reception compares the two and merges by
 * hand. `via` says how the proof arrived; "dedupe" marks the one-off
 * cleanup of accounts that were bound to two cards at once
 * (scripts/fix-patient-telegram-identity.ts). "contactName": the account
 * shared the clinic card's number, but its name is not the card's (a son's
 * number on his mother's card), so nothing was linked and reception checks
 * who the account belongs to. "inbox": reception tied the account's chat to
 * the clinic card from the Telegram inbox (audit TG-11).
 */
export type TelegramLinkConflictPayload = {
  type: "TELEGRAM_LINK_CONFLICT";
  telegramCardId: string;
  telegramCardName: string;
  clinicCardId: string;
  clinicCardName: string;
  via:
    | "invite"
    | "contact"
    | "contactName"
    | "contactConfirm"
    | "dedupe"
    | "inbox";
};

/**
 * Audit AC-04 — call task for a risk-today appointment whose only risk signal
 * is that the patient has not been in touch for a long time. Created by
 * `POST /api/crm/action-center/risk-today/outcome` the first time a call
 * outcome is recorded for such a row, so CONFIRMED / REFUSED reach the
 * appointment and CALLBACK / NO_ANSWER can hide the row and bring it back.
 */
export type NoContactCallPayload = {
  type: "NO_CONTACT_CALL";
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** ISO-8601 datetime of the appointment start (UTC). */
  appointmentAt: string;
  doctorName: string;
  /** Days without contact when the call was logged; null = never contacted. */
  daysSinceContact: number | null;
};

/**
 * Audit AC-09 — a call reception promised the patient on the phone
 * («Перезвонить позже» after the visit time, or «Хочет прийти позже», which
 * also cancels the visit). Created by the call-outcome endpoints; surfaces at
 * `callbackAt` and stays until a person closes it.
 */
export type PatientCallbackPayload = {
  type: "PATIENT_CALLBACK";
  /** The visit the call was about (cancelled for RETURN_LATER). */
  appointmentId: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  /** ISO-8601 datetime of that visit (UTC). */
  appointmentAt: string;
  /** Which outcome promised the call. */
  reason: "CALLBACK" | "RETURN_LATER";
  /** ISO-8601 instant the call is due: the chosen time, or 09:00 clinic time
   *  on the day the patient wants to come back. */
  callbackAt: string;
  /** What the patient said; empty string when nothing was noted. */
  note: string;
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
  | PatientNoChannelPayload
  | VisitFollowUpDuePayload
  | TelegramLinkConflictPayload
  | NoContactCallPayload
  | PatientCallbackPayload;

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
    case "VISIT_FOLLOW_UP_DUE":
      return `VISIT_FOLLOW_UP_DUE:visitNoteId=${payload.visitNoteId}`;
    case "TELEGRAM_LINK_CONFLICT":
      return `TELEGRAM_LINK_CONFLICT:clinicCardId=${payload.clinicCardId}:telegramCardId=${payload.telegramCardId}`;
    case "NO_CONTACT_CALL":
      return `NO_CONTACT_CALL:appointmentId=${payload.appointmentId}`;
    case "PATIENT_CALLBACK":
      return `PATIENT_CALLBACK:appointmentId=${payload.appointmentId}`;
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
 * Dedupe keys of every risk Action (`RISK_ACTION_TYPES`) that can exist for
 * one appointment. Built through `dedupeKeyFor` with stub payloads (only
 * `appointmentId` feeds these keys) so a key-format change can never desync
 * a lookup by appointment: the risk-today outcome, the reschedule stamp and
 * the prompt close on cancel all find the visit's rows through it.
 */
export function riskDedupeKeysOf(appointmentId: string): string[] {
  const base = { appointmentId, patientId: "", patientName: "", appointmentAt: "" };
  return [
    dedupeKeyFor({ type: "NO_SHOW_RISK_HIGH", ...base, risk: 0 }),
    dedupeKeyFor({ type: "UNCONFIRMED_24H", ...base, doctorName: "" }),
    dedupeKeyFor({
      type: "NO_CONTACT_CALL",
      ...base,
      doctorName: "",
      daysSinceContact: null,
    }),
  ];
}

/**
 * The part of a payload, beyond its dedupe key, that says WHAT a person has
 * to do (audit AC-08). A task somebody closed («Готово» / «Отклонить») stays
 * closed while this stays the same, however often a detector or an event
 * re-upserts it; see `upsertAction`.
 *
 * Everything else in a payload is a reading of the same situation that moves
 * on its own: the no-show percentage, days overdue, the size of a dormant
 * segment, a doctor's free-slot count, names. None of those is a new task.
 * What is: the visit moved to another time (it needs confirming again), the
 * control visit or case deadline moved, the debt amount changed, the patient
 * left another rating, a callback was set for another time.
 *
 * Pure, deterministic; `null` when nothing beyond the key matters.
 */
export function actionSubjectOf(payload: ActionPayload): string | null {
  switch (payload.type) {
    case "UNCONFIRMED_24H":
    case "NO_SHOW_RISK_HIGH":
    case "NO_CONTACT_CALL":
      return `appointmentAt=${payload.appointmentAt}`;
    case "CASE_REPEAT_DUE":
    case "VISIT_FOLLOW_UP_DUE":
      return `dueDate=${payload.dueDate}`;
    case "PAYMENT_OVERDUE":
      return `amountUzs=${payload.amountUzs}`;
    case "LOW_NPS_RECEIVED":
      return `score=${payload.score}:comment=${payload.commentPreview}`;
    case "PATIENT_NO_CHANNEL":
      return `appointmentId=${payload.appointmentId ?? ""}`;
    case "PATIENT_CALLBACK":
      return `reason=${payload.reason}:callbackAt=${payload.callbackAt}`;
    case "EMPTY_SLOT_TOMORROW":
    case "DORMANT_BATCH":
    case "OVERDUE_FOLLOW_UP":
    case "DOCTOR_OVERLOAD":
    case "IDLE_ROOM":
    case "LOW_DOCTOR_SCHEDULE":
    case "TELEGRAM_LINK_CONFLICT":
      return null;
    default: {
      const _exhaustive: never = payload;
      throw new Error(
        `actionSubjectOf: unhandled payload type ${(_exhaustive as { type: string }).type}`,
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
    case "TELEGRAM_LINK_CONFLICT":
      return "high";
    case "UNCONFIRMED_24H":
    case "OVERDUE_FOLLOW_UP":
    case "DORMANT_BATCH":
    case "IDLE_ROOM":
    case "PATIENT_NO_CHANNEL":
    case "VISIT_FOLLOW_UP_DUE":
    case "NO_CONTACT_CALL":
      return "medium";
    // A promise made to the patient on the phone: it leads the call list on
    // the day it falls due.
    case "PATIENT_CALLBACK":
      return "high";
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
 * Type-level fallback deeplink, for a row whose payload cannot name its
 * entity (a legacy or malformed payload). Every path is a page that exists:
 * `/crm/payments`, `/crm/cases` and `/crm/call-center` without the
 * clinic's plan were 404s (audit AC-14). Prefer `actionDeeplinkPath`, which
 * opens the entity itself.
 */
export function defaultDeeplinkPath(type: ActionType): string {
  switch (type) {
    case "EMPTY_SLOT_TOMORROW":
    case "DOCTOR_OVERLOAD":
    case "IDLE_ROOM":
      return "/crm/calendar";
    case "DORMANT_BATCH":
      return "/crm/notifications/campaigns/new";
    case "UNCONFIRMED_24H":
    case "NO_SHOW_RISK_HIGH":
    case "PAYMENT_OVERDUE":
      return "/crm/appointments";
    case "LOW_DOCTOR_SCHEDULE":
      return "/crm/doctors";
    case "CASE_REPEAT_DUE":
    case "OVERDUE_FOLLOW_UP":
    case "LOW_NPS_RECEIVED":
    case "PATIENT_NO_CHANNEL":
    case "VISIT_FOLLOW_UP_DUE":
    case "TELEGRAM_LINK_CONFLICT":
    case "NO_CONTACT_CALL":
    case "PATIENT_CALLBACK":
      return "/crm/patients";
    default: {
      const _exhaustive: never = type;
      throw new Error(
        `defaultDeeplinkPath: unhandled ActionType ${_exhaustive as string}`,
      );
    }
  }
}

/** `base/<id>` when the payload carries the id, else the type's fallback. */
function entityPath(type: ActionType, base: string, id: unknown): string {
  return typeof id === "string" && id.length > 0
    ? `${base}/${encodeURIComponent(id)}`
    : defaultDeeplinkPath(type);
}

/** The appointment drawer (`?ap=`) of the appointments page. */
function appointmentPath(type: ActionType, id: unknown): string {
  return typeof id === "string" && id.length > 0
    ? `/crm/appointments?ap=${encodeURIComponent(id)}`
    : defaultDeeplinkPath(type);
}

/**
 * Where a task's button takes the person (audit AC-14): the entity the task
 * is about, on a page that exists. The Action Center used to send
 * «Перезвонить» on a debt to `/crm/payments` and a case repeat to
 * `/crm/cases` (both 404), a low rating back to the Action Center itself,
 * and a visit-bound call to the whole appointments list, where the patient
 * had to be found again by hand.
 *
 * Derived from the payload alone, so the UI uses it for every row, rows
 * written before this rule included, and `upsertAction` stores it as the
 * default. Pure, client-safe.
 */
export function actionDeeplinkPath(payload: ActionPayload): string {
  switch (payload.type) {
    case "EMPTY_SLOT_TOMORROW": {
      // The calendar opens on the slot's clinic day, scoped to the doctor.
      const sp = new URLSearchParams();
      const at = new Date(payload.slotStart);
      if (Number.isFinite(at.getTime())) sp.set("date", tashkentDateOf(at));
      if (payload.doctorId) sp.set("doctors", payload.doctorId);
      const qs = sp.toString();
      return qs ? `/crm/calendar?${qs}` : "/crm/calendar";
    }
    case "DOCTOR_OVERLOAD":
      return payload.doctorId
        ? `/crm/calendar?doctors=${encodeURIComponent(payload.doctorId)}`
        : "/crm/calendar";
    case "IDLE_ROOM":
      return payload.cabinetId
        ? `/crm/calendar?cabinets=${encodeURIComponent(payload.cabinetId)}`
        : "/crm/calendar";
    case "DORMANT_BATCH":
      // Carry the bucket so the wizard opens pre-scoped.
      return payload.segment
        ? `/crm/notifications/campaigns/new?segment=${encodeURIComponent(payload.segment)}`
        : defaultDeeplinkPath(payload.type);
    case "UNCONFIRMED_24H":
    case "NO_SHOW_RISK_HIGH":
    case "PAYMENT_OVERDUE":
      // The visit's drawer: confirm, move, or take the payment right there.
      return appointmentPath(payload.type, payload.appointmentId);
    case "CASE_REPEAT_DUE":
      return entityPath(payload.type, "/crm/cases", payload.caseId);
    case "LOW_DOCTOR_SCHEDULE":
      return entityPath(payload.type, "/crm/doctors", payload.doctorId);
    case "TELEGRAM_LINK_CONFLICT":
      return entityPath(payload.type, "/crm/patients", payload.clinicCardId);
    case "OVERDUE_FOLLOW_UP":
    case "LOW_NPS_RECEIVED":
    case "PATIENT_NO_CHANNEL":
    case "VISIT_FOLLOW_UP_DUE":
    case "NO_CONTACT_CALL":
    case "PATIENT_CALLBACK":
      // A call to make: the patient card has the number and the history.
      return entityPath(payload.type, "/crm/patients", payload.patientId);
    default: {
      const _exhaustive: never = payload;
      throw new Error(
        `actionDeeplinkPath: unhandled payload type ${(_exhaustive as { type: string }).type}`,
      );
    }
  }
}

/**
 * The deeplink of a stored row: from its payload when that names a known
 * type, else whatever was stored, else the type's fallback. A stored path is
 * trusted last because rows written before audit AC-14 carry dead ones.
 */
export function actionRowDeeplinkPath(row: {
  type: ActionType;
  payload: unknown;
  deeplinkPath?: string | null;
}): string {
  const p = row.payload as ActionPayload | null;
  if (p && typeof p === "object" && isActionType(String(p.type))) {
    return actionDeeplinkPath(p);
  }
  if (row.deeplinkPath && row.deeplinkPath.length > 0) return row.deeplinkPath;
  return defaultDeeplinkPath(row.type);
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
    case "VISIT_FOLLOW_UP_DUE":
    case "TELEGRAM_LINK_CONFLICT":
    case "NO_CONTACT_CALL":
    case "PATIENT_CALLBACK":
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
