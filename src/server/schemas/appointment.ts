import { z } from "zod";

import { APPOINTMENTS_LIST_MAX_LIMIT } from "@/lib/appointments/fetch-all-pages";
import { SERVER_BUCKETS } from "@/lib/appointments/list-tiles";
import { queryBool } from "./query-bool";

export const AppointmentStatusEnum = z.enum([
  "BOOKED",
  "CONFIRMED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "NO_SHOW",
]);

export const ChannelTypeEnum = z.enum([
  "WALKIN",
  "PHONE",
  "TELEGRAM",
  "WEBSITE",
  "KIOSK",
]);

const ServiceLine = z.object({
  serviceId: z.string(),
  quantity: z.number().int().min(1).max(20).default(1),
  priceOverride: z.number().int().min(0).optional(),
});

// `cabinetId` is no longer a field on appointment payloads — Phase 11 binds
// each doctor to exactly one cabinet, so the route derives it from
// `doctor.cabinetId` and ignores anything the client sends. We keep the key
// out of the schema so the contract is unambiguous (and so unit tests fail
// loudly if anyone tries to set a cabinet on an appointment again).
export const CreateAppointmentSchema = z.object({
  patientId: z.string(),
  doctorId: z.string(),
  serviceId: z.string().optional().nullable(),
  services: z.array(ServiceLine).max(10).optional(),
  date: z.coerce.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  durationMin: z.number().int().min(5).max(480).default(30),
  // Two-lanes: the booking path mints SCHEDULE-lane rows only. WALKIN is the
  // live-lane discriminator — live rows are created exclusively by
  // `registerWalkin`. Defaulting to WALKIN used to silently produce
  // "bookings" that reserved no slot and vanished from the «Записи» panels.
  channel: ChannelTypeEnum.default("PHONE").refine((c) => c !== "WALKIN", {
    message: "walk-ins are created via registerWalkin, not the booking path",
  }),
  discountPct: z.number().int().min(0).max(100).optional(),
  discountAmount: z.number().int().min(0).optional(),
  priceFinal: z.number().int().min(0).optional().nullable(),
  comments: z.string().max(5000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  leadId: z.string().optional().nullable(),
  // Optional MedicalCase link at create time. When present, pricing kicks
  // in the free-repeat policy on follow-up visits.
  medicalCaseId: z.string().optional().nullable(),
});

/**
 * A field the generic PATCH refuses outright (audit AP-03): sent at all, it
 * is a 400 naming the field, not silently dropped, so a caller learns the
 * change did not happen.
 */
const lockedField = (reason: string) => z.never({ error: reason }).optional();

export const UpdateAppointmentSchema = z.object({
  // Audit AP-03 — the visit's patient is fixed at booking. Re-pointing it
  // moved the visit, its conclusion and its payments to another person
  // (unchecked, even to a patient of another clinic).
  patientId: lockedField("patient_locked"),
  doctorId: z.string().optional(),
  // cabinetId removed — derived from doctor in the route (Phase 11).
  serviceId: z.string().nullable().optional(),
  services: z.array(ServiceLine).max(10).optional(),
  date: z.coerce.date().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  status: AppointmentStatusEnum.optional(),
  // Only alongside `status` and equal to it (audit AP-03, refine below): the
  // route keeps the two columns in lockstep and guards the transition on
  // `status`. A bare `queueStatus` skipped the transition and role guards
  // and left the reception board and the doctor's screen disagreeing.
  // A queue move alone goes through /appointments/[id]/queue-status.
  queueStatus: AppointmentStatusEnum.optional(),
  // Manual live-queue urgency. Higher floats to the top of the waiting list;
  // 0 = normal. The reception panel toggles between 0 and 1.
  queuePriority: z.number().int().min(0).max(100).optional(),
  // Two-lanes: a channel flip must never teleport a row between lanes —
  // WALKIN rows are minted by registerWalkin only (see CreateAppointmentSchema).
  channel: ChannelTypeEnum.optional().refine((c) => c !== "WALKIN", {
    message: "walk-ins are created via registerWalkin, not the booking path",
  }),
  discountPct: z.number().int().min(0).max(100).optional(),
  discountAmount: z.number().int().min(0).optional(),
  priceFinal: z.number().int().min(0).nullable().optional(),
  comments: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  cancelReason: z.string().max(500).nullable().optional(),
  // Audit AP-03 — a visit joins or leaves a case through
  // /cases/[id]/attach-appointment and detach-appointment, which check the
  // case is this patient's. The PATCH took any case id, so a visit became a
  // free repeat on somebody else's case.
  medicalCaseId: lockedField("case_change_via_attach"),
  // Not a column (audit AC-10): set by the drawer that a risk-today row's
  // «Перенести» opened, so a saved move of this visit records that outcome.
  // Any other move (calendar drag, bulk shift) leaves it out and records
  // nothing, because nobody called the patient.
  riskOutcome: z.literal("RESCHEDULED").optional(),
}).superRefine((v, ctx) => {
  if (v.queueStatus !== undefined && v.queueStatus !== v.status) {
    ctx.addIssue({
      code: "custom",
      path: ["queueStatus"],
      message: "queue_status_requires_status",
    });
  }
});

export const QueryAppointmentSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  doctorId: z.string().optional(),
  patientId: z.string().optional(),
  cabinetId: z.string().optional(),
  status: AppointmentStatusEnum.optional(),
  // A «Записи» tile that is not one status («Скоро», «Просрочены», …),
  // filtered here so its click lists every row its count holds (AP-21).
  bucket: z.enum(SERVER_BUCKETS).optional(),
  channel: ChannelTypeEnum.optional(),
  // The «Услуга» filter (audit AP-23): zod dropped it, so the list never
  // narrowed while the filter indicator lit up.
  serviceId: z.string().optional(),
  unpaid: queryBool(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  // Clients that need a whole range page through `nextCursor`
  // (`fetchAllAppointmentPages`), never ask for more than this (DR-01).
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(APPOINTMENTS_LIST_MAX_LIMIT)
    .default(50),
  sort: z.enum(["date", "createdAt"]).default("date"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const QueueStatusUpdateSchema = z.object({
  // NO_SHOW joins the off-path triplet (with SKIPPED) the reception drawer can
  // dispatch here. CANCELLED is intentionally absent — it owns a richer flow
  // (DELETE /appointments/[id] sets cancelledAt + releases the slot), so the
  // drawer routes a cancel there instead of through this status flip.
  queueStatus: z.enum([
    "CONFIRMED",
    "WAITING",
    "IN_PROGRESS",
    "COMPLETED",
    "SKIPPED",
    "NO_SHOW",
  ]),
});

export const SlotsQuerySchema = z.object({
  doctorId: z.string(),
  date: z.coerce.date(),
  serviceIds: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
});

export const BulkStatusSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  status: AppointmentStatusEnum,
  cancelReason: z.string().max(500).optional(),
});

export const BulkRescheduleSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  deltaMinutes: z
    .number()
    .int()
    .min(-60 * 24 * 365)
    .max(60 * 24 * 365)
    .refine((v) => v !== 0, "delta cannot be zero"),
});

export const ReorderQueueSchema = z.object({
  doctorId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1).max(200),
});

export type CreateAppointment = z.infer<typeof CreateAppointmentSchema>;
export type UpdateAppointment = z.infer<typeof UpdateAppointmentSchema>;
export type QueryAppointment = z.infer<typeof QueryAppointmentSchema>;
export type BulkReschedule = z.infer<typeof BulkRescheduleSchema>;
export type ReorderQueue = z.infer<typeof ReorderQueueSchema>;
