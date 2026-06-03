/**
 * EventEnvelope v2 — cross-surface sync (TZ §4.1).
 *
 * Layered on top of the existing typed event union in `./events.ts`. The old
 * envelope (`{ type, clinicId, at, payload }`) keeps working through a
 * narrowing helper; the v2 envelope adds the identity, causality, and
 * scoping fields the outbox + per-surface SSE filters need:
 *
 *   - `eventId`              stable id, also the AuditLog idempotency key
 *   - `correlationId`        shared across a cascade (SMS YES → confirm → notify)
 *   - `causedByEventId`      back-pointer for trace
 *   - `actor` + `surface`    who did this and from where (CRM / cabinet / mini-app)
 *   - `tenantScope`          clinicId + optional doctor/patient/appointment ids
 *                            used by SSE handlers to decide deliver/skip
 *
 * Why a separate file: the discriminated union in `events.ts` describes the
 * payload shape per type. The envelope describes the *delivery contract* and
 * is intentionally type-erased over the payload (`P = unknown`) so outbox
 * rows can be serialised + replayed without re-running the union narrower.
 *
 * Schema source of truth lives here; the rest of the system imports the
 * types/Zod schemas instead of redefining them.
 */

import { z } from "zod";

import { EVENT_TYPES, type EventType } from "./events";

// ─────────────────────────────────────────────────────────────────────────────
// Actor + surface

/**
 * Who initiated the event. Maps to MedBook's role model:
 *
 *   - `PATIENT`       — mini-app user acting as themselves or via family link
 *   - `DOCTOR`        — doctor cabinet
 *   - `RECEPTIONIST`  — CRM front desk / reception
 *   - `ADMIN`         — clinic admin (CRM settings)
 *   - `SUPER_ADMIN`   — platform admin (cross-clinic)
 *   - `SYSTEM`        — worker / scheduler / cron with no human in the loop
 *   - `EXTERNAL`      — SMS/TG webhook delivering an inbound from a third party
 */
export const ACTOR_ROLES = [
  "PATIENT",
  "DOCTOR",
  "RECEPTIONIST",
  "ADMIN",
  "SUPER_ADMIN",
  "SYSTEM",
  "EXTERNAL",
] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/**
 * Which surface produced the event. SSE handlers do not filter on this — the
 * audit log + UI labels do. Keep narrow; new surfaces added consciously.
 */
export const SURFACES = [
  "CRM",
  "DOCTOR_CABINET",
  "MINIAPP",
  "SMS_WEBHOOK",
  "TG_WEBHOOK",
  "WORKER",
  "CALL_CENTER",
] as const;
export type Surface = (typeof SURFACES)[number];

export const ActorSchema = z.object({
  role: z.enum(ACTOR_ROLES),
  /** Staff `User.id`. `null` for `PATIENT`, `SYSTEM`, `EXTERNAL`. */
  userId: z.string().min(1).nullable(),
  /** `Patient.id` when the actor *is* the patient (mini-app). `null` otherwise. */
  patientId: z.string().min(1).nullable(),
  /** Family scenario: patient A acting for patient B. */
  onBehalfOfPatientId: z.string().min(1).nullable(),
  /** Human-friendly label for audit log + toasts. */
  label: z.string().min(1).max(200),
});
export type Actor = z.infer<typeof ActorSchema>;

export const TenantScopeSchema = z.object({
  clinicId: z.string().min(1),
  doctorId: z.string().min(1).optional(),
  patientId: z.string().min(1).optional(),
  appointmentId: z.string().min(1).optional(),
});
export type TenantScope = z.infer<typeof TenantScopeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Envelope

export const EventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  causedByEventId: z.string().min(1).optional(),
  correlationId: z.string().min(1),

  at: z.string().datetime({ offset: true }),

  type: z.enum(EVENT_TYPES),
  /** Payload shape is enforced by the per-type Zod schemas in `events.ts`. */
  payload: z.unknown(),

  actor: ActorSchema,
  surface: z.enum(SURFACES),
  tenantScope: TenantScopeSchema,
});

export type EventEnvelope<P = unknown> = Omit<
  z.infer<typeof EventEnvelopeSchema>,
  "payload"
> & {
  payload: P;
};

/** Shape callers hand to `publishViaOutbox` — id + timestamp filled by helper. */
export type EventEnvelopeInput<P = unknown> = Omit<
  EventEnvelope<P>,
  "eventId" | "at"
>;

// ─────────────────────────────────────────────────────────────────────────────
// EVENT_META — auditable + severity per type

export type EventSeverity = "info" | "warning" | "critical";

export type EventMeta = {
  /** Outbox pumper materialises an `AuditLog` row when `true`. */
  auditable: boolean;
  severity: EventSeverity;
};

/**
 * Per-type metadata for the outbox pumper. Defaults to `{auditable:false,
 * severity:"info"}` when a type is missing — explicit entries below override
 * for events that must be persisted to AuditLog or surfaced as warnings.
 *
 * Keep the list small: high-frequency events (`queue.updated`, `notification.sent`)
 * stay un-audited so AuditLog doesn't drown in noise.
 */
const EVENT_META_OVERRIDES: Partial<Record<EventType, EventMeta>> = {
  "appointment.created": { auditable: true, severity: "info" },
  "appointment.statusChanged": { auditable: true, severity: "info" },
  "appointment.cancelled": { auditable: true, severity: "info" },
  "appointment.moved": { auditable: true, severity: "info" },
  "notification.failed": { auditable: true, severity: "warning" },
  "lab.result.received": { auditable: true, severity: "info" },
  "lab.order.created": { auditable: true, severity: "info" },
  "eprescription.issued": { auditable: true, severity: "info" },
  "eprescription.cancelled": { auditable: true, severity: "info" },
  "sickleave.issued": { auditable: true, severity: "info" },
  "sickleave.cancelled": { auditable: true, severity: "info" },
  "cds.override.recorded": { auditable: true, severity: "warning" },
  // Phase B.5 — `draftSaved` is high-frequency autosave; skip audit. Finalize
  // closes the visit and warrants a row.
  "visit-note.finalized": { auditable: true, severity: "info" },
  // Phase M2 — mini-app patient mutations. Family link/unlink + NPS + pre-visit
  // are durable patient-driven facts worth an audit row; profile-edit gets one
  // too so the receptionist can see "patient changed phone via TG". Inbox-read
  // is a UI toggle, stays un-audited (noise).
  "patient.familyLinked": { auditable: true, severity: "info" },
  "patient.familyUnlinked": { auditable: true, severity: "info" },
  "patient.profileUpdated": { auditable: true, severity: "info" },
  "nps.submitted": { auditable: true, severity: "info" },
  "previsit.submitted": { auditable: true, severity: "info" },
};

const DEFAULT_META: EventMeta = { auditable: false, severity: "info" };

export function getEventMeta(type: EventType): EventMeta {
  return EVENT_META_OVERRIDES[type] ?? DEFAULT_META;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse / guard

/** Strict parse — throws ZodError on mismatch. Used by the outbox pumper. */
export function parseEnvelope(input: unknown): EventEnvelope {
  return EventEnvelopeSchema.parse(input) as EventEnvelope;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return EventEnvelopeSchema.safeParse(value).success;
}
