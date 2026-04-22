import { z } from "zod";

export const NotificationChannelEnum = z.enum([
  "SMS",
  "TG",
  "CALL",
  "EMAIL",
  "VISIT",
]);
export const NotificationCategoryEnum = z.enum([
  "REMINDER",
  "MARKETING",
  "TRANSACTIONAL",
]);
export const NotificationTriggerEnum = z.enum([
  "MANUAL",
  "APPOINTMENT_CREATED",
  "APPOINTMENT_BEFORE",
  "APPOINTMENT_MISSED",
  "APPOINTMENT_COMPLETED",
  "PATIENT_BIRTHDAY",
  "PATIENT_INACTIVE_DAYS",
  "CRON",
]);
export const NotificationStatusEnum = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "CANCELLED",
]);

// --- Templates --------------------------------------------------------------

export const CreateTemplateSchema = z.object({
  key: z.string().min(2).max(100),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  channel: NotificationChannelEnum,
  category: NotificationCategoryEnum,
  bodyRu: z.string().min(1).max(10000),
  bodyUz: z.string().min(1).max(10000),
  buttons: z.unknown().optional().nullable(),
  variables: z.array(z.string().max(100)).max(100).optional(),
  trigger: NotificationTriggerEnum.default("MANUAL"),
  triggerConfig: z.unknown().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

export const QueryTemplateSchema = z.object({
  channel: NotificationChannelEnum.optional(),
  category: NotificationCategoryEnum.optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

// --- Sends ------------------------------------------------------------------

export const CreateSendSchema = z.object({
  templateId: z.string().optional().nullable(),
  patientId: z.string(),
  appointmentId: z.string().optional().nullable(),
  channel: NotificationChannelEnum,
  recipient: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  scheduledFor: z.coerce.date(),
});

export const QuerySendSchema = z.object({
  status: NotificationStatusEnum.optional(),
  channel: NotificationChannelEnum.optional(),
  templateId: z.string().optional(),
  patientId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateTemplate = z.infer<typeof CreateTemplateSchema>;
export type UpdateTemplate = z.infer<typeof UpdateTemplateSchema>;
export type CreateSend = z.infer<typeof CreateSendSchema>;
