import { z } from "zod";

export const AppointmentStatusEnum = z.enum([
  "BOOKED",
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
  channel: ChannelTypeEnum.default("WALKIN"),
  discountPct: z.number().int().min(0).max(100).optional(),
  discountAmount: z.number().int().min(0).optional(),
  priceFinal: z.number().int().min(0).optional().nullable(),
  comments: z.string().max(5000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  leadId: z.string().optional().nullable(),
});

export const UpdateAppointmentSchema = z.object({
  patientId: z.string().optional(),
  doctorId: z.string().optional(),
  // cabinetId removed — derived from doctor in the route (Phase 11).
  serviceId: z.string().nullable().optional(),
  services: z.array(ServiceLine).max(10).optional(),
  date: z.coerce.date().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  status: AppointmentStatusEnum.optional(),
  queueStatus: AppointmentStatusEnum.optional(),
  channel: ChannelTypeEnum.optional(),
  discountPct: z.number().int().min(0).max(100).optional(),
  discountAmount: z.number().int().min(0).optional(),
  priceFinal: z.number().int().min(0).nullable().optional(),
  comments: z.string().max(5000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  cancelReason: z.string().max(500).nullable().optional(),
});

export const QueryAppointmentSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  doctorId: z.string().optional(),
  patientId: z.string().optional(),
  cabinetId: z.string().optional(),
  status: AppointmentStatusEnum.optional(),
  channel: ChannelTypeEnum.optional(),
  unpaid: z.coerce.boolean().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["date", "createdAt"]).default("date"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const QueueStatusUpdateSchema = z.object({
  queueStatus: z.enum(["WAITING", "IN_PROGRESS", "COMPLETED", "SKIPPED"]),
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

export type CreateAppointment = z.infer<typeof CreateAppointmentSchema>;
export type UpdateAppointment = z.infer<typeof UpdateAppointmentSchema>;
export type QueryAppointment = z.infer<typeof QueryAppointmentSchema>;
