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
  // payments
  "payment.paid",
  "payment.due",
  // notifications
  "notification.sent",
  "notification.failed",
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
  makeEvent("payment.paid", PaymentPayload),
  makeEvent("payment.due", PaymentPayload),
  makeEvent("notification.sent", NotificationPayload),
  makeEvent("notification.failed", NotificationPayload),
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
