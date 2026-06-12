/**
 * Typed realtime event schema (TZ §4.6, §8.8).
 *
 * All realtime events shipped through `/api/events` conform to this
 * discriminated union. Publishers validate via Zod so a bad shape fails at
 * the call site instead of poisoning an SSE stream. Consumers can narrow
 * by `event.type` and get fully typed payloads.
 *
 * Base shape:
 *   { type, clinicId, at, payload }
 *
 * `at` is an ISO-8601 timestamp. `clinicId` is required on every event so
 * the SSE fan-out can reject cross-tenant leaks at the subscriber level.
 *
 * ## Adding a new event type
 *
 *   1. Add a payload schema constant (`FooBarPayload`).
 *   2. Add a member to `AppEventSchema` via `makeEvent("foo.bar", FooBarPayload)`.
 *   3. Add the literal to `EVENT_TYPES` and re-export the payload type.
 *   4. Publish via `publishEvent(clinicId, { type: "foo.bar", payload: ... })`.
 *   5. Add client invalidation in the relevant hook via `useLiveQuery`.
 *
 * See `docs/realtime.md` for the full playbook.
 */

import { z } from "zod";

import {
  ACTION_SEVERITIES,
  ACTION_TYPES,
} from "@/lib/actions/types";

/**
 * The literal-typed registry of event names. Kept in sync with
 * `AppEventSchema` — TypeScript will catch drift because `AppEvent["type"]`
 * must be assignable to `EventType`.
 */
export const EVENT_TYPES = [
  // appointments
  "appointment.created",
  "appointment.updated",
  "appointment.statusChanged",
  "appointment.cancelled",
  "appointment.moved",
  // queue
  "queue.updated",
  // calls
  "call.incoming",
  "call.answered",
  "call.ended",
  "call.missed",
  // telegram
  "tg.message.new",
  "tg.takeover.incoming",
  "tg.conversation.updated",
  // Cross-surface sync §7.10 — cold-start outbound thread by staff. Distinct
  // from `tg.conversation.updated` because creation is auditable; the
  // subsequent update event keeps the CRM inbox in sync per-row.
  "conversation.created",
  // payments
  "payment.paid",
  "payment.due",
  // notifications
  "notification.sent",
  "notification.failed",
  // action center (Phase 13 Wave 2)
  "action.created",
  "action.updated",
  // ai co-pilot (Phase 15 Wave 2)
  "patient.summary.refreshed",
  // ai co-pilot (Phase 15 Wave 5) — voice → SOAP draft written
  "case.soap-draft.refreshed",
  // doctor surface (Phase 20 Wave 5a) — personal reminders + incoming labs
  "reminder.created",
  "reminder.updated",
  // Cross-surface sync §7.7 — doctor weekly working-hours updated. Drives
  // mini-app slot-picker invalidation, CRM calendar refresh, doctor cabinet
  // `/schedule` self-refetch. Auditable per spec.
  "doctor.scheduleChanged",
  "lab.result.received",
  "lab.result.reviewed",
  // Phase G3 — new lab order created (front desk / nurse views can react).
  "lab.order.created",
  // Cross-surface sync §7.11 — medication regimen prescribed by a doctor.
  // Distinct from `eprescription.issued`: that's the formal e-Rx document
  // for the pharmacy; this is the schedule/reminder row that drives the
  // mini-app `/medications` page. Auditable per spec.
  "prescription.created",
  // Phase G7 — clinical forms lifecycle. Issued/cancelled events let the
  // patient card and visit history refresh live; printed isn't broadcast
  // (paper handoff is a non-realtime concern).
  "eprescription.issued",
  "eprescription.cancelled",
  "sickleave.issued",
  "sickleave.cancelled",
  // P2.1 — clinical referral authored by a doctor. Reaches the patient Mini App
  // (documents refresh once the PDF renders) and the target doctor's incoming
  // queue. Audited via the explicit `audit()` call in the route, so it stays
  // out of EVENT_META_OVERRIDES (non-auditable) — same single-source rule as
  // `lab.result.reviewed`.
  "referral.created",
  // Phase G8 — CDS override recorded. Lets a future quality dashboard refresh
  // its KPI tiles the moment a doctor justifies a flagged warning. Tenant
  // scope is the clinic; no PHI in the payload.
  "cds.override.recorded",
  // Phase B.5 — visit-note lifecycle. `draftSaved` is autosave (high-frequency,
  // not audited); `finalized` flips the note + appointment to COMPLETED and is
  // audited. Patient surface ignores both; CRM + cabinet listen to refresh
  // the reception list and the note panel.
  "visit-note.draftSaved",
  "visit-note.finalized",
  // Phase M2 — mini-app patient-driven mutations. CRM surfaces (patient card,
  // notifications inbox, family panel, NPS dashboard, pre-visit drawer) need
  // to react in realtime when the patient touches them from TG.
  "patient.familyLinked",
  "patient.familyUnlinked",
  "patient.profileUpdated",
  "notification.read",
  "nps.submitted",
  "previsit.submitted",
  // Wave 3c — patient tapped «Я на месте» in the Mini App. A signal to the
  // reception desk, NOT a status change: intake (Пришёл → WAITING) stays
  // owned by the receptionist per `appointment-transitions`.
  "patient.arrived",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Payload schemas. Payloads are deliberately loose (optional fields,
// passthrough where appropriate) so handlers can enrich without schema churn.

export const AppointmentPayload = z
  .object({
    appointmentId: z.string(),
    doctorId: z.string().nullable().optional(),
    patientId: z.string().nullable().optional(),
    cabinetId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    previousStatus: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
  })
  .passthrough();
export type AppointmentEventPayload = z.infer<typeof AppointmentPayload>;

export const QueuePayload = z
  .object({
    appointmentId: z.string().optional(),
    doctorId: z.string().optional(),
    queueStatus: z.string().optional(),
    previousStatus: z.string().optional(),
  })
  .passthrough();
export type QueueEventPayload = z.infer<typeof QueuePayload>;

export const CallPayload = z
  .object({
    callId: z.string(),
    dbId: z.string().nullable().optional(),
    direction: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    patientId: z.string().nullable().optional(),
    operatorId: z.string().nullable().optional(),
  })
  .passthrough();
export type CallEventPayload = z.infer<typeof CallPayload>;

export const TgMessagePayload = z
  .object({
    conversationId: z.string(),
    chatId: z.string().optional(),
    messageId: z.string().optional(),
    direction: z.enum(["IN", "OUT"]).optional(),
    preview: z.string().optional(),
    /** Display name of the chat contact (first/last/@username) for UI alerts. */
    contactName: z.string().nullable().optional(),
  })
  .passthrough();
export type TgMessageEventPayload = z.infer<typeof TgMessagePayload>;

export const TgTakeoverPayload = z
  .object({
    conversationId: z.string(),
    chatId: z.string().optional(),
  })
  .passthrough();
export type TgTakeoverEventPayload = z.infer<typeof TgTakeoverPayload>;

export const TgConversationUpdatedPayload = z
  .object({
    conversationId: z.string(),
    mode: z.string().optional(),
    status: z.string().optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .passthrough();
export type TgConversationUpdatedEventPayload = z.infer<
  typeof TgConversationUpdatedPayload
>;

export const ConversationCreatedPayload = z
  .object({
    conversationId: z.string(),
    patientId: z.string(),
    channel: z.string(),
    initiatorRole: z.string(),
    initiatorUserId: z.string().nullable(),
    assigneeUserId: z.string().nullable().optional(),
  })
  .passthrough();
export type ConversationCreatedEventPayload = z.infer<
  typeof ConversationCreatedPayload
>;

export const PaymentPayload = z
  .object({
    paymentId: z.string().optional(),
    appointmentId: z.string().nullable().optional(),
    patientId: z.string().nullable().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type PaymentEventPayload = z.infer<typeof PaymentPayload>;

// `"SMS"` retained on the read path so legacy outbox envelopes (envelopes
// emitted before `docs/TZ-sms-removal.md` Wave 3) still parse when
// replayed. New publishes only ever stamp TG / EMAIL / CALL / VISIT.
export const NotificationPayload = z
  .object({
    sendId: z.string(),
    channel: z.enum(["SMS", "TG", "EMAIL", "CALL", "VISIT"]).optional(),
    patientId: z.string().nullable().optional(),
    templateKey: z.string().optional(),
    failedReason: z.string().optional(),
  })
  .passthrough();
export type NotificationEventPayload = z.infer<typeof NotificationPayload>;

/**
 * Action Center realtime payload (Phase 13 Wave 2). Emitted by the recompute
 * engine via `upsertAction` outcomes. Kept tiny — the UI re-fetches the row
 * via /api/crm/actions/<id> when it needs the full payload to render.
 */
export const ActionEventPayload = z
  .object({
    id: z.string().min(1),
    type: z.enum(ACTION_TYPES),
    severity: z.enum(ACTION_SEVERITIES),
  })
  .passthrough();
export type ActionEventPayload = z.infer<typeof ActionEventPayload>;

/**
 * Phase 15 Wave 2 — emitted by the patient-summary-refresh worker after it
 * writes `Patient.summaryCache + summaryCacheUpdatedAt`. The UI re-fetches
 * via `GET /api/crm/patients/[id]/summary` when this fires.
 */
export const PatientSummaryRefreshedPayload = z
  .object({
    patientId: z.string().min(1),
  })
  .passthrough();
export type PatientSummaryRefreshedPayload = z.infer<
  typeof PatientSummaryRefreshedPayload
>;

/**
 * Phase 15 Wave 5 — emitted by the voice-soap worker after it writes
 * `MedicalCase.soapDraft`. The CRM case page subscribes via
 * `useLiveQueryInvalidation` and re-fetches `GET /api/crm/cases/<id>` so the
 * SOAP card surfaces the new draft without a page refresh.
 */
export const CaseSoapDraftRefreshedPayload = z
  .object({
    caseId: z.string().min(1),
  })
  .passthrough();
export type CaseSoapDraftRefreshedPayload = z.infer<
  typeof CaseSoapDraftRefreshedPayload
>;

/**
 * Phase 20 Wave 5a — doctor reminders + lab results. The doctorId is the
 * User row (not Doctor) — subscribers filter on `clinicId` and then narrow
 * to "is this for me" via the doctorId field. We only ship ids; the hook
 * re-fetches the list/detail when its key changes.
 */
export const ReminderEventPayload = z
  .object({
    reminderId: z.string().min(1),
    doctorId: z.string().min(1),
    patientId: z.string().nullable().optional(),
  })
  .passthrough();
export type ReminderEventPayload = z.infer<typeof ReminderEventPayload>;

/**
 * Cross-surface sync §7.7 — doctor weekly working-hours replaced. Payload is
 * the new entry count + whether anything actually changed, so subscribers can
 * decide whether to do an expensive re-fetch (mini-app slot grid) or skip a
 * noop. `entries` themselves are NOT on the wire — anyone interested re-reads
 * `/api/crm/doctors/[id]/schedule`.
 */
export const DoctorScheduleChangedPayload = z
  .object({
    doctorId: z.string().min(1),
    entryCount: z.number().int().nonnegative(),
    previousEntryCount: z.number().int().nonnegative(),
  })
  .passthrough();
export type DoctorScheduleChangedEventPayload = z.infer<
  typeof DoctorScheduleChangedPayload
>;

export const LabResultEventPayload = z
  .object({
    labResultId: z.string().min(1),
    doctorId: z.string().min(1),
    patientId: z.string().min(1),
    flag: z.enum(["NORMAL", "LOW", "HIGH", "CRITICAL"]).nullable().optional(),
  })
  .passthrough();
export type LabResultEventPayload = z.infer<typeof LabResultEventPayload>;

/**
 * Phase G3 — outbound lab order receipt. Used by front-desk + nurse surfaces
 * to react ("новый заказ для Касымова — на столе"); we ship only ids and
 * urgency so the listening UI can refetch detail when it cares.
 */
export const LabOrderCreatedPayload = z
  .object({
    labOrderId: z.string().min(1),
    orderNumber: z.string().min(1),
    doctorId: z.string().min(1),
    patientId: z.string().min(1),
    urgency: z.enum(["ROUTINE", "URGENT", "STAT"]),
  })
  .passthrough();
export type LabOrderCreatedPayload = z.infer<typeof LabOrderCreatedPayload>;

/**
 * Phase G7 — e-prescription lifecycle. Issued + cancelled share the same
 * envelope: id + human-readable number + originating doctor/patient so a
 * listening surface (history drawer, action feed) can decide whether to
 * refetch without joining tables.
 */
export const EPrescriptionEventPayload = z
  .object({
    ePrescriptionId: z.string().min(1),
    rxNumber: z.string().min(1),
    doctorId: z.string().min(1).optional(),
    patientId: z.string().min(1).optional(),
    itemCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type EPrescriptionEventPayload = z.infer<typeof EPrescriptionEventPayload>;

/**
 * Cross-surface sync §7.11 — medication regimen written by a doctor. Drives
 * mini-app `/medications` live-refresh. `drugName` + `dosage` are clinical
 * metadata, not PII, so it's fine to surface on the envelope; encrypted
 * `notes` deliberately stays off the wire.
 */
export const PrescriptionCreatedPayload = z
  .object({
    prescriptionId: z.string().min(1),
    patientId: z.string().min(1),
    doctorId: z.string().min(1),
    // Null for rows bridged from the visit-note constructor (Ф6) — those
    // have no MedicalCase; consumers only key invalidation off the type.
    caseId: z.string().min(1).nullable(),
    drugName: z.string().min(1),
    dosage: z.string().min(1),
    remindersEnabled: z.boolean(),
    status: z.string().min(1),
  })
  .passthrough();
export type PrescriptionCreatedEventPayload = z.infer<
  typeof PrescriptionCreatedPayload
>;

/**
 * Phase G7 — sick-leave lifecycle. Same shape rules as the Rx payload.
 */
export const SickLeaveEventPayload = z
  .object({
    sickLeaveId: z.string().min(1),
    certNumber: z.string().min(1),
    doctorId: z.string().min(1).optional(),
    patientId: z.string().min(1).optional(),
    days: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type SickLeaveEventPayload = z.infer<typeof SickLeaveEventPayload>;

/**
 * P2.1 — clinical referral created. Ids + flags only (no PHI on the wire):
 * `toDoctorId` is set for an internal hand-off, null for an external one, so a
 * listening cabinet queue can decide "is this for me?" without a re-read. The
 * patient surface uses it to refresh the documents list once the PDF lands.
 */
export const ReferralCreatedPayload = z
  .object({
    referralId: z.string().min(1),
    fromDoctorId: z.string().min(1),
    toDoctorId: z.string().min(1).nullable().optional(),
    patientId: z.string().min(1),
  })
  .passthrough();
export type ReferralCreatedPayload = z.infer<typeof ReferralCreatedPayload>;

/**
 * Phase G8 — CDS override recorded. Carries the override id plus a small
 * snapshot of the warning (kind + severity) so dashboards can update their
 * counters without a fetch. No PHI: the warning detail lives on the row.
 */
export const CdsOverrideEventPayload = z
  .object({
    overrideId: z.string().min(1),
    doctorId: z.string().min(1).optional(),
    patientId: z.string().min(1).optional(),
    warningKind: z.string().min(1),
    severity: z.string().min(1),
    reason: z.string().min(1),
  })
  .passthrough();
export type CdsOverrideEventPayload = z.infer<typeof CdsOverrideEventPayload>;

/**
 * Phase B.5 — visit-note lifecycle. `draftSaved` ships the note id + which
 * fields changed so listening surfaces can decide to refetch detail (or
 * skip — autosave fires every ~1.5 s and most subscribers only care about
 * the existence of new content, not the keystrokes). `finalized` is its own
 * envelope so the reception desk can flip the row to "completed" without
 * waiting on the cascade-emitted `appointment.statusChanged`. No PHI in
 * either payload.
 */
export const VisitNotePayload = z
  .object({
    visitNoteId: z.string().min(1),
    appointmentId: z.string().min(1).optional(),
    doctorId: z.string().min(1).optional(),
    patientId: z.string().min(1).optional(),
    /** Fields that changed in this autosave (for `draftSaved` only). */
    changedFields: z.array(z.string()).optional(),
    /** Lifecycle marker for `finalized`. */
    finalizedAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();
export type VisitNoteEventPayload = z.infer<typeof VisitNotePayload>;

/**
 * Phase M2 — mini-app family link lifecycle. Both add (familyLinked) and
 * remove (familyUnlinked) ship the same shape: who's linking, who's being
 * linked, and how they're related. CRM patient-card subscribers refresh the
 * "связанные пациенты" panel; the patient inbox can show a confirmation.
 */
export const PatientFamilyPayload = z
  .object({
    ownerPatientId: z.string().min(1),
    linkedPatientId: z.string().min(1),
    relationship: z.string().nullable().optional(),
    /** Whether the linked Patient row was created vs. claimed from existing. */
    createdNew: z.boolean().optional(),
  })
  .passthrough();
export type PatientFamilyEventPayload = z.infer<typeof PatientFamilyPayload>;

/**
 * Phase M2 — patient self-edited their TG-tied profile (name, phone, lang).
 * `changedFields` lets the CRM-side subscribers decide whether to refetch the
 * full row (worth it on phone/name changes) or just bump preferredLang in
 * cache (cheap toggle). No PHI in the payload — listeners join on patientId.
 */
export const PatientProfileUpdatedPayload = z
  .object({
    patientId: z.string().min(1),
    changedFields: z.array(z.string()).min(1),
  })
  .passthrough();
export type PatientProfileUpdatedEventPayload = z.infer<
  typeof PatientProfileUpdatedPayload
>;

/**
 * Phase M2 — TG patient marked an inbox notification as read. The CRM-side
 * notifications panel uses this to dim the unread counter live; no audit.
 */
export const NotificationReadPayload = z
  .object({
    sendId: z.string().min(1),
    patientId: z.string().min(1),
  })
  .passthrough();
export type NotificationReadEventPayload = z.infer<
  typeof NotificationReadPayload
>;

/**
 * Phase M2 — patient submitted their post-visit NPS score. CRM dashboards
 * (KPI strip + NPS table) refresh on this; ratings are 0-10, an optional
 * comment may be present. Score-only is the audit-relevant fact.
 */
export const NpsSubmittedPayload = z
  .object({
    appointmentId: z.string().min(1),
    patientId: z.string().min(1),
    score: z.number().int().min(0).max(10),
    hasComment: z.boolean().optional(),
  })
  .passthrough();
export type NpsSubmittedEventPayload = z.infer<typeof NpsSubmittedPayload>;

/**
 * Phase M2 — patient submitted their pre-visit questionnaire. Cabinet view
 * uses this to show "пациент заполнил" tile before the appointment starts;
 * we ship counts (not contents) so the cabinet can decide whether to refetch
 * `appointment.preVisitData` only when the doctor actually opens the panel.
 */
export const PreVisitSubmittedPayload = z
  .object({
    appointmentId: z.string().min(1),
    patientId: z.string().min(1),
    complaintsLen: z.number().int().nonnegative(),
    allergiesCount: z.number().int().nonnegative(),
    medicationsCount: z.number().int().nonnegative(),
  })
  .passthrough();
export type PreVisitSubmittedEventPayload = z.infer<
  typeof PreVisitSubmittedPayload
>;

/**
 * Wave 3c — patient self-reported arrival from the Mini App. `patientName`
 * rides on the envelope (same precedent as `TgMessagePayload.contactName`)
 * so the reception toast can greet without an extra fetch; the receptionist
 * still marks «Пришёл» manually after verifying.
 */
export const PatientArrivedPayload = z
  .object({
    appointmentId: z.string().min(1),
    patientId: z.string().min(1),
    patientName: z.string().optional(),
    doctorId: z.string().nullable().optional(),
    /** "HH:mm" scheduled time so the toast can say when they're expected. */
    time: z.string().optional(),
  })
  .passthrough();
export type PatientArrivedEventPayload = z.infer<typeof PatientArrivedPayload>;

// ─────────────────────────────────────────────────────────────────────────────
// Builder: each event carries the base envelope plus its typed payload.

const baseEnvelope = {
  clinicId: z.string().min(1),
  at: z.string().datetime({ offset: true }),
};

function makeEvent<T extends EventType, P extends z.ZodTypeAny>(
  type: T,
  payload: P,
) {
  return z.object({
    type: z.literal(type),
    ...baseEnvelope,
    payload,
  });
}

export const AppEventSchema = z.discriminatedUnion("type", [
  makeEvent("appointment.created", AppointmentPayload),
  makeEvent("appointment.updated", AppointmentPayload),
  makeEvent("appointment.statusChanged", AppointmentPayload),
  makeEvent("appointment.cancelled", AppointmentPayload),
  makeEvent("appointment.moved", AppointmentPayload),
  makeEvent("queue.updated", QueuePayload),
  makeEvent("call.incoming", CallPayload),
  makeEvent("call.answered", CallPayload),
  makeEvent("call.ended", CallPayload),
  makeEvent("call.missed", CallPayload),
  makeEvent("tg.message.new", TgMessagePayload),
  makeEvent("tg.takeover.incoming", TgTakeoverPayload),
  makeEvent("tg.conversation.updated", TgConversationUpdatedPayload),
  makeEvent("conversation.created", ConversationCreatedPayload),
  makeEvent("payment.paid", PaymentPayload),
  makeEvent("payment.due", PaymentPayload),
  makeEvent("notification.sent", NotificationPayload),
  makeEvent("notification.failed", NotificationPayload),
  makeEvent("action.created", ActionEventPayload),
  makeEvent("action.updated", ActionEventPayload),
  makeEvent("patient.summary.refreshed", PatientSummaryRefreshedPayload),
  makeEvent("case.soap-draft.refreshed", CaseSoapDraftRefreshedPayload),
  makeEvent("reminder.created", ReminderEventPayload),
  makeEvent("reminder.updated", ReminderEventPayload),
  makeEvent("doctor.scheduleChanged", DoctorScheduleChangedPayload),
  makeEvent("lab.result.received", LabResultEventPayload),
  makeEvent("lab.result.reviewed", LabResultEventPayload),
  makeEvent("lab.order.created", LabOrderCreatedPayload),
  makeEvent("prescription.created", PrescriptionCreatedPayload),
  makeEvent("eprescription.issued", EPrescriptionEventPayload),
  makeEvent("eprescription.cancelled", EPrescriptionEventPayload),
  makeEvent("sickleave.issued", SickLeaveEventPayload),
  makeEvent("sickleave.cancelled", SickLeaveEventPayload),
  makeEvent("referral.created", ReferralCreatedPayload),
  makeEvent("cds.override.recorded", CdsOverrideEventPayload),
  makeEvent("visit-note.draftSaved", VisitNotePayload),
  makeEvent("visit-note.finalized", VisitNotePayload),
  makeEvent("patient.familyLinked", PatientFamilyPayload),
  makeEvent("patient.familyUnlinked", PatientFamilyPayload),
  makeEvent("patient.profileUpdated", PatientProfileUpdatedPayload),
  makeEvent("notification.read", NotificationReadPayload),
  makeEvent("nps.submitted", NpsSubmittedPayload),
  makeEvent("previsit.submitted", PreVisitSubmittedPayload),
  makeEvent("patient.arrived", PatientArrivedPayload),
]);

export type AppEvent = z.infer<typeof AppEventSchema>;

/**
 * Pick a specific event from the union by type. Handy at the hook layer:
 *
 *   function onAppt(e: EventOf<"appointment.created">) { ... }
 */
export type EventOf<T extends EventType> = Extract<AppEvent, { type: T }>;

/** Input shape accepted by `publishEvent` — clinicId/at filled by the helper. */
export type AppEventInput =
  | {
      [K in EventType]: {
        type: K;
        payload: EventOf<K>["payload"];
        at?: string;
      };
    }[EventType];

/**
 * Validate an already-assembled envelope. Throws `ZodError` on mismatch.
 * Callers that need a soft failure can use `AppEventSchema.safeParse`.
 */
export function parseEvent(input: unknown): AppEvent {
  return AppEventSchema.parse(input);
}

/** Runtime guard — useful for narrowing untrusted SSE payloads. */
export function isAppEvent(value: unknown): value is AppEvent {
  return AppEventSchema.safeParse(value).success;
}
